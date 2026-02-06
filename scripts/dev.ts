#!/usr/bin/env bun
/**
 * 开发启动脚本
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("bun", ["./src/cli/index.ts"], {
  stdio: "inherit",
  cwd: process.cwd(),
});

process.exit(result.status ?? 0);
