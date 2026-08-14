import { readFileSync } from "node:fs";

import { validateConfig } from "../src/config.mjs";

export const config = validateConfig(JSON.parse(readFileSync(new URL("../examples/asterdrive.json", import.meta.url), "utf8")));
