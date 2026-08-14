import assert from "node:assert/strict";
import test from "node:test";

import { managedPullLabels, validateConfig } from "../src/config.mjs";
import { config } from "./fixture-config.mjs";

test("AsterDrive example satisfies the runtime configuration contract", () => {
  assert.equal(validateConfig(config), config);
  assert.ok(managedPullLabels(config).includes("Risk: High"));
  assert.ok(managedPullLabels(config).includes("CI: Running"));
  assert.ok(!managedPullLabels(config).includes("Priority: High"));
});

test("configuration rejects unsupported versions and malformed regular expressions", () => {
  assert.throws(() => validateConfig({ ...config, version: 2 }), /version must be 1/);
  assert.throws(
    () => validateConfig({ ...config, diagnosticHints: [{ pattern: "[", message: "broken" }] }),
    /pattern is invalid/,
  );
});

test("configuration requires managed label definitions and unique workflow names", () => {
  const definitions = { ...config.labels.definitions };
  delete definitions[config.gate.runningLabel];
  assert.throws(() => validateConfig({ ...config, labels: { ...config.labels, definitions } }), /managed label/);
  assert.throws(
    () => validateConfig({ ...config, workflows: [...config.workflows, config.workflows[0]] }),
    /workflow names must be unique/,
  );
});
