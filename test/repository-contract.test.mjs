import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateRepositoryContract } from "../src/repository-contract.mjs";
import { config } from "./fixture-config.mjs";

test("repository contract validates workflow names, diagnostics subscriptions, and shared pin", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "aster-automation-contract-"));
  try {
    await mkdir(join(workspace, ".github", "workflows"), { recursive: true });
    const pin = "a".repeat(40);
    for (const workflow of config.workflows) {
      await writeFile(join(workspace, ".github", "workflows", `${workflow.name.replaceAll(" ", "-")}.yml`), `name: ${workflow.name}\nuses: AsterCommunity/aster-automation@${pin}\n`);
    }
    await writeFile(join(workspace, ".github", "workflows", "ci-diagnostics.yml"), `name: CI Diagnostics\non:\n  workflow_run:\n    workflows:\n${config.workflows.map((workflow) => `      - ${workflow.name}`).join("\n")}\n      types: [completed]\nuses: AsterCommunity/aster-automation@${pin}\n`);
    const result = await validateRepositoryContract({ workspace, config: { ...config, workflows: config.workflows } });
    assert.equal(result.outcome, "validated_repository_contract");
    assert.equal(result.automationPin, pin);
    assert.equal(result.mutableActionPins.length, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
