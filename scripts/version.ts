#!/usr/bin/env bun
/**
 * 版本管理和 GitHub Release 创建脚本
 *
 * 功能：
 * 1. 根据分支和环境变量计算版本号
 * 2. 生成 changelog
 * 3. 创建 GitHub Release 草稿
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

// 项目配置
const PROJECT_NAME = "fimcode";
const GITHUB_REPO = "Fim98/fimcode";

// 脚本参数解析
const Script = {
  // 环境变量优先
  version: process.env.VERSION,
  bump: process.env.BUMP || process.env.OPENCODE_BUMP || "patch",
  // GitHub Actions 环境
  ghToken: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  ref: process.env.GITHUB_REF_NAME || getCurrentBranch(),
  sha: process.env.GITHUB_SHA || getCurrentSha(),
  // 输出
  output: process.env.OUTPUT || "./dist/version.txt",
};

/**
 * 获取当前 Git 分支
 */
function getCurrentBranch(): string {
  const result = spawnSync("git", ["branch", "--show-current"], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "ignore"],
  });
  return result.stdout?.trim() || "unknown";
}

/**
 * 获取当前 Git commit SHA
 */
function getCurrentSha(): string {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "ignore"],
  });
  return result.stdout?.trim() || "unknown";
}

/**
 * 判断是否为预览版本（非 main/master 分支）
 */
function isPreviewBranch(branch: string): boolean {
  return branch !== "main" && branch !== "master";
}

/**
 * 获取渠道名称
 */
function getChannel(branch: string): string {
  if (branch === "main" || branch === "master") return "latest";
  if (branch === "dev") return "dev";
  if (branch === "beta") return "beta";
  if (branch.startsWith("snapshot-")) return branch.replace("snapshot-", "");
  return "dev";
}

/**
 * 从 npm registry 获取最新版本
 */
async function getLatestNpmVersion(): Promise<string | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${PROJECT_NAME}/latest`);
    if (!response.ok) return null;
    const data = await response.json() as { version: string };
    return data.version;
  } catch {
    return null;
  }
}

/**
 * 从 GitHub Releases 获取最新版本
 */
async function getLatestGitHubVersion(): Promise<string | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!response.ok) return null;
    const data = await response.json() as { tag_name: string };
    return data.tag_name.replace(/^v/, "");
  } catch {
    return null;
  }
}

/**
 * 递增版本号
 */
function bumpVersion(version: string, bump: string): string {
  const [major, minor, patch] = version.split(".").map(Number);

  switch (bump.toLowerCase()) {
    case "major":
      return `${(major ?? 0) + 1}.0.0`;
    case "minor":
      return `${major}.${(minor ?? 0) + 1}.0`;
    case "patch":
    default:
      return `${major}.${minor}.${(patch ?? 0) + 1}`;
  }
}

/**
 * 计算版本号
 */
async function calculateVersion(): Promise<{ version: string; channel: string; isRelease: boolean }> {
  // 1. 环境变量优先
  if (Script.version) {
    const channel = getChannel(Script.ref);
    return {
      version: Script.version,
      channel,
      isRelease: channel === "latest",
    };
  }

  const channel = getChannel(Script.ref);
  const isPreview = isPreviewBranch(Script.ref);

  // 2. Preview 版本（非 latest 分支）
  if (isPreview) {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
    return {
      version: `0.0.0-${channel}-${timestamp}`,
      channel,
      isRelease: false,
    };
  }

  // 3. 自动递增：从 npm registry 或 GitHub 获取最新版本 + 1
  let latestVersion = await getLatestNpmVersion();
  if (!latestVersion) {
    latestVersion = await getLatestGitHubVersion();
  }

  // 如果没有找到版本，从 1.0.0 开始
  if (!latestVersion) {
    latestVersion = "0.0.0";
  }

  const newVersion = bumpVersion(latestVersion, Script.bump);

  return {
    version: newVersion,
    channel: "latest",
    isRelease: true,
  };
}

/**
 * 获取上一个 release 的 tag
 */
function getPreviousRelease(): string | null {
  const result = spawnSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "ignore"],
  });
  return result.stdout?.trim() || null;
}

/**
 * 生成 changelog
 */
async function buildNotes(from: string | null, to: string): Promise<string> {
  // 获取提交历史
  const range = from ? `${from}..${to}` : to;
  const result = spawnSync("git", ["log", range, "--pretty=format:%s", "--no-merges"], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "ignore"],
  });

  const commits = result.stdout?.trim().split("\n").filter(Boolean) || [];

  // 分类提交
  const features: string[] = [];
  const fixes: string[] = [];
  const others: string[] = [];

  for (const commit of commits) {
    if (commit.startsWith("feat:") || commit.startsWith("feature:")) {
      features.push(commit.replace(/^feat(?:ure)?:\s*/, ""));
    } else if (commit.startsWith("fix:")) {
      fixes.push(commit.replace(/^fix:\s*/, ""));
    } else {
      others.push(commit);
    }
  }

  // 构建 notes
  const lines: string[] = [];

  if (features.length > 0) {
    lines.push("## ✨ Features");
    for (const feat of features) {
      lines.push(`- ${feat}`);
    }
    lines.push("");
  }

  if (fixes.length > 0) {
    lines.push("## 🐛 Bug Fixes");
    for (const fix of fixes) {
      lines.push(`- ${fix}`);
    }
    lines.push("");
  }

  if (others.length > 0) {
    lines.push("## 📝 Other Changes");
    for (const other of others.slice(0, 20)) {
      lines.push(`- ${other}`);
    }
    if (others.length > 20) {
      lines.push(`- ... and ${others.length - 20} more`);
    }
    lines.push("");
  }

  lines.push(`**Full Changelog**: https://github.com/${GITHUB_REPO}/compare/${from || "HEAD~10"}...v${to}`);

  return lines.join("\n");
}

/**
 * 创建 GitHub Release
 */
async function createGitHubRelease(version: string, notes: string, isDraft: boolean): Promise<void> {
  // 检查是否有 GH_TOKEN
  if (!Script.ghToken) {
    console.log("\n⚠️  跳过创建 GitHub Release（未设置 GH_TOKEN）");
    return;
  }

  // 检查 gh CLI 是否安装
  const ghCheck = spawnSync("gh", ["--version"], {
    stdio: "ignore",
    encoding: "utf-8",
  });
  if (ghCheck.status !== 0) {
    console.log("\n⚠️  跳过创建 GitHub Release（未安装 gh CLI）");
    return;
  }

  const tag = `v${version}`;

  // 写入 notes 文件
  const notesFile = path.join("dist", "release-notes.md");
  if (!existsSync("dist")) {
    mkdirSync("dist", { recursive: true });
  }
  writeFileSync(notesFile, notes);

  console.log(`\n📤 创建 GitHub Release ${tag}...`);

  // 使用 gh CLI 创建 release
  const args = [
    "release", "create",
    tag,
    "--title", `v${version}`,
    "--notes-file", notesFile,
  ];

  if (isDraft) {
    args.push("--draft");
  }

  const result = spawnSync("gh", args, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: {
      ...process.env,
      GH_TOKEN: Script.ghToken,
    },
  });

  if (result.status !== 0) {
    console.warn("⚠️  创建 GitHub Release 失败，继续执行...");
    // 不抛出错误，允许工作流继续
    return;
  }

  console.log("✅ Release 创建成功");
}

/**
 * 输出 GitHub Actions 变量
 */
function outputGitHubActions(version: string, channel: string, isRelease: boolean): void {
  // 标准 GitHub Actions 输出
  if (process.env.GITHUB_OUTPUT) {
    const output = `version=${version}\nchannel=${channel}\nrelease=${isRelease}\n`;
    writeFileSync(process.env.GITHUB_OUTPUT, output, { flag: "a" });
  }

  // 同时输出到控制台
  console.log("\n📋 输出变量:");
  console.log(`  version=${version}`);
  console.log(`  channel=${channel}`);
  console.log(`  release=${isRelease}`);
}

/**
 * 保存版本信息到文件
 */
function saveVersionInfo(version: string, channel: string): void {
  const dir = path.dirname(Script.output);
  if (dir !== "." && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = `VERSION=${version}\nCHANNEL=${channel}\nBUILD_TIME=${new Date().toISOString()}\nSHA=${Script.sha}\n`;
  writeFileSync(Script.output, content);

  console.log(`\n💾 版本信息已保存到 ${Script.output}`);
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log("🚀 FimCode 版本管理脚本");
  console.log(`   分支: ${Script.ref}`);
  console.log(`   Commit: ${Script.sha}`);

  // 计算版本
  const { version, channel, isRelease } = await calculateVersion();

  console.log(`\n📦 版本信息:`);
  console.log(`   版本号: ${version}`);
  console.log(`   渠道: ${channel}`);
  console.log(`   发布版本: ${isRelease}`);

  // 保存版本信息
  saveVersionInfo(version, channel);

  // 如果是发布版本，创建 GitHub Release
  if (isRelease) {
    const previous = getPreviousRelease();
    console.log(`\n📝 上一个版本: ${previous || "(none)"}`);

    const notes = await buildNotes(previous, Script.sha);

    console.log("\n📝 Release Notes:");
    console.log(notes);

    await createGitHubRelease(version, notes, true); // 创建草稿
  }

  // 输出变量
  outputGitHubActions(version, channel, isRelease);

  console.log("\n✅ 版本管理完成！");
}

main().catch((error) => {
  console.error("❌ 版本管理失败:", error);
  process.exit(1);
});
