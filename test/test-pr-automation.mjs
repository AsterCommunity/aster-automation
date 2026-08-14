import { runPrAutomation as run } from "../src/pr-automation.mjs";
import { config } from "./fixture-config.mjs";

export const runPrAutomation = (input) => run({ ...input, config });
