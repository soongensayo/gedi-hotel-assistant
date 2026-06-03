import { mkdirSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const certDir = resolve(repoRoot, 'stanford/certs');
const keyPath = resolve(certDir, 'dev-key.pem');
const certPath = resolve(certDir, 'dev-cert.pem');
const opensslConfigPath = resolve(certDir, 'dev-openssl.cnf');

function detectLanIp() {
  const interfaces = networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }

  return '';
}

const lanIp = process.argv[2] || detectLanIp();

if (!lanIp) {
  console.error('Could not auto-detect a LAN IP.');
  console.error('Run: npm run setup:stanford-https -- 192.168.x.x');
  process.exit(1);
}

mkdirSync(certDir, { recursive: true });

writeFileSync(
  opensslConfigPath,
  `[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = PrimeDrive Stanford Dev

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
IP.3 = ${lanIp}
`,
  'utf8'
);

const openssl = spawnSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-sha256',
    '-days',
    '14',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-config',
    opensslConfigPath,
  ],
  {
    stdio: 'pipe',
    shell: process.platform === 'win32',
  }
);

if (openssl.status !== 0) {
  console.error('Could not generate the HTTPS certificate with openssl.');
  console.error('');
  console.error('If you are on Windows, install Git for Windows or OpenSSL, then reopen PowerShell.');
  console.error('Alternative for a quick lab demo: use Chrome\'s "unsafely treat insecure origin as secure" flag for http://' + lanIp + ':5174.');
  console.error('');
  if (openssl.stderr?.length) {
    console.error(openssl.stderr.toString());
  }
  process.exit(openssl.status ?? 1);
}

console.log('Generated Stanford HTTPS cert for:');
console.log('  https://localhost:5174/');
console.log(`  https://${lanIp}:5174/`);
console.log('');
console.log('Next demo command:');
console.log('  npm run dev:stanford:https');
console.log('');
console.log('On the staff laptop, open:');
console.log(`  https://${lanIp}:5174/staff`);
console.log('');
console.log('Because this is a local self-signed cert, the staff browser must accept/trust it once.');
