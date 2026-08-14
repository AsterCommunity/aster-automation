import {
  classifyCheckRuns,
  expectedWorkflows,
  gateConclusion,
  incidentFingerprint,
  incidentMarker,
  incidentMatchesWorkflow,
  isInfrastructureFailure,
  parseIncidentState,
  renderDiagnosticsComment,
  renderIncidentBody,
} from "./automation-core.mjs";

function normalizeJob(job) {
  return { name: job.name, status: job.status, conclusion: job.conclusion, htmlUrl: job.html_url, steps: job.steps || [] };
}

async function collectWorkflowRuns(client, sha, expectedNames, config) {
  const checkRuns = await client.listCheckRuns(sha);
  const workflowRuns = new Map();
  for (const check of checkRuns) {
    const details = check.details_url || "";
    const match = details.match(/\/actions\/runs\/(\d+)/);
    if (!match) continue;
    const runId = Number(match[1]);
    if (workflowRuns.has(runId)) continue;
    const run = await client.getWorkflowRun(runId);
    if (!expectedNames.includes(run.name) || run.head_sha !== sha) continue;
    const jobs = (await client.listWorkflowRunJobs(runId))
      .filter((job) => job.name !== config.gate.name)
      .map(normalizeJob);
    workflowRuns.set(runId, {
      workflowName: run.name,
      status: run.status,
      conclusion: run.conclusion,
      startedAt: run.run_started_at || run.created_at,
      htmlUrl: run.html_url,
      jobs,
    });
  }
  return [...workflowRuns.values()];
}

async function upsertGate(client, sha, workflows, config) {
  const state = gateConclusion(workflows);
  const existing = (await client.listCheckRuns(sha))
    .filter((run) => run.name === config.gate.name)
    .sort((left, right) => right.id - left.id)[0];
  const body = {
    name: config.gate.name,
    head_sha: sha,
    status: state.status,
    output: {
      title: state.conclusion === "success" ? "Required CI completed" : state.conclusion === "failure" ? "Required CI failed" : "Waiting for required CI",
      summary: workflows.length === 0
        ? "No path-filtered CI workflows are required for this change."
        : workflows.map((workflow) => `${workflow.name}: ${workflow.state}`).join("\n"),
    },
  };
  if (state.conclusion) body.conclusion = state.conclusion;
  if (existing) {
    if (existing.status === "completed") {
      if (state.status === "completed" && existing.conclusion === state.conclusion) return existing;
      return client.createCheckRun(body);
    }
    delete body.name;
    delete body.head_sha;
    return client.updateCheckRun(existing.id, body);
  }
  return client.createCheckRun(body);
}

async function updatePrDiagnostics(client, pull, config) {
  const current = await client.getPull(pull.number);
  const sha = current.head.sha;
  const files = (await client.listPullFiles(pull.number)).map((file) => file.filename);
  const expected = expectedWorkflows(files, config);
  const workflows = classifyCheckRuns(await collectWorkflowRuns(client, sha, expected, config), expected);
  const gateState = gateConclusion(workflows);
  await upsertGate(client, sha, workflows, config);
  const labels = current.labels.map((label) => label.name)
    .filter((label) => ![config.gate.runningLabel, config.gate.passedLabel].includes(label));
  if (gateState.status === "in_progress") labels.push(config.gate.runningLabel);
  if (expected.length > 0 && gateState.conclusion === "success") labels.push(config.gate.passedLabel);
  await client.setIssueLabels(current.number, labels);
  const comments = await client.listIssueComments(pull.number);
  const existing = comments.find((comment) => comment.body?.includes(config.gate.commentMarker));
  const body = renderDiagnosticsComment({ sha, workflows }, config);
  if (existing) await client.updateIssueComment(existing.id, body);
  else await client.createIssueComment(pull.number, body);
}

function recoveryPattern(config) {
  return new RegExp(`\\| Recovery streak \\| \\d+ \\/ ${config.incidents.recoverySuccesses} \\|`);
}

async function updateIncidentOnFailure(client, run, jobs, config) {
  const failedJobs = jobs.filter((job) => ["failure", "timed_out", "action_required"].includes(job.conclusion));
  if (failedJobs.length === 0) failedJobs.push({
    name: "Workflow-level failure",
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
    steps: [],
  });
  const fingerprint = incidentFingerprint({ workflowName: run.name, branch: run.head_branch, failedJobs });
  const marker = incidentMarker(fingerprint, config);
  const issues = await client.listOpenIssues([config.incidents.failureLabel]);
  const relatedIssues = issues.filter((issue) => !issue.pull_request && incidentMatchesWorkflow(issue.body, run.name, run.head_branch));
  const existing = issues.find((issue) => issue.body?.includes(marker));
  const state = existing ? parseIncidentState(existing.body) : { occurrences: 0, recoveryStreak: 0 };
  const body = renderIncidentBody({
    fingerprint,
    workflowName: run.name,
    branch: run.head_branch,
    runUrl: run.html_url,
    sha: run.head_sha,
    failedJobs,
    occurrences: state.occurrences + 1,
    recoveryStreak: 0,
  }, config);
  const labels = [config.incidents.failureLabel];
  if (isInfrastructureFailure(failedJobs)) labels.push(config.incidents.infrastructureLabel);
  for (const issue of relatedIssues) {
    if (issue.number === existing?.number) continue;
    const resetBody = issue.body.replace(recoveryPattern(config), `| Recovery streak | 0 / ${config.incidents.recoverySuccesses} |`);
    if (resetBody !== issue.body) await client.updateIssue(issue.number, { body: resetBody });
  }
  if (existing) await client.updateIssue(existing.number, { body, labels });
  else await client.createIssue({ title: `[CI] ${run.name} failed on ${run.head_branch}`, body, labels });
}

async function updateIncidentOnSuccess(client, run, config) {
  const issues = await client.listOpenIssues([config.incidents.failureLabel]);
  const matching = issues.filter((issue) => !issue.pull_request && incidentMatchesWorkflow(issue.body, run.name, run.head_branch));
  for (const issue of matching) {
    const state = parseIncidentState(issue.body);
    const nextStreak = state.recoveryStreak + 1;
    const body = issue.body.replace(
      recoveryPattern(config),
      `| Recovery streak | ${nextStreak} / ${config.incidents.recoverySuccesses} |`,
    );
    const recovered = nextStreak >= config.incidents.recoverySuccesses;
    await client.updateIssue(issue.number, {
      body,
      state: recovered ? "closed" : "open",
      state_reason: recovered ? "completed" : undefined,
    });
  }
}

export async function runCiDiagnostics({ client, event, config }) {
  for (const [name, definition] of Object.entries(config.labels.definitions)) await client.ensureLabel(name, definition);
  const dispatchedRunId = event.inputs?.workflow_run_id;
  const numericRunId = Number(dispatchedRunId);
  if (!event.workflow_run && (!Number.isInteger(numericRunId) || numericRunId <= 0)) {
    throw new Error("workflow_run payload or a positive workflow_run_id is required");
  }
  const run = event.workflow_run || await client.getWorkflowRun(numericRunId);
  if (!run) throw new Error("workflow_run payload is required");
  const candidates = run.pull_requests?.length > 0 ? run.pull_requests : await client.listPullsForCommit(run.head_sha);
  const openPulls = [];
  for (const candidate of candidates) {
    const pull = await client.getPull(candidate.number);
    if (pull.state === "open" && pull.head.sha === run.head_sha) openPulls.push(pull);
  }
  if (openPulls.length > 0 && run.event === "pull_request") {
    for (const pull of openPulls) await updatePrDiagnostics(client, pull, config);
    return;
  }
  const repositoryDefaultBranch = event.repository.default_branch;
  if (run.event !== "schedule" && run.head_branch !== repositoryDefaultBranch) return;
  const jobs = (await client.listWorkflowRunJobs(run.id)).map(normalizeJob);
  if (["failure", "timed_out", "action_required"].includes(run.conclusion)) await updateIncidentOnFailure(client, run, jobs, config);
  else if (run.conclusion === "success") await updateIncidentOnSuccess(client, run, config);
}
