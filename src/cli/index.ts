#!/usr/bin/env bun
import { runRepl, runCommand } from "./repl";
import { runUpgrade } from "./commands/upgrade";
import { logger } from "../utils/logger";

/**
 * 显示版本信息
 */
function showVersion(): void {
  const version = typeof FIMCODE_VERSION !== "undefined" ? FIMCODE_VERSION : "dev";
  const channel = typeof FIMCODE_CHANNEL !== "undefined" ? FIMCODE_CHANNEL : "dev";
  console.log(`fimcode ${version} (${channel})`);
}

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
FimCode - AI 编程助手

Usage:
  fimcode                    启动交互模式
  fimcode <command>          执行单条命令
  fimcode upgrade [options]  检查和升级 CLI
  fimcode --version          显示版本信息
  fimcode --help             显示帮助信息

Commands:
  upgrade     检查和升级 CLI
              Options:
                --check, -c    仅检查更新
                --method, -m   指定安装方式
                <version>      升级到指定版本

Examples:
  fimcode "解释一下这段代码"     执行单条命令
  fimcode upgrade              升级到最新版本
  fimcode upgrade --check      检查是否有更新
`);
}

/**
 * CLI 入口
 *
 * 使用方法:
 * - 交互模式: bun ./src/cli/index.ts
 * - 单命令模式: bun ./src/cli/index.ts "your command here"
 * - 子命令: bun ./src/cli/index.ts upgrade
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  try {
    // 处理全局选项
    if (args.includes("--version") || args.includes("-v")) {
      showVersion();
      return;
    }

    if (args.includes("--help") || args.includes("-h")) {
      showHelp();
      return;
    }

    // 处理子命令
    if (args.length > 0) {
      const subcommand = args[0];

      switch (subcommand) {
        case "upgrade":
          await runUpgrade(args.slice(1));
          return;

        case "version":
          showVersion();
          return;

        case "help":
          showHelp();
          return;
      }
    }

    // 默认模式
    if (args.length === 0) {
      // 交互模式
      await runRepl();
    } else {
      // 单命令模式
      const command = args.join(" ");
      const output = await runCommand(command);
      console.log(output);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`CLI 错误: ${message}`);
    console.error(`错误: ${message}`);
    process.exit(1);
  }
}

// 运行主函数
main();

// 声明编译时定义的环境变量
declare const FIMCODE_VERSION: string | undefined;
declare const FIMCODE_CHANNEL: string | undefined;
