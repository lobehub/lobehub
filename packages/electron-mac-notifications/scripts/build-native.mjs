import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

if (process.platform !== 'darwin') {
  console.info('[electron-mac-notifications] non-darwin platform, skipping native build');
  process.exit(0);
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');

const { stdout, stderr } = await execFileAsync(process.execPath, [nodeGyp, 'rebuild'], {
  cwd: packageRoot,
  maxBuffer: 16 * 1024 * 1024,
});
if (stdout) console.info(stdout);
if (stderr) console.info(stderr);
console.info('[electron-mac-notifications] native build completed');
