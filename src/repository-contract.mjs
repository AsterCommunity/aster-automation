import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

function workflowName(source) {
  return source.match(/^name:\s*(.+)$/m)?.[1]?.trim();
}

function subscribedWorkflows(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^  workflow_run:\s*$/.test(line));
  if (start < 0) return [];
  const workflows = lines.findIndex((line, index) => index > start && /^    workflows:\s*$/.test(line));
  if (workflows < 0) return [];
  const names = [];
  for (let index = workflows + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^      -\s+(.+)$/);
    if (!match) break;
    names.push(match[1].trim());
  }
  return names;
}

export async function validateRepositoryContract({ workspace, config }) {
  const root = join(workspace, ".github", "workflows");
  const files = (await readdir(root)).filter((name) => /\.ya?ml$/.test(name));
  const workflows = [];
  const pins = new Set();
  const mutableActionPins = [];
  let subscriptions = [];
  for (const file of files) {
    const source = await readFile(join(root, file), "utf8");
    const name = workflowName(source);
    if (name) workflows.push(name);
    if (name === "CI Diagnostics") subscriptions = subscribedWorkflows(source);
    for (const match of source.matchAll(/uses:\s*AsterCommunity\/aster-automation@([^\s#]+)/g)) pins.add(match[1]);
    for (const match of source.matchAll(/uses:\s*[^\s@]+@([^\s#]+)/g)) {
      if (!/^[0-9a-f]{40}$/.test(match[1])) mutableActionPins.push({ file, pin: match[1] });
    }
  }
  const configured = config.workflows.map((workflow) => workflow.name);
  const missingWorkflows = configured.filter((name) => !workflows.includes(name));
  const missingSubscriptions = configured.filter((name) => !subscriptions.includes(name));
  if (missingWorkflows.length > 0) throw new Error(`configured workflows do not exist: ${missingWorkflows.join(", ")}`);
  if (missingSubscriptions.length > 0) throw new Error(`CI Diagnostics does not subscribe to: ${missingSubscriptions.join(", ")}`);
  if (pins.size !== 1 || !/^[0-9a-f]{40}$/.test([...pins][0] || "")) throw new Error("automation callers must share one immutable full SHA");
  return { outcome: "validated_repository_contract", workflowCount: workflows.length, automationPin: [...pins][0], mutableActionPins };
}
