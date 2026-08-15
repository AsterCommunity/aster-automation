import assert from "node:assert/strict";
import test from "node:test";

import { collectReadiness, updateReadiness } from "../src/pr-readiness.mjs";
import { config } from "./fixture-config.mjs";

function pull(overrides = {}) {
  return {
    number: 517,
    head: { sha: "abc123" },
    labels: [],
    ...overrides,
  };
}

function client(overrides = {}) {
  return {
    owner: "AsterCommunity",
    repo: "AsterDrive",
    graphql: async () => ({ data: { repository: { pullRequest: {
      isDraft: false,
      mergeable: "MERGEABLE",
      reviewDecision: null,
      reviews: { nodes: [{ state: "CHANGES_REQUESTED", submittedAt: "2026-01-01T00:00:00Z", author: { login: "reviewer" }, commit: { oid: "abc123" } }] },
      reviewThreads: { nodes: [] },
    } } } }),
    listCheckRuns: async () => [
      { id: 1, name: "PR Gate", status: "completed", conclusion: "success" },
      { id: 2, name: "codecov/patch", status: "completed", conclusion: "failure" },
    ],
    getPull: async () => pull(),
    listIssueComments: async () => [],
    createIssueComment: async () => {},
    updateIssueComment: async () => {},
    createCheckRun: async () => {},
    updateCheckRun: async () => {},
    ...overrides,
  };
}

test("readiness reports external checks and unresolved review threads without mutating reviews", async () => {
  const facts = await collectReadiness(client({
    graphql: async () => ({ data: { repository: { pullRequest: {
      isDraft: false,
      mergeable: "MERGEABLE",
      reviewDecision: "CHANGES_REQUESTED",
      reviews: { nodes: [{ state: "CHANGES_REQUESTED", submittedAt: "2026-01-01T00:00:00Z", author: { login: "reviewer" }, commit: { oid: "abc123" } }] },
      reviewThreads: { nodes: [{ isResolved: false, isOutdated: false }] },
    } } } }),
    }), pull(), config);
  assert.deepEqual(facts.blockers, [
    "codecov/patch: failure",
    "1 current review thread(s) unresolved",
    "Human review has requested changes",
  ]);
  assert.equal(facts.currentApprovals, 0);
});

test("readiness updates one check and one current-head report", async () => {
  const created = [];
  const comments = [];
  await updateReadiness(client({
    createCheckRun: async (body) => created.push(body),
    createIssueComment: async (_number, body) => comments.push(body),
  }), pull(), config);
  assert.equal(created[0].name, "PR Readiness");
  assert.equal(created[0].conclusion, "failure");
  assert.match(created[0].output.summary, /codecov\/patch/);
  assert.match(comments[0], /PR readiness for `abc123`/);
});
