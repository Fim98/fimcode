#!/usr/bin/env node
/**
 * Post-install 脚本
 *
 * 在 npm install 后运行，下载对应平台的二进制文件
 */

import fs from "fs";
import path from "path";
import os from "os";
import { createRequire } from "module";
import https from "https";
import { spawnSync } from "child_process";

const require = createRequire(import.meta.url);

const PROJECT_NAME = "fimcode";
const GITHUB_REPO = "Fim98/fimcode";

// 检测当前平台
const platformMap = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};
const archMap = {
  x64: "x64",
  arm64: "arm64",
};

const platform = platformMap[os.platform()] || os.platform();
const arch = archMap[os.arch()] || os.arch();

// 构建目标名称
let targetName = `${PROJECT_NAME}-${platform}-${arch}`;

// 检测 musl (Alpine Linux)
let isMusl = false;
if (platform === "linux") {
  try {
    const lddResult = spawnSync("ldd", ["--version"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (lddResult.stderr?.includes("musl") || lddResult.stdout?.includes("musl")) {
      isMusl = true;
    }
  } catch {
    // 忽略错误
  }

  // 检查 Alpine
  if (fs.existsSync("/etc/alpine-release")) {
    isMusl = true;
  }
}

if (isMusl) {
  targetName += "-musl";
}

// 构建文件名
const archiveExt = platform === "linux" ? ".tar.gz" : ".zip";
const filename = `${targetName}${archiveExt}`;

console.log(`📦 ${PROJECT_NAME} postinstall`);
console.log(`   Platform: ${platform}-${arch}${isMusl ? " (musl)" : ""}`);
console.log(`   Target: ${filename}`);

// 获取包版本
const pkgPath = path.join(process.cwd(), "package.json");
let version = "latest";
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  version = pkg.version || "latest";
} catch {
  // 忽略错误
}

// 构建下载 URL
const downloadUrl =
  version === "latest"
    ? `https://github.com/${GITHUB_REPO}/releases/latest/download/${filename}`
    : `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${filename}`;

console.log(`   Download: ${downloadUrl}`);

// 下载文件
async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, { redirect: true }, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          // 重定向
          downloadFile(response.headers.location, dest)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

// 解压 tar.gz
function extractTarGz(archivePath, destDir) {
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", destDir], {
    stdio: "ignore",
  });
  return result.status === 0;
}

// 解压 zip
function extractZip(archivePath, destDir) {
  const result = spawnSync("unzip", ["-q", archivePath, "-d", destDir], {
    stdio: "ignore",
  });
  return result.status === 0;
}

// 主函数
async function main() {
  const binDir = path.join(process.cwd(), "bin");
  const binaryName = platform === "windows" ? "fimcode.exe" : "fimcode";
  const binaryPath = path.join(binDir, binaryName);

  // 检查是否已存在
  if (fs.existsSync(binaryPath)) {
    console.log("   Binary already exists, skipping download");
    process.exit(0);
  }

  // 创建 bin 目录
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  // 下载到临时文件
  const tmpFile = path.join(os.tmpdir(), filename);

  try {
    console.log("   Downloading...");
    await downloadFile(downloadUrl, tmpFile);
    console.log("   Download complete");

    // 解压
    console.log("   Extracting...");
    let extracted = false;
    if (filename.endsWith(".tar.gz")) {
      extracted = extractTarGz(tmpFile, binDir);
    } else {
      extracted = extractZip(tmpFile, binDir);
    }

    if (!extracted) {
      throw new Error("Failed to extract archive");
    }

    // 清理临时文件
    fs.unlinkSync(tmpFile);

    // 设置可执行权限
    if (platform !== "windows") {
      fs.chmodSync(binaryPath, 0o755);
    }

    console.log("   ✓ Post-install complete");
  } catch (error) {
    console.error(`   ✗ Post-install failed: ${error.message}`);
    console.error(
      "   You can manually download from:",
      `https://github.com/${GITHUB_REPO}/releases`
    );
    // 不退出，允许用户手动安装
    process.exit(0);
  }
}

main().catch((error) => {
  console.error(`   Error: ${error.message}`);
  process.exit(0); // 不中断安装
});
