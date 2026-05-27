import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm run dev --workspace=stanford' : 'npm';
const npmArgs = isWindows ? [] : ['run', 'dev', '--workspace=stanford'];

const child = spawn(npmCommand, npmArgs, {
  env: {
    ...process.env,
    STANFORD_HTTPS: 'true',
  },
  shell: isWindows,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
