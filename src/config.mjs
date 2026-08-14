import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const MAX_CONFIG_BYTES = 256 * 1024;

function requireString(value, path) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function requireStringArray(value, path) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${path} must be an array of non-empty strings`);
  }
  return value;
}

function validateRules(rules, path) {
  if (!Array.isArray(rules)) throw new Error(`${path} must be an array`);
  for (const [index, rule] of rules.entries()) {
    requireString(rule?.label, `${path}[${index}].label`);
    requireStringArray(rule?.paths, `${path}[${index}].paths`);
  }
}

export function validateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("configuration must be an object");
  if (config.version !== 1) throw new Error("configuration version must be 1");
  requireString(config.gate?.name, "gate.name");
  requireString(config.gate?.commentMarker, "gate.commentMarker");
  requireString(config.gate?.incidentMarkerPrefix, "gate.incidentMarkerPrefix");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(config.gate.incidentMarkerPrefix)) {
    throw new Error("gate.incidentMarkerPrefix must contain lowercase letters, digits, and hyphens");
  }
  requireString(config.gate?.runningLabel, "gate.runningLabel");
  requireString(config.gate?.passedLabel, "gate.passedLabel");
  validateRules(config.labels?.rules, "labels.rules");
  if (!config.labels?.definitions || typeof config.labels.definitions !== "object" || Array.isArray(config.labels.definitions)) {
    throw new Error("labels.definitions must be an object");
  }
  for (const [name, definition] of Object.entries(config.labels.definitions)) {
    requireString(name, "labels.definitions key");
    if (!/^[0-9A-Fa-f]{6}$/.test(definition?.color || "")) throw new Error(`label ${name} must have a six-digit color`);
    requireString(definition?.description, `labels.definitions.${name}.description`);
  }
  if (!Array.isArray(config.workflows)) throw new Error("workflows must be an array");
  for (const [index, workflow] of config.workflows.entries()) {
    requireString(workflow?.name, `workflows[${index}].name`);
    requireStringArray(workflow?.paths, `workflows[${index}].paths`);
  }
  for (const key of ["priorityPrefix", "statusPrefix", "waitLabel", "readyLabel", "inProgressLabel", "mergedLabel"]) {
    requireString(config.linkedIssues?.[key], `linkedIssues.${key}`);
  }
  requireStringArray(config.linkedIssues?.mergedPullLabelsToRemove, "linkedIssues.mergedPullLabelsToRemove");
  requireString(config.incidents?.failureLabel, "incidents.failureLabel");
  requireString(config.incidents?.infrastructureLabel, "incidents.infrastructureLabel");
  if (!Number.isInteger(config.incidents?.recoverySuccesses) || config.incidents.recoverySuccesses < 1) {
    throw new Error("incidents.recoverySuccesses must be a positive integer");
  }
  for (const name of [
    config.gate.runningLabel,
    config.gate.passedLabel,
    config.incidents.failureLabel,
    config.incidents.infrastructureLabel,
  ]) {
    if (!Object.hasOwn(config.labels.definitions, name)) throw new Error(`labels.definitions must define managed label ${name}`);
  }
  const workflowNames = config.workflows.map((workflow) => workflow.name);
  if (new Set(workflowNames).size !== workflowNames.length) throw new Error("workflow names must be unique");
  if (!Array.isArray(config.diagnosticHints)) throw new Error("diagnosticHints must be an array");
  for (const [index, hint] of config.diagnosticHints.entries()) {
    const pattern = requireString(hint?.pattern, `diagnosticHints[${index}].pattern`);
    requireString(hint?.message, `diagnosticHints[${index}].message`);
    try {
      new RegExp(pattern, "i");
    } catch (error) {
      throw new Error(`diagnosticHints[${index}].pattern is invalid: ${error.message}`);
    }
  }
  return config;
}

export async function loadConfig({ workspace, configPath }) {
  requireString(workspace, "workspace");
  requireString(configPath, "configPath");
  if (isAbsolute(configPath)) throw new Error("configPath must be repository-relative");
  const root = resolve(workspace);
  const path = resolve(root, configPath);
  const traversal = relative(root, path);
  if (traversal.startsWith("..") || isAbsolute(traversal)) throw new Error("configPath must stay inside GITHUB_WORKSPACE");
  const source = await readFile(path, "utf8");
  if (Buffer.byteLength(source) > MAX_CONFIG_BYTES) throw new Error("automation configuration exceeds 256 KiB");
  return validateConfig(JSON.parse(source));
}

export function managedPullLabels(config) {
  return [...new Set([
    ...config.labels.rules.map((rule) => rule.label),
    config.gate.runningLabel,
    config.gate.passedLabel,
  ])];
}
