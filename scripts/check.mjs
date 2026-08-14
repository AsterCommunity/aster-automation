import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

async function modules(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => join(directory, entry.name));
}

function check(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", file], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${file} failed syntax validation`)));
  });
}

for (const file of [...await modules("src"), ...await modules("test")]) await check(file);
