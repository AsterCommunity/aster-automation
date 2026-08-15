import { readFile } from "node:fs/promises";

import { runCiDiagnostics } from "./ci-diagnostics.mjs";
import { loadConfig } from "./config.mjs";
import { GitHubClient } from "./github-client.mjs";
import { runPrAutomation } from "./pr-automation.mjs";
import { updateReadiness } from "./pr-readiness.mjs";
import { reconcileRepository, updateMilestoneDashboard } from "./repository-reconcile.mjs";
import { validateRepositoryContract } from "./repository-contract.mjs";

function input(name) {
  return process.env[`INPUT_${name.toUpperCase()}`] || "";
}

const mode = input("MODE");
const config = await loadConfig({
  workspace: process.env.GITHUB_WORKSPACE,
  configPath: input("CONFIG-PATH") || ".github/aster-automation.json",
});

let result;
if (mode === "validate-config") {
  result = { outcome: "validated_config" };
} else if (mode === "validate-repository") {
  result = await validateRepositoryContract({ workspace: process.env.GITHUB_WORKSPACE, config });
} else {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const client = new GitHubClient({
    token: input("TOKEN"),
    repository: process.env.GITHUB_REPOSITORY,
    apiUrl: process.env.GITHUB_API_URL,
  });
  if (mode === "pr-automation") result = await runPrAutomation({ client, event, config });
  else if (mode === "ci-diagnostics") result = await runCiDiagnostics({ client, event, config });
  else if (mode === "reconcile-repository") result = await reconcileRepository({ client, config });
  else if (mode === "milestone-dashboard") result = await updateMilestoneDashboard(client, config);
  else if (mode === "pr-readiness") {
    const number = Number(event.inputs?.pull_request_number || event.pull_request?.number);
    if (!Number.isInteger(number) || number <= 0) throw new Error("pr-readiness requires a positive pull_request_number");
    result = await updateReadiness(client, { number }, config);
  }
  else throw new Error(`unsupported automation mode: ${mode}`);
}
process.stdout.write(`${JSON.stringify(result)}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `## AsterCommunity Automation\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
}
