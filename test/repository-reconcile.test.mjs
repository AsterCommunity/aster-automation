import assert from "node:assert/strict";
import test from "node:test";

import { trackingIssueNumbers, updateMilestoneDashboard } from "../src/repository-reconcile.mjs";
import { config } from "./fixture-config.mjs";

test("tracking issue syntax is strict and deduplicated", () => {
  assert.deepEqual(trackingIssueNumbers("Tracking-Issue: #519\nTracking-Issue: #519\nRelated to #20", config), [519]);
});

test("milestone dashboard is updated in place", async () => {
  const updates = [];
  const client = {
    listMilestones: async () => [{ number: 4, title: "v0.5.0", open_issues: 1, closed_issues: 2, due_on: "2026-08-19" }],
    listIssues: async () => [{ number: 1, state: "open", title: "Release item", milestone: { number: 4 }, labels: [{ name: "Status: Ready" }] }, {
      number: 99, state: "open", title: "Dashboard", body: config.dashboard.marker, labels: [],
    }],
    updateIssue: async (number, body) => updates.push({ number, body }),
    createIssue: async () => assert.fail("dashboard should be updated in place"),
  };
  const result = await updateMilestoneDashboard(client, config);
  assert.equal(result.outcome, "updated_milestone_dashboard");
  assert.equal(updates[0].number, 99);
  assert.match(updates[0].body.body, /#1 Release item/);
});
