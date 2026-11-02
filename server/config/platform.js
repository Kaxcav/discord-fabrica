import fs from 'fs';
import path from 'path';

export const isWindows = process.platform === 'win32';
export const isLinux = process.platform === 'linux';
export const isDarwin = process.platform === 'darwin';

export function getIpcPipePath(index = 0) {
  if (isWindows) {
    return `\\\\?\\pipe\\discord-ipc-${index}`;
  }

  // Fallbacks Unix / Linux / MacOS
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir && fs.existsSync(runtimeDir)) {
    return path.join(runtimeDir, `discord-ipc-${index}`);
  }

  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const userDir = `/run/user/${uid}`;
  if (fs.existsSync(userDir)) {
    return path.join(userDir, `discord-ipc-${index}`);
  }

  const tmpPath = path.join('/tmp', `discord-ipc-${index}`);
  return tmpPath;
}

export function canScanLocalTokens() {
  if (!isWindows) return false;
  if (process.env.ENABLE_TOKEN_SCAN === 'false') return false;
  return true;
}

