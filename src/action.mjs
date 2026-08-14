import { readFile } from "node:fs/promises";

import { runCiDiagnostics } from "./ci-diagnostics.mjs";
import { loadConfig } from "./config.mjs";
import { GitHubClient } from "./github-client.mjs";
import { runPrAutomation } from "./pr-automation.mjs";

function input(name) {
  return process.env[`INPUT_${name.toUpperCase()}`] || "";
}

const mode = input("MODE");
const config = await loadConfig({
  workspace: process.env.GITHUB_WORKSPACE,
  configPath: input("CONFIG-PATH") || ".github/aster-automation.json",
});

if (mode === "validate-config") {
  process.stdout.write("Automation configuration is valid.\n");
} else {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const client = new GitHubClient({
    token: input("TOKEN"),
    repository: process.env.GITHUB_REPOSITORY,
    apiUrl: process.env.GITHUB_API_URL,
  });
  if (mode === "pr-automation") await runPrAutomation({ client, event, config });
  else if (mode === "ci-diagnostics") await runCiDiagnostics({ client, event, config });
  else throw new Error(`unsupported automation mode: ${mode}`);
}
