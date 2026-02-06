#!/usr/bin/env bun
/**
 * 多平台构建脚本
 * 支持编译为各平台二进制文件并打包
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

// 项目配置
const PROJECT_NAME = "fimcode";
const GITHUB_REPO = "Fim98/fimcode";

// 支持的平台和架构
const allTargets = [
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "x64", abi: "musl" },      // Alpine Linux
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "win32", arch: "x64" },
] as const;

// 脚本参数解析
const Script = {
  version: process.env.VERSION || "0.0.0-dev",
  channel: process.env.CHANNEL || "dev",
  release: process.env.RELEASE === "true",
  targets: process.env.TARGETS?.split(",").map(t => t.trim()) || null,
};

/**
 * 获取目标文件名
 */
function getTargetName(target: typeof allTargets[number]): string {
  const parts = [PROJECT_NAME, target.os, target.arch];
  if ("abi" in target && target.abi) parts.push(target.abi);
  return parts.join("-");
}

/**
 * 获取 Bun 编译目标
 */
function getBunTarget(target: typeof allTargets[number]): string {
  let platform = target.os;
  if (platform === "win32") platform = "windows";
  let bunTarget = `bun-${platform}-${target.arch}`;
  if ("abi" in target && target.abi) {
    bunTarget = bunTarget.replace(target.arch, `${target.arch}-${target.abi}`);
  }
  return bunTarget;
}

/**
 * 清理目录
 */
function cleanDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
  mkdirSync(dir, { recursive: true });
}

/**
 * 构建单个目标
 */
async function buildTarget(target: typeof allTargets[number]): Promise<void> {
  const targetName = getTargetName(target);
  const bunTarget = getBunTarget(target);
  const outDir = path.join("dist", targetName, "bin");
  const outFile = target.os === "win32" ? `${PROJECT_NAME}.exe` : PROJECT_NAME;
  const outPath = path.join(outDir, outFile);

  console.log(`\n🔨 构建 ${targetName} (target: ${bunTarget})...`);

  // 确保输出目录存在
  cleanDir(outDir);

  // 使用 Bun.build() 编译
  const result = await Bun.build({
    entrypoints: ["./src/cli/index.ts"],
    outdir: outDir,
    target: "bun",
    minify: true,
    define: {
      FIMCODE_VERSION: `'${Script.version}'`,
      FIMCODE_CHANNEL: `'${Script.channel}'`,
      FIMCODE_BUILD_TIME: `'${new Date().toISOString()}'`,
    },
  });

  if (!result.success) {
    console.error(`❌ 构建 ${targetName} 失败:`);
    for (const log of result.logs) {
      console.error(log);
    }
    throw new Error(`构建 ${targetName} 失败`);
  }

  // 使用 bun compile 编译为单个二进制文件
  const compileArgs = [
    "compile",
    "--target", bunTarget,
    "--outfile", outPath,
    "./src/cli/index.ts",
  ];

  console.log(`  运行: bun ${compileArgs.join(" ")}`);

  const compileResult = spawnSync("bun", compileArgs, {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  if (compileResult.status !== 0) {
    throw new Error(`编译 ${targetName} 失败`);
  }

  // 设置可执行权限（非 Windows）
  if (target.os !== "win32") {
    spawnSync("chmod", ["755", outPath], { stdio: "ignore" });
  }

  console.log(`✅ ${targetName} 构建完成`);
}

/**
 * 打包构建产物
 */
async function packageTarget(target: typeof allTargets[number]): Promise<string> {
  const targetName = getTargetName(target);
  const binDir = path.join("dist", targetName, "bin");

  if (target.os === "linux") {
    // Linux 使用 tar.gz
    const archiveName = `${targetName}.tar.gz`;
    const archivePath = path.join("dist", archiveName);

    console.log(`📦 打包 ${archiveName}...`);

    const result = spawnSync("tar", ["-czf", `../${archiveName}`, "."], {
      cwd: binDir,
      stdio: "ignore",
    });

    if (result.status !== 0) {
      throw new Error(`打包 ${targetName} 失败`);
    }

    console.log(`✅ 打包完成: ${archivePath}`);
    return archivePath;
  } else if (target.os === "win32") {
    // Windows 使用 PowerShell Compress-Archive
    const archiveName = `${targetName}.zip`;
    const archivePath = path.join("dist", archiveName);

    console.log(`📦 打包 ${archiveName}...`);

    const result = spawnSync(
      "powershell",
      [
        "-Command",
        `Compress-Archive -Path '${binDir}/*' -DestinationPath '${archivePath}' -Force`,
      ],
      {
        stdio: "ignore",
      }
    );

    if (result.status !== 0) {
      throw new Error(`打包 ${targetName} 失败`);
    }

    console.log(`✅ 打包完成: ${archivePath}`);
    return archivePath;
  } else {
    // macOS 使用 zip
    const archiveName = `${targetName}.zip`;
    const archivePath = path.join("dist", archiveName);

    console.log(`📦 打包 ${archiveName}...`);

    const result = spawnSync("zip", ["-r", `../${archiveName}`, "."], {
      cwd: binDir,
      stdio: "ignore",
    });

    if (result.status !== 0) {
      throw new Error(`打包 ${targetName} 失败`);
    }

    console.log(`✅ 打包完成: ${archivePath}`);
    return archivePath;
  }
}

/**
 * 上传到 GitHub Releases
 */
async function uploadToRelease(archives: string[]): Promise<void> {
  if (!Script.release) {
    console.log("\n📤 跳过上传（非发布模式）");
    return;
  }

  console.log(`\n📤 上传到 GitHub Releases v${Script.version}...`);

  // 使用 gh CLI 上传
  const uploadArgs = [
    "release", "upload",
    `v${Script.version}`,
    ...archives,
    "--clobber",
  ];

  const result = spawnSync("gh", uploadArgs, {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  if (result.status !== 0) {
    throw new Error("上传到 GitHub Releases 失败");
  }

  console.log("✅ 上传完成");
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log("🚀 FimCode 构建脚本");
  console.log(`   版本: ${Script.version}`);
  console.log(`   渠道: ${Script.channel}`);
  console.log(`   发布模式: ${Script.release}`);

  // 确定要构建的目标
  let targetsToBuild = allTargets;
  if (Script.targets) {
    targetsToBuild = allTargets.filter(t => {
      const name = getTargetName(t);
      return Script.targets?.includes(name);
    });
  }

  // 如果是本地开发，只构建当前平台
  if (!Script.release && !Script.targets) {
    const currentPlatform = process.platform;
    const currentArch = process.arch;
    targetsToBuild = allTargets.filter(t =>
      t.os === currentPlatform && t.arch === currentArch
    );
    console.log(`\n🖥️  本地模式，只构建当前平台: ${currentPlatform}-${currentArch}`);
  }

  // 清理 dist 目录
  cleanDir("dist");

  // 构建所有目标
  const builtTargets: typeof allTargets = [];
  for (const target of targetsToBuild) {
    try {
      await buildTarget(target);
      builtTargets.push(target);
    } catch (error) {
      console.error(`❌ 构建 ${getTargetName(target)} 失败:`, error);
      if (Script.release) {
        process.exit(1);
      }
    }
  }

  if (builtTargets.length === 0) {
    console.error("❌ 没有成功构建任何目标");
    process.exit(1);
  }

  // 打包构建产物
  const archives: string[] = [];
  for (const target of builtTargets) {
    try {
      const archivePath = await packageTarget(target);
      archives.push(archivePath);
    } catch (error) {
      console.error(`❌ 打包 ${getTargetName(target)} 失败:`, error);
      if (Script.release) {
        process.exit(1);
      }
    }
  }

  // 上传到 GitHub Releases
  if (Script.release) {
    await uploadToRelease(archives);
  }

  console.log("\n✅ 构建完成！");
  console.log("\n构建产物:");
  for (const archive of archives) {
    console.log(`  - ${archive}`);
  }
}

main().catch((error) => {
  console.error("❌ 构建失败:", error);
  process.exit(1);
});
