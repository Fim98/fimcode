#!/usr/bin/env bun
/**
 * 统一发布入口脚本
 *
 * 协调版本、构建、发布流程
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// 项目配置
const PROJECT_NAME = "fimcode";
const NPM_SCOPE = ""; // npm 包名不使用 scope

// 脚本参数
const args = process.argv.slice(2);
const command = args[0] || "all";

// 环境变量
const env = {
  version: process.env.VERSION || "",
  channel: process.env.CHANNEL || "latest",
  release: process.env.RELEASE === "true",
  npmToken: process.env.NPM_TOKEN || "",
  ghToken: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "",
};

/**
 * 运行脚本
 */
function runScript(script: string, extraEnv?: Record<string, string>): boolean {
  console.log(`\n▶️  运行 ${script}...`);

  const result = spawnSync("bun", [script], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  return result.status === 0;
}

/**
 * 读取版本信息
 */
function loadVersionInfo(): { version: string; channel: string } | null {
  const versionFile = path.join("dist", "version.txt");
  if (!existsSync(versionFile)) {
    return null;
  }

  const content = readFileSync(versionFile, "utf-8");
  const lines = content.split("\n");

  const info: Record<string, string> = {};
  for (const line of lines) {
    const [key, value] = line.split("=");
    if (key && value) {
      info[key] = value;
    }
  }

  return {
    version: info.VERSION || "0.0.0",
    channel: info.CHANNEL || "dev",
  };
}

/**
 * 发布到 npm
 */
async function publishToNpm(): Promise<boolean> {
  console.log("\n📦 发布到 npm...");

  const pkgPath = path.join(process.cwd(), "package.json");
  if (!existsSync(pkgPath)) {
    console.error("❌ package.json 不存在");
    return false;
  }

  // 更新 package.json 版本
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const info = loadVersionInfo();

  if (info) {
    pkg.version = info.version;
  }

  // 移除 private 标记以便发布
  delete pkg.private;

  // 写入临时 package.json
  const { writeFileSync } = await import("node:fs");
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  // 发布
  const result = spawnSync("npm", ["publish", "--access", "public"], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: {
      ...process.env,
      NPM_TOKEN: env.npmToken,
    },
  });

  // 恢复 private 标记
  pkg.private = true;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  return result.status === 0;
}

/**
 * 发布 GitHub Release
 */
async function publishGitHubRelease(): Promise<boolean> {
  console.log("\n📤 发布 GitHub Release...");

  const info = loadVersionInfo();
  if (!info) {
    console.error("❌ 版本信息不存在，请先运行 version 脚本");
    return false;
  }

  const tag = `v${info.version}`;

  // 发布草稿 Release
  const result = spawnSync("gh", ["release", "edit", tag, "--draft=false"], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: {
      ...process.env,
      GH_TOKEN: env.ghToken,
    },
  });

  return result.status === 0;
}

/**
 * 执行完整发布流程
 */
async function publishAll(): Promise<boolean> {
  console.log("🚀 开始完整发布流程...");

  // 1. 计算版本
  if (!runScript("./scripts/version.ts")) {
    console.error("❌ 版本计算失败");
    return false;
  }

  const info = loadVersionInfo();
  if (!info) {
    console.error("❌ 无法读取版本信息");
    return false;
  }

  console.log(`\n📦 版本: ${info.version}, 渠道: ${info.channel}`);

  // 2. 构建
  if (!runScript("./scripts/build.ts", {
    VERSION: info.version,
    CHANNEL: info.channel,
    RELEASE: "true",
  })) {
    console.error("❌ 构建失败");
    return false;
  }

  // 3. 发布到 npm（仅 latest 渠道）
  if (info.channel === "latest" && env.npmToken) {
    if (!await publishToNpm()) {
      console.error("❌ npm 发布失败");
      return false;
    }
  }

  // 4. 发布 GitHub Release
  if (!await publishGitHubRelease()) {
    console.error("❌ GitHub Release 发布失败");
    return false;
  }

  return true;
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log("🚀 FimCode 发布脚本");
  console.log(`   命令: ${command}`);

  let success = false;

  switch (command) {
    case "version":
      success = runScript("./scripts/version.ts");
      break;

    case "build":
      success = runScript("./scripts/build.ts");
      break;

    case "npm":
      success = await publishToNpm();
      break;

    case "github":
      success = await publishGitHubRelease();
      break;

    case "all":
      success = await publishAll();
      break;

    default:
      console.error(`❌ 未知命令: ${command}`);
      console.log("可用命令: version, build, npm, github, all");
      process.exit(1);
  }

  if (success) {
    console.log("\n✅ 发布完成！");
    process.exit(0);
  } else {
    console.error("\n❌ 发布失败");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ 发布脚本错误:", error);
  process.exit(1);
});
