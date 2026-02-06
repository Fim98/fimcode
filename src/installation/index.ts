/**
 * 安装管理模块
 *
 * 功能：
 * 1. 检测当前安装方式（curl/npm/bun/brew 等）
 * 2. 处理升级逻辑
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

// 项目配置
const PROJECT_NAME = "fimcode";
const GITHUB_REPO = "Fim98/fimcode";

// 安装方式类型
export type InstallMethod = "curl" | "npm" | "pnpm" | "bun" | "brew" | "unknown";

// 升级错误
export class UpgradeError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "UpgradeError";
  }
}

/**
 * 检测当前安装方式
 */
export async function detectInstallMethod(): Promise<InstallMethod> {
  const execPath = process.execPath.toLowerCase();

  // 1. 根据执行路径判断 curl 安装
  // curl 安装通常放在 ~/.fimcode/bin 或 ~/.local/bin
  if (execPath.includes(path.join(".fimcode", "bin").toLowerCase())) {
    return "curl";
  }
  if (execPath.includes(path.join(".local", "bin").toLowerCase())) {
    return "curl";
  }

  // 2. 检查各包管理器
  const checks: { name: InstallMethod; command: () => string | null }[] = [
    {
      name: "bun",
      command: () => {
        try {
          const result = spawnSync("bun", ["pm", "ls", "-g"], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "ignore"],
          });
          return result.stdout || null;
        } catch {
          return null;
        }
      },
    },
    {
      name: "pnpm",
      command: () => {
        try {
          const result = spawnSync("pnpm", ["list", "-g", "--depth=0"], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "ignore"],
          });
          return result.stdout || null;
        } catch {
          return null;
        }
      },
    },
    {
      name: "npm",
      command: () => {
        try {
          const result = spawnSync("npm", ["list", "-g", "--depth=0"], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "ignore"],
          });
          return result.stdout || null;
        } catch {
          return null;
        }
      },
    },
    {
      name: "brew",
      command: () => {
        try {
          const result = spawnSync("brew", ["list", "--formula"], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "ignore"],
          });
          return result.stdout || null;
        } catch {
          return null;
        }
      },
    },
  ];

  for (const check of checks) {
    try {
      const output = check.command();
      if (output && output.includes(PROJECT_NAME)) {
        return check.name;
      }
    } catch {
      // 忽略错误，继续检查下一个
    }
  }

  return "unknown";
}

/**
 * 获取最新版本
 */
export async function getLatestVersion(): Promise<string> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as { tag_name: string };
    return data.tag_name.replace(/^v/, "");
  } catch (error) {
    throw new UpgradeError(
      "无法获取最新版本",
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * 获取当前版本
 */
export function getCurrentVersion(): string {
  // 从环境变量或编译时定义获取
  if (typeof FIMCODE_VERSION !== "undefined") {
    return FIMCODE_VERSION;
  }

  // 尝试从 package.json 读取
  try {
    const pkg = require("../../package.json");
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * 比较版本号
 * @returns 负数: current < latest, 0: 相等, 正数: current > latest
 */
export function compareVersions(current: string, latest: string): number {
  const currentParts = current.split(".").map(Number);
  const latestParts = latest.split(".").map(Number);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;

    if (currentPart < latestPart) return -1;
    if (currentPart > latestPart) return 1;
  }

  return 0;
}

/**
 * 检查是否需要更新
 */
export async function checkForUpdate(): Promise<{
  needsUpdate: boolean;
  current: string;
  latest: string;
}> {
  const current = getCurrentVersion();
  const latest = await getLatestVersion();
  const needsUpdate = compareVersions(current, latest) < 0;

  return { needsUpdate, current, latest };
}

/**
 * 执行升级
 */
export async function upgrade(
  method?: InstallMethod,
  target: string = "latest"
): Promise<void> {
  // 如果没有指定方法，自动检测
  const installMethod = method || (await detectInstallMethod());

  if (installMethod === "unknown") {
    throw new UpgradeError(
      "无法检测安装方式。请手动升级，或使用 curl 重新安装。"
    );
  }

  console.log(`检测到安装方式: ${installMethod}`);

  let result: ReturnType<typeof spawnSync>;

  switch (installMethod) {
    case "curl": {
      // curl 安装：重新运行安装脚本
      const installUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/install`;
      console.log(`正在从 ${installUrl} 下载并运行安装脚本...`);

      result = spawnSync(
        "bash",
        ["-c", `curl -fsSL ${installUrl} | bash`],
        {
          stdio: "inherit",
          cwd: process.cwd(),
          env: {
            ...process.env,
            VERSION: target === "latest" ? "" : target,
          },
        }
      );
      break;
    }

    case "npm": {
      const npmCmd = target === "latest" ? "install" : "install";
      const versionArg = target === "latest" ? "" : `@${target}`;
      console.log(`运行: npm ${npmCmd} -g ${PROJECT_NAME}${versionArg}`);

      result = spawnSync(
        "npm",
        [npmCmd, "-g", `${PROJECT_NAME}${versionArg}`],
        {
          stdio: "inherit",
          cwd: process.cwd(),
        }
      );
      break;
    }

    case "pnpm": {
      const versionArg = target === "latest" ? "" : `@${target}`;
      console.log(`运行: pnpm add -g ${PROJECT_NAME}${versionArg}`);

      result = spawnSync(
        "pnpm",
        ["add", "-g", `${PROJECT_NAME}${versionArg}`],
        {
          stdio: "inherit",
          cwd: process.cwd(),
        }
      );
      break;
    }

    case "bun": {
      const versionArg = target === "latest" ? "" : `@${target}`;
      console.log(`运行: bun install -g ${PROJECT_NAME}${versionArg}`);

      result = spawnSync(
        "bun",
        ["install", "-g", `${PROJECT_NAME}${versionArg}`],
        {
          stdio: "inherit",
          cwd: process.cwd(),
        }
      );
      break;
    }

    case "brew": {
      console.log("运行: brew upgrade fimcode");

      result = spawnSync("brew", ["upgrade", PROJECT_NAME], {
        stdio: "inherit",
        cwd: process.cwd(),
      });
      break;
    }

    default:
      throw new UpgradeError(`不支持 ${installMethod} 升级`);
  }

  if (result.status !== 0) {
    throw new UpgradeError(
      `升级失败 (exit code: ${result.status})`,
      result.error || undefined
    );
  }

  console.log("✅ 升级完成！");
}

// 声明编译时定义的环境变量
declare const FIMCODE_VERSION: string | undefined;
