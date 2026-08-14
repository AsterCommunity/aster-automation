import { createHash } from "node:crypto";

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function globToRegex(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char !== "*") {
      source += escapeRegex(char);
      continue;
    }
    const isDouble = pattern[index + 1] === "*";
    if (!isDouble) {
      source += "[^/]*";
      continue;
    }
    index += 1;
    if (pattern[index + 1] === "/") {
      index += 1;
      source += "(?:.*/)?";
    } else {
      source += ".*";
    }
  }
  return new RegExp(`^${source}$`);
}

export function matchesAnyPath(path, patterns) {
  return patterns.some((pattern) => globToRegex(pattern).test(path));
}

export function labelsForFiles(files, config) {
  return config.labels.rules
    .filter((rule) => files.some((file) => matchesAnyPath(file, rule.paths)))
    .map((rule) => rule.label);
}

export function expectedWorkflows(files, config) {
  return config.workflows
    .filter((workflow) => files.some((file) => matchesAnyPath(file, workflow.paths)))
    .map((workflow) => workflow.name);
}

export function classifyCheckRuns(checkRuns, expectedNames) {
  const byWorkflow = new Map();
  for (const run of checkRuns) {
    if (!expectedNames.includes(run.workflowName)) continue;
    const current = byWorkflow.get(run.workflowName);
    if (!current || new Date(run.startedAt || 0) >= new Date(current.startedAt || 0)) byWorkflow.set(run.workflowName, run);
  }
  return expectedNames.map((name) => {
    const run = byWorkflow.get(name);
    if (!run) return { name, state: "pending", failedJobs: [] };
    const jobs = run.jobs || [];
    const failedJobs = jobs.filter((job) => ["failure", "timed_out", "action_required"].includes(job.conclusion));
    const cancelledJobs = jobs.filter((job) => ["cancelled", "stale"].includes(job.conclusion));
    const unfinishedJobs = jobs.filter((job) => job.status !== "completed");
    if (failedJobs.length > 0) return { ...run, name, state: "failure", failedJobs };
    if (cancelledJobs.length > 0) return { ...run, name, state: "cancelled", failedJobs: cancelledJobs };
    if (["failure", "timed_out", "action_required"].includes(run.conclusion)) return { ...run, name, state: "failure", failedJobs: [] };
    if (["cancelled", "stale"].includes(run.conclusion)) return { ...run, name, state: "cancelled", failedJobs: [] };
    if (run.status !== "completed" || unfinishedJobs.length > 0) return { ...run, name, state: "pending", failedJobs: [] };
    return { ...run, name, state: "success", failedJobs: [] };
  });
}

export function gateConclusion(workflows) {
  if (workflows.some((workflow) => ["failure", "cancelled"].includes(workflow.state))) {
    return { status: "completed", conclusion: "failure" };
  }
  if (workflows.some((workflow) => workflow.state === "pending")) return { status: "in_progress", conclusion: null };
  return { status: "completed", conclusion: "success" };
}

function statusIcon(state) {
  if (state === "success") return "PASS";
  if (state === "pending") return "WAIT";
  if (state === "cancelled") return "CANCELLED";
  return "FAIL";
}

function failedStep(job) {
  return job.steps?.find((step) => step.conclusion === "failure")?.name || "See job log";
}

export function escapeMarkdownCell(value) {
  return String(value ?? "-").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").replace(/[<>]/g, "");
}

export function diagnosticHints(workflows, config) {
  const text = workflows
    .flatMap((workflow) => workflow.failedJobs || [])
    .flatMap((job) => [job.name, ...((job.steps || []).map((step) => step.name))])
    .join(" ");
  return config.diagnosticHints
    .filter((hint) => new RegExp(hint.pattern, "i").test(text))
    .map((hint) => hint.message)
    .slice(0, 4);
}

export function renderDiagnosticsComment({ sha, workflows }, config) {
  const rows = workflows.map((workflow) => {
    const failed = workflow.failedJobs?.[0];
    const detail = failed ? `${escapeMarkdownCell(failed.name)}: ${escapeMarkdownCell(failedStep(failed))}` : "-";
    const url = failed?.htmlUrl || workflow.htmlUrl;
    return `| ${escapeMarkdownCell(workflow.name)} | ${statusIcon(workflow.state)} | ${url ? `[${detail}](${url})` : detail} |`;
  });
  const hints = diagnosticHints(workflows, config);
  const allPassed = workflows.every((workflow) => workflow.state === "success");
  const hintSection = hints.length > 0 ? `\n\n### Suggested checks\n\n${hints.map((hint) => `- ${hint}`).join("\n")}` : "";
  return `${config.gate.commentMarker}\n## ${allPassed ? "CI diagnostics resolved" : "CI diagnostics"} for \`${sha.slice(0, 12)}\`\n\n| Workflow | Result | First failing job/step |\n| --- | --- | --- |\n${rows.join("\n")}${hintSection}\n\n_This comment is updated in place for the latest PR head._`;
}

export function incidentFingerprint({ workflowName, branch, failedJobs }) {
  const normalizedJobs = [...failedJobs].map((job) => job.name).sort().join("|");
  return createHash("sha256").update(`${workflowName}\n${branch}\n${normalizedJobs}`).digest("hex").slice(0, 20);
}

export function incidentMarker(fingerprint, config) {
  return `<!-- ${config.gate.incidentMarkerPrefix}:${fingerprint} -->`;
}

export function renderIncidentBody({ fingerprint, workflowName, branch, runUrl, sha, failedJobs, occurrences = 1, recoveryStreak = 0 }, config) {
  const target = config.incidents.recoverySuccesses;
  const rows = failedJobs.map((job) => `| ${escapeMarkdownCell(job.name)} | ${escapeMarkdownCell(failedStep(job))} | [logs](${job.htmlUrl || runUrl}) |`);
  return `${incidentMarker(fingerprint, config)}\n## CI failure\n\n| Field | Value |\n| --- | --- |\n| Workflow | ${escapeMarkdownCell(workflowName)} |\n| Branch | \`${escapeMarkdownCell(branch)}\` |\n| Commit | \`${escapeMarkdownCell(sha)}\` |\n| Latest run | [open run](${runUrl}) |\n| Occurrences | ${occurrences} |\n| Recovery streak | ${recoveryStreak} / ${target} |\n\n### Failed jobs\n\n| Job | Failed step | Details |\n| --- | --- | --- |\n${rows.join("\n")}\n\nThis issue is updated by trusted automation and closes after ${target} consecutive successful runs of the same workflow and branch.`;
}

export function parseIncidentState(body) {
  const occurrences = Number(body.match(/\| Occurrences \| (\d+) \|/)?.[1] || 0);
  const recoveryStreak = Number(body.match(/\| Recovery streak \| (\d+) \/ \d+ \|/)?.[1] || 0);
  return { occurrences, recoveryStreak };
}

export function isInfrastructureFailure(failedJobs) {
  const content = failedJobs.flatMap((job) => [job.name, ...((job.steps || []).map((step) => step.name))]).join(" ").toLowerCase();
  return /runner|docker availability|disk|network|timeout|rate limit|connection reset/.test(content);
}

export function incidentMatchesWorkflow(issueBody, workflowName, branch) {
  return issueBody?.includes(`| Workflow | ${escapeMarkdownCell(workflowName)} |`) &&
    issueBody?.includes(`| Branch | \`${escapeMarkdownCell(branch)}\` |`);
}
