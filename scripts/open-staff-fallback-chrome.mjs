import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = process.argv[2] || process.env.STANFORD_STAFF_URL || '';

if (!target || !/^http:\/\/[^/]+:\d+/.test(target)) {
  console.error('Usage: npm run demo:staff:fallback -- http://<interface-ip>:5174/staff');
  console.error('Example: npm run demo:staff:fallback -- http://10.32.35.221:5174/staff');
  process.exit(1);
}

const origin = new URL(target).origin;
const userDataDir = join(tmpdir(), 'luxedrive-staff-chrome');

function chromeCommand() {
  if (process.platform === 'darwin') {
    const appPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    return existsSync(appPath) ? appPath : 'google-chrome';
  }

  if (process.platform === 'win32') {
    return 'chrome';
  }

  return 'google-chrome';
}

const child = spawn(
  chromeCommand(),
  [
    `--user-data-dir=${userDataDir}`,
    `--unsafely-treat-insecure-origin-as-secure=${origin}`,
    target,
  ],
  {
    shell: process.platform === 'win32',
    stdio: 'inherit',
  }
);

child.on('error', (error) => {
  console.error(`Could not open Chrome: ${error.message}`);
  console.error('');
  console.error('Manual fallback command for Chrome:');
  console.error(`  --unsafely-treat-insecure-origin-as-secure=${origin}`);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
