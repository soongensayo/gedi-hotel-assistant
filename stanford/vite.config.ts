import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultKeyPath = fileURLToPath(new URL('./certs/dev-key.pem', import.meta.url));
const defaultCertPath = fileURLToPath(new URL('./certs/dev-cert.pem', import.meta.url));
const resolveFromRepoRoot = (value: string) => (isAbsolute(value) ? value : resolve(repoRoot, value));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '');
  const useHttps = env.STANFORD_HTTPS === 'true';
  const keyPath = env.STANFORD_HTTPS_KEY
    ? resolveFromRepoRoot(env.STANFORD_HTTPS_KEY)
    : defaultKeyPath;
  const certPath = env.STANFORD_HTTPS_CERT
    ? resolveFromRepoRoot(env.STANFORD_HTTPS_CERT)
    : defaultCertPath;
  const https =
    useHttps && existsSync(keyPath) && existsSync(certPath)
      ? {
          key: readFileSync(keyPath),
          cert: readFileSync(certPath),
        }
      : undefined;

  if (useHttps && !https) {
    console.warn(
      'STANFORD_HTTPS=true, but cert files were not found. Run `npm run setup:stanford-https` first.'
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    envDir: '..',
    server: {
      port: 5174,
      host: true,
      https,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
        '/socket.io': {
          target: 'http://localhost:3001',
          ws: true,
        },
      },
    },
  };
});
