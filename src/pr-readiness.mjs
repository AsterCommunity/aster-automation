import { escapeMarkdownCell } from "./automation-core.mjs";

function readinessQuery() {
  return `query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        isDraft
        mergeable
        reviewDecision
        reviews(last: 100) { nodes { state submittedAt commit { oid } author { login } } }
        reviewThreads(first: 100) { nodes { isResolved isOutdated } }
      }
    }
  }`;
}

function latestReviewsByAuthor(reviews) {
  const latest = new Map();
  for (const review of reviews || []) {
    const login = review.author?.login;
    if (!login) continue;
    const current = latest.get(login);
    if (!current || new Date(review.submittedAt) >= new Date(current.submittedAt)) latest.set(login, review);
  }
  return [...latest.values()];
}

function humanReview(review) {
  return !review.author?.login?.endsWith("[bot]");
}

function latestChecks(checks, excludedName) {
  const latest = new Map();
  for (const check of checks) {
    if (check.name === excludedName) continue;
    const current = latest.get(check.name);
    if (!current || check.id > current.id) latest.set(check.name, check);
  }
  return latest;
}

export async function collectReadiness(client, pull, config) {
  const response = await client.graphql(readinessQuery(), { owner: client.owner, repo: client.repo, number: pull.number });
  const facts = response.data.repository.pullRequest;
  const checks = latestChecks(await client.listCheckRuns(pull.head.sha), config.readiness.name);
  const blockers = [];
  const waiting = [];
  const warnings = [];
  if (facts.isDraft) blockers.push("Pull request is a draft");
  if (facts.mergeable === "CONFLICTING") blockers.push("Pull request has merge conflicts");
  if (!facts.mergeable || facts.mergeable === "UNKNOWN") waiting.push("Mergeability: waiting");
  for (const name of [config.gate.name, ...config.readiness.requiredChecks]) {
    const check = checks.get(name);
    if (!check || check.status !== "completed") waiting.push(`${name}: waiting`);
    else if (check.conclusion !== "success") blockers.push(`${name}: ${check.conclusion || "failed"}`);
  }
  const currentThreads = (facts.reviewThreads.nodes || []).filter((thread) => !thread.isResolved && !thread.isOutdated).length;
  if (config.readiness.requireResolvedThreads && currentThreads > 0) blockers.push(`${currentThreads} current review thread(s) unresolved`);
  const reviews = latestReviewsByAuthor(facts.reviews.nodes).filter(humanReview);
  if (facts.reviewDecision === "CHANGES_REQUESTED" && reviews.some((review) => review.state === "CHANGES_REQUESTED")) blockers.push("Human review has requested changes");
  const currentApprovals = reviews.filter((review) => review.state === "APPROVED" && review.commit?.oid === pull.head.sha).length;
  const highRisk = pull.labels.some((label) => label.name === config.readiness.highRiskLabel);
  if ((config.readiness.requireApproval || highRisk) && currentApprovals < 1) blockers.push("Current head requires a human approval");
  for (const label of pull.labels.map((item) => item.name)) {
    const targets = config.labels.applicability[label];
    if (targets && !targets.includes("pull_request")) warnings.push(`Label ${label} does not apply to pull requests`);
  }
  const staleReviews = reviews.filter((review) => review.commit?.oid && review.commit.oid !== pull.head.sha).length;
  return { blockers, waiting, warnings, currentThreads, currentApprovals, staleReviews, mergeable: facts.mergeable };
}

function renderSummary(facts) {
  const rows = [
    ["Blocking conditions", facts.blockers.length],
    ["Waiting conditions", facts.waiting.length],
    ["Current unresolved threads", facts.currentThreads],
    ["Current-head approvals", facts.currentApprovals],
    ["Stale latest reviews", facts.staleReviews],
  ].map(([name, value]) => `| ${name} | ${value} |`);
  const details = [
    ...facts.blockers.map((item) => `- BLOCK: ${escapeMarkdownCell(item)}`),
    ...facts.waiting.map((item) => `- WAIT: ${escapeMarkdownCell(item)}`),
    ...facts.warnings.map((item) => `- WARN: ${escapeMarkdownCell(item)}`),
  ];
  return `| Fact | Value |
| --- | --- |
${rows.join("\n")}

${details.length > 0 ? details.join("\n") : "All configured readiness conditions are satisfied."}`;
}

export async function updateReadiness(client, pull, config) {
  const current = await client.getPull(pull.number);
  const facts = await collectReadiness(client, current, config);
  const status = facts.waiting.length > 0 && facts.blockers.length === 0 ? "in_progress" : "completed";
  const conclusion = status === "completed" ? (facts.blockers.length > 0 ? "failure" : "success") : null;
  const body = {
    name: config.readiness.name,
    head_sha: current.head.sha,
    status,
    output: {
      title: conclusion === "success" ? "Pull request is ready" : conclusion === "failure" ? "Pull request is blocked" : "Pull request readiness is waiting",
      summary: renderSummary(facts),
    },
  };
  if (conclusion) body.conclusion = conclusion;
  const existing = (await client.listCheckRuns(current.head.sha))
    .filter((check) => check.name === config.readiness.name)
    .sort((left, right) => right.id - left.id)[0];
  if (!existing || existing.status === "completed") {
    if (!existing || existing.conclusion !== conclusion) await client.createCheckRun(body);
    else {
      const update = { ...body };
      delete update.name;
      delete update.head_sha;
      await client.updateCheckRun(existing.id, update);
    }
  } else {
    const update = { ...body };
    delete update.name;
    delete update.head_sha;
    await client.updateCheckRun(existing.id, update);
  }
  const comments = await client.listIssueComments(current.number);
  const old = comments.find((comment) => comment.body?.includes(config.readiness.commentMarker));
  const comment = `${config.readiness.commentMarker}
## PR readiness for \`${current.head.sha.slice(0, 12)}\`

${renderSummary(facts)}

_This report is deterministic and updated for the current pull request head._`;
  if (old) await client.updateIssueComment(old.id, comment);
  else await client.createIssueComment(current.number, comment);
  return { outcome: "reconciled_pull_readiness", pull: current.number, sha: current.head.sha, status, conclusion, ...facts };
}
