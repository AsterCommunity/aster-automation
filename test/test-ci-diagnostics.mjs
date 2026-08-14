import { runCiDiagnostics as run } from "../src/ci-diagnostics.mjs";
import { config } from "./fixture-config.mjs";

export const runCiDiagnostics = (input) => run({ ...input, config });
