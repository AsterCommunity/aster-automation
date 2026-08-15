import { escapeMarkdownCell } from "./automation-core.mjs";
import { reconcilePullDiagnostics } from "./ci-diagnostics.mjs";
import { updateReadiness } from "./pr-readiness.mjs";

export function trackingIssueNumbers(body, config) {
  const regex = new RegExp(config.linkedIssues.trackingPattern, "gim");
  const numbers = new Set();
  for (const match of String(body || "").matchAll(regex)) {
    const number = Number(match[1]);
    if (Number.isInteger(number) && number > 0) numbers.add(number);
  }
  return [...numbers];
}

function issuePullsQuery() {
  return `query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        closedByPullRequestsReferences(first: 50) { nodes { number state } }
      }
    }
  }`;
}

export async function reconcileTrackingIssues(client, pulls, config) {
  const trackedBy = new Map();
  for (const pull of pulls) {
    for (const number of trackingIssueNumbers(pull.body, config)) {
      if (!trackedBy.has(number)) trackedBy.set(number, []);
      trackedBy.get(number).push(pull.number);
    }
  }
  const waitIssues = await client.listOpenIssues([config.linkedIssues.waitLabel]);
  const numbers = new Set([...trackedBy.keys(), ...waitIssues.filter((issue) => !issue.pull_request).map((issue) => issue.number)]);
  const results = [];
  for (const number of numbers) {
    const pullNumbers = trackedBy.get(number) || [];
    const issue = await client.getIssue(number);
    if (issue.pull_request || issue.state !== "open") continue;
    const labels = issue.labels.map((label) => typeof label === "string" ? label : label.name);
    const response = await client.graphql(issuePullsQuery(), { owner: client.owner, repo: client.repo, number });
    const nativeOpen = (response.data.repository.issue?.closedByPullRequestsReferences.nodes || [])
      .filter((pull) => pull.state === "OPEN")
      .map((pull) => pull.number);
    const hasOpenPull = pullNumbers.length > 0 || nativeOpen.length > 0;
    let next = [...labels];
    if (hasOpenPull) {
      next = next.filter((label) => label !== config.linkedIssues.readyLabel);
      if (!next.includes(config.linkedIssues.waitLabel)) next.push(config.linkedIssues.waitLabel);
      if (!next.some((label) => label.startsWith(config.linkedIssues.statusPrefix))) next.push(config.linkedIssues.inProgressLabel);
    } else {
      next = next.filter((label) => ![config.linkedIssues.waitLabel, config.linkedIssues.inProgressLabel].includes(label));
    }
    if (JSON.stringify([...labels].sort()) !== JSON.stringify([...next].sort())) await client.setIssueLabels(number, next);
    results.push({ issue: number, trackingPulls: pullNumbers, nativePulls: nativeOpen, hasOpenPull });
  }
  return results;
}

function renderDashboard(milestones, issues, config) {
  const sections = [];
  for (const milestone of milestones.filter((item) => config.dashboard.milestones.includes(item.title))) {
    const scoped = issues.filter((issue) => issue.milestone?.number === milestone.number && !issue.pull_request);
    const open = scoped.filter((issue) => issue.state === "open");
    const groups = new Map();
    for (const issue of open) {
      const labels = issue.labels.map((label) => typeof label === "string" ? label : label.name);
      const status = labels.find((label) => label.startsWith(config.linkedIssues.statusPrefix)) || "Status: Unclassified";
      if (!groups.has(status)) groups.set(status, []);
      groups.get(status).push(issue);
    }
    const lines = [...groups].sort(([left], [right]) => left.localeCompare(right)).flatMap(([status, entries]) => [
      `### ${escapeMarkdownCell(status)}`,
      ...entries.sort((left, right) => left.number - right.number).map((issue) => `- #${issue.number} ${escapeMarkdownCell(issue.title)}`),
    ]);
    sections.push(`## ${escapeMarkdownCell(milestone.title)}

Open: ${milestone.open_issues} | Closed: ${milestone.closed_issues} | Due: ${milestone.due_on || "not set"}

${lines.join("\n") || "No open issues."}`);
  }
  return `${config.dashboard.marker}
# ${config.dashboard.title}

${sections.join("\n\n")}

_Updated deterministically by AsterCommunity Automation._`;
}

export async function updateMilestoneDashboard(client, config) {
  const milestones = await client.listMilestones("open");
  const issues = await client.listIssues("all");
  const body = renderDashboard(milestones, issues, config);
  const existing = issues.find((issue) => !issue.pull_request && issue.body?.includes(config.dashboard.marker));
  if (existing) await client.updateIssue(existing.number, { title: config.dashboard.title, body });
  else await client.createIssue({ title: config.dashboard.title, body });
  return { outcome: "updated_milestone_dashboard", milestones: config.dashboard.milestones };
}

async function reconcileIncidentIssues(client, config) {
  const repository = await client.getRepository();
  const incidents = await client.listOpenIssues([config.incidents.failureLabel]);
  const results = [];
  for (const issue of incidents.filter((item) => !item.pull_request)) {
    const branch = issue.body?.match(/\| Branch \| `([^`]+)` \|/)?.[1];
    if (!branch) continue;
    const branchState = await client.getBranch(branch);
    let body = issue.body;
    const latest = branchState.commit.sha;
    if (/\| Latest branch commit \|/.test(body)) {
      body = body.replace(/\| Latest branch commit \| `[^`]+` \|/, `| Latest branch commit | \`${latest}\` |`);
    } else {
      body = body.replace("| Latest run |", `| Latest branch commit | \`${latest}\` |\n| Latest run |`);
    }
    if (!/\| Verification status \|/.test(body)) {
      body = body.replace("| Recovery streak |", "| Verification status | awaiting_verification |\n| Recovery streak |");
    }
    if (body !== issue.body) await client.updateIssue(issue.number, { body });
    results.push({ issue: issue.number, branch, latest, defaultBranch: branch === repository.default_branch });
  }
  return results;
}

export async function reconcileRepository({ client, config }) {
  for (const [name, definition] of Object.entries(config.labels.definitions)) await client.ensureLabel(name, definition);
  const pulls = await client.listOpenPulls();
  const results = [];
  for (const pull of pulls) {
    results.push(await reconcilePullDiagnostics(client, pull, config));
    try {
      results.push(await updateReadiness(client, pull, config));
    } catch (error) {
      results.push({ outcome: "readiness_error", pull: pull.number, error: error.message });
    }
  }
  const tracking = await reconcileTrackingIssues(client, pulls, config);
  const incidents = await reconcileIncidentIssues(client, config);
  return { outcome: "reconciled_repository", pulls: pulls.length, tracking, incidents, results };
}
