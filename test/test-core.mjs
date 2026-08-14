import * as core from "../src/automation-core.mjs";
import { config } from "./fixture-config.mjs";

export const classifyCheckRuns = core.classifyCheckRuns;
export const escapeMarkdownCell = core.escapeMarkdownCell;
export const gateConclusion = core.gateConclusion;
export const globToRegex = core.globToRegex;
export const incidentFingerprint = core.incidentFingerprint;
export const parseIncidentState = core.parseIncidentState;
export const expectedWorkflows = (files) => core.expectedWorkflows(files, config);
export const labelsForFiles = (files) => core.labelsForFiles(files, config);
export const renderDiagnosticsComment = (input) => core.renderDiagnosticsComment(input, config);
export const renderIncidentBody = (input) => core.renderIncidentBody(input, config);
