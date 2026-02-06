#!/usr/bin/env bun
/**
 * Upgrade 命令 - 检查和升级 CLI
 *
 * 用法:
 *   fimcode upgrade          # 检查并升级到最新版本
 *   fimcode upgrade --check  # 仅检查更新，不升级
 *   fimcode upgrade 1.2.3    # 升级到指定版本
 */

import {
  checkForUpdate,
  upgrade as doUpgrade,
  detectInstallMethod,
  getCurrentVersion,
  UpgradeError,
} from "../../installation";
import type { InstallMethod } from "../../installation";
import { logger } from "../../utils/logger";

interface UpgradeOptions {
  check: boolean;
  method?: InstallMethod;
  version?: string;
}

/**
 * 解析命令行参数
 */
function parseArgs(args: string[]): UpgradeOptions {
  const options: UpgradeOptions = {
    check: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--check":
      case "-c":
        options.check = true;
        break;

      case "--method":
      case "-m":
        options.method = args[++i] as InstallMethod;
        break;

      case "--help":
      case "-h":
        showHelp();
        process.exit(0);
        break;

      default:
        // 如果参数不以 - 开头，认为是版本号
        if (!arg.startsWith("-")) {
          options.version = arg;
        }
        break;
    }
  }

  return options;
}

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
Usage: fimcode upgrade [options] [version]

Options:
  -c, --check          仅检查更新，不执行升级
  -m, --method <type>  指定安装方式 (curl|npm|pnpm|bun|brew)
  -h, --help           显示帮助信息

Arguments:
  version              指定要升级到的版本 (默认: latest)

Examples:
  fimcode upgrade              # 升级到最新版本
  fimcode upgrade --check      # 检查是否有更新
  fimcode upgrade 1.2.3        # 升级到指定版本
  fimcode upgrade --method npm # 使用 npm 升级
`);
}

/**
 * 执行升级命令
 */
export async function runUpgrade(args: string[]): Promise<void> {
  const options = parseArgs(args);

  try {
    // 显示当前版本
    const currentVersion = getCurrentVersion();
    console.log(`当前版本: ${currentVersion}`);

    // 检测安装方式
    const installMethod = options.method || (await detectInstallMethod());

    if (installMethod === "unknown") {
      console.log("\n⚠️  无法自动检测安装方式。");
      console.log("请尝试指定安装方式: fimcode upgrade --method <type>");
      console.log("\n支持的安装方式:");
      console.log("  - curl: curl -fsSL ... | bash");
      console.log("  - npm: npm install -g fimcode");
      console.log("  - pnpm: pnpm add -g fimcode");
      console.log("  - bun: bun install -g fimcode");
      console.log("  - brew: brew install fimcode");
      process.exit(1);
    }

    console.log(`安装方式: ${installMethod}`);

    // 检查更新
    console.log("\n🔍 检查更新...");
    const { needsUpdate, latest } = await checkForUpdate();

    // 如果指定了版本号，使用指定的版本
    const targetVersion = options.version || latest;

    if (options.version) {
      console.log(`目标版本: ${options.version} (指定)`);
    } else {
      console.log(`最新版本: ${latest}`);
    }

    // 仅检查模式
    if (options.check) {
      if (needsUpdate || options.version) {
        console.log("\n✅ 有新版本可用！");
        console.log(`运行 "fimcode upgrade" 升级到 ${targetVersion}`);
      } else {
        console.log("\n✅ 当前已是最新版本！");
      }
      return;
    }

    // 如果已经是最新版本，且没有指定版本号
    if (!needsUpdate && !options.version) {
      console.log("\n✅ 当前已是最新版本，无需升级！");
      return;
    }

    // 执行升级
    console.log(`\n🚀 开始升级到 ${targetVersion}...\n`);
    await doUpgrade(installMethod, targetVersion);

    console.log(`\n✅ 成功升级到 ${targetVersion}！`);
    console.log("运行 'fimcode --version' 验证新版本。");

  } catch (error) {
    if (error instanceof UpgradeError) {
      logger.error(`升级失败: ${error.message}`);
      if (error.cause) {
        logger.error(`原因: ${error.cause.message}`);
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`升级失败: ${message}`);
    }
    process.exit(1);
  }
}

// 如果直接运行此文件
if (import.meta.main) {
  runUpgrade(process.argv.slice(2)).catch((error) => {
    console.error("错误:", error);
    process.exit(1);
  });
}
