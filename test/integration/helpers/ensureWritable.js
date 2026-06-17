'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

/** MariaDB and similar images chown bind mounts on Linux; CI runner needs write access for test markers. */
function ensureHostPathWritable(hostPath) {
  if (!hostPath || !fs.existsSync(hostPath)) return;
  if (process.platform === 'win32') return;
  try {
    execFileSync('chmod', ['-R', 'a+rwX', hostPath], { stdio: 'ignore', timeout: 15000 });
  } catch {
    try {
      fs.chmodSync(hostPath, 0o777);
    } catch (_) {}
  }
}

module.exports = { ensureHostPathWritable };
