import { expectedWorkflows, labelsForFiles } from "./automation-core.mjs";
import { managedPullLabels } from "./config.mjs";
import { updateReadiness } from "./pr-readiness.mjs";

function linkedIssueQuery() {
  return `query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        closingIssuesReferences(first: 50) {
          nodes {
            number
            labels(first: 50) { nodes { name } }
            closedByPullRequestsReferences(first: 50) { nodes { number state } }
          }
        }
      }
    }
  }`;
}

async function getLinkedIssues(client, number) {
  const response = await client.graphql(linkedIssueQuery(), { owner: client.owner, repo: client.repo, number });
  return response.data.repository.pullRequest.closingIssuesReferences.nodes;
}

function pullHistoryShas(pull, timeline) {
  const shas = new Set([pull.head?.sha].filter(Boolean));
  for (const event of timeline) {
    if (event.event === "committed" && event.sha) shas.add(event.sha);
    if (event.event === "head_ref_force_pushed") {
      if (event.before_commit?.sha) shas.add(event.before_commit.sha);
      if (event.after_commit?.sha) shas.add(event.after_commit.sha);
    }
  }
  return [...shas];
}

async function cancelPendingPullChecks(client, shas, config, output) {
  const managedChecks = new Set([config.gate.name, config.readiness.name]);
  const pending = [];
  for (const sha of new Set(shas.filter(Boolean))) {
    for (const run of await client.listCheckRuns(sha)) {
      if (managedChecks.has(run.name) && run.status !== "completed") pending.push(run);
    }
  }
  for (const run of pending) {
    await client.updateCheckRun(run.id, {
      status: "completed",
      conclusion: "cancelled",
      output,
    });
  }
}

function inheritedPriority(issues, config) {
  const priorities = new Set(issues.flatMap((issue) => issue.labels.nodes.map((label) => label.name))
    .filter((name) => name.startsWith(config.linkedIssues.priorityPrefix)));
  return priorities.size === 1 ? [...priorities][0] : null;
}

async function synchronizeOpenPull(client, pull, config, supersededSha) {
  if (supersededSha && supersededSha !== pull.head.sha) {
    await cancelPendingPullChecks(client, [supersededSha], config, {
      title: "Superseded by a newer pull request head",
      summary: `This gate belongs to an earlier pull request head and was cancelled when \`${pull.head.sha.slice(0, 12)}\` became current.`,
    });
  }
  const files = (await client.listPullFiles(pull.number)).map((file) => file.filename);
  const desiredManaged = new Set(labelsForFiles(files, config));
  const requiredWorkflows = expectedWorkflows(files, config);
  const existingGate = (await client.listCheckRuns(pull.head.sha))
    .filter((run) => run.name === config.gate.name)
    .sort((left, right) => right.id - left.id)[0];
  if (requiredWorkflows.length > 0) {
    if (existingGate?.status === "completed" && existingGate.conclusion === "success") desiredManaged.add(config.gate.passedLabel);
    else if (existingGate?.status !== "completed" || !existingGate) desiredManaged.add(config.gate.runningLabel);
  }
  const currentLabels = pull.labels.map((label) => label.name);
  const managed = managedPullLabels(config);
  const preserved = currentLabels.filter((label) => !managed.includes(label));
  const linkedIssues = await getLinkedIssues(client, pull.number);
  const priority = inheritedPriority(linkedIssues, config);
  if (priority && !preserved.some((label) => label.startsWith(config.linkedIssues.priorityPrefix))) preserved.push(priority);
  await client.setIssueLabels(pull.number, [...preserved, ...desiredManaged]);

  if (!existingGate) {
    const body = {
      name: config.gate.name,
      head_sha: pull.head.sha,
      status: requiredWorkflows.length === 0 ? "completed" : "in_progress",
      output: {
        title: requiredWorkflows.length === 0 ? "No path-filtered CI required" : "Waiting for required CI",
        summary: requiredWorkflows.length === 0
          ? "No path-filtered CI workflows are required for this change."
          : requiredWorkflows.map((name) => `${name}: pending`).join("\n"),
      },
    };
    if (requiredWorkflows.length === 0) body.conclusion = "success";
    await client.createCheckRun(body);
  }

  if (requiredWorkflows.length === 0) {
    const comments = await client.listIssueComments(pull.number);
    const diagnostics = comments.find((comment) => comment.body?.includes(config.gate.commentMarker));
    if (diagnostics) {
      await client.updateIssueComment(
        diagnostics.id,
        `${config.gate.commentMarker}\n## CI diagnostics resolved for \`${pull.head.sha.slice(0, 12)}\`\n\nNo path-filtered CI workflows are required for the latest PR head.\n\n_This comment is updated in place for the latest PR head._`,
      );
    }
  }

  for (const issue of linkedIssues) {
    const labels = issue.labels.nodes.map((label) => label.name);
    const next = labels.filter((label) => label !== config.linkedIssues.readyLabel);
    if (!next.includes(config.linkedIssues.waitLabel)) next.push(config.linkedIssues.waitLabel);
    if (!next.some((label) => label.startsWith(config.linkedIssues.statusPrefix))) next.push(config.linkedIssues.inProgressLabel);
    await client.setIssueLabels(issue.number, next);
  }
}

async function synchronizeClosedPull(client, pull, config) {
  const state = pull.merged ? "merged" : "closed";
  const timeline = await client.listIssueTimeline(pull.number);
  await cancelPendingPullChecks(client, pullHistoryShas(pull, timeline), config, {
    title: `Pull request ${state} before CI completed`,
    summary: `The pull request was ${state} before all required CI workflows reached a terminal state.`,
  });
  const labels = pull.labels.map((label) => label.name)
    .filter((label) => ![config.gate.runningLabel, config.gate.passedLabel].includes(label));
  if (pull.merged) {
    const mergedLabels = labels.filter((label) => !config.linkedIssues.mergedPullLabelsToRemove.includes(label));
    if (!mergedLabels.includes(config.linkedIssues.mergedLabel)) mergedLabels.push(config.linkedIssues.mergedLabel);
    await client.setIssueLabels(pull.number, mergedLabels);
  } else if (labels.length !== pull.labels.length) {
    await client.setIssueLabels(pull.number, labels);
  }
  for (const issue of await getLinkedIssues(client, pull.number)) {
    const hasAnotherOpenPull = issue.closedByPullRequestsReferences.nodes.some(
      (candidate) => candidate.number !== pull.number && candidate.state === "OPEN",
    );
    if (hasAnotherOpenPull) continue;
    const next = issue.labels.nodes.map((label) => label.name)
      .filter((label) => ![config.linkedIssues.waitLabel, config.linkedIssues.inProgressLabel].includes(label));
    await client.setIssueLabels(issue.number, next);
  }
}

export async function runPrAutomation({ client, event, config }) {
  for (const [name, definition] of Object.entries(config.labels.definitions)) await client.ensureLabel(name, definition);
  const eventPull = event.pull_request;
  const manualNumber = event.inputs?.pull_request_number;
  const pullNumber = eventPull?.number ?? Number(manualNumber);
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw new Error("pull_request payload or a positive pull_request_number is required");
  }
  const pull = await client.getPull(pullNumber);
  const isManualReconciliation = !eventPull;
  if (isManualReconciliation && pull.state !== "closed") throw new Error("manual reconciliation requires a closed pull request");
  if (isManualReconciliation || event.action === "closed") return synchronizeClosedPull(client, pull, config);
  await synchronizeOpenPull(client, pull, config, event.action === "synchronize" ? event.before : null);
  try {
    return await updateReadiness(client, pull, config);
  } catch (error) {
    return { outcome: "readiness_error", pull: pull.number, error: error.message };
  }
}
