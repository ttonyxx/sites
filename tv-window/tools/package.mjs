#!/usr/bin/env node
// Zips ../channel into dist/window.zip — the file Roku's Development Application Installer takes.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const CHANNEL = path.resolve(TOOLS, "../channel");
export const ZIP = path.join(TOOLS, "dist", "window.zip");

export function buildPackage({ quiet = false } = {}) {
  fs.mkdirSync(path.dirname(ZIP), { recursive: true });
  fs.rmSync(ZIP, { force: true });
  execFileSync("zip", ["-q", "-r", "-9", "-X", ZIP, ".", "-x", ".*", "-x", "*/.*"], { cwd: CHANNEL });
  if (!quiet) console.log(`Packaged ${path.relative(process.cwd(), ZIP)} (${(fs.statSync(ZIP).size / 1024).toFixed(0)} KB)`);
  return ZIP;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildPackage();
