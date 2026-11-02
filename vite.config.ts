import { defineConfig, type Plugin } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = import.meta.dirname;
const DRIVER_FILE = resolve(ROOT, 'public/ai/driver.json');

/**
 * Dev-server only: the training page (lab/train.html) POSTs the best network
 * here and it is written into the project as public/ai/driver.json.
 */
function aiSaveEndpoint(): Plugin {
  return {
    name: 'ai-save-endpoint',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__ai/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const json = JSON.parse(body);
            if (json?.format !== 'ht2-driver') throw new Error('not a driver file');
            await mkdir(dirname(DRIVER_FILE), { recursive: true });
            await writeFile(DRIVER_FILE, JSON.stringify(json));
            res.statusCode = 200;
            res.end('ok');
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [aiSaveEndpoint()],
  build: {
    // Rapier's compat build embeds its WASM as base64, so one large chunk is expected.
    chunkSizeWarningLimit: 6000,
    // Only the game is built; lab/ pages are development tools served by `vite`.
    rollupOptions: { input: resolve(ROOT, 'index.html') },
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
} as any);
