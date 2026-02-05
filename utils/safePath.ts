/**
 * 确保路径保持在工作区内（安全措施）。
 * 
 * 防止模型访问项目目录外的文件。
 * 解析相对路径并检查它们不会通过'../'逃逸。
 */
const WORKDIR = process.cwd()
export function safePath(path: string): string {
  const resolved = `${WORKDIR}/${path}`.replace(/\/+/g, '/');
  if (!resolved.startsWith(WORKDIR)) {
    throw new Error(`路径超出工作区: ${path}`);
  }
  return resolved;
}