import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Keep PDF fonts and decoders beside the app in both development and packaged builds.
function localPdfAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const groups = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
  const assets = new Map<string, Buffer>();
  let prefix = '/pdfjs-assets/';
  let build = false;
  return {
    name: 'folio-local-pdf-assets',
    configResolved(config) {
      prefix = `${config.base}pdfjs-assets/`;
      build = config.command === 'build';
    },
    async buildStart() {
      assets.clear();
      for (const group of groups) {
        for (const entry of await readdir(join(root, group), { withFileTypes: true })) {
          // The canvas viewer never runs PDF JavaScript; its optional sandbox is not shipped.
          if (!entry.isFile() || entry.name.startsWith('quickjs')) continue;
          const name = `${group}/${entry.name}`;
          const source = await readFile(join(root, name));
          assets.set(name, source);
          if (build) {
            this.emitFile({ type: 'asset', fileName: `pdfjs-assets/${name}`, source });
          }
        }
      }
      const license = await readFile(join(root, 'LICENSE'));
      assets.set('LICENSE', license);
      if (build) this.emitFile({ type: 'asset', fileName: 'pdfjs-assets/LICENSE', source: license });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split('?')[0] ?? '';
        if (!pathname.startsWith(prefix)) return next();
        const source = assets.get(pathname.slice(prefix.length));
        if (!source) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader('Content-Type', pathname.endsWith('.wasm') ? 'application/wasm' : pathname.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        response.setHeader('Cache-Control', 'no-cache');
        response.end(source);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localPdfAssets()],
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: 'es2022' },
});
