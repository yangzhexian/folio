import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, normalizePath, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Serve the PDF worker, fonts and decoders as unmodified package files in both modes.
function localPdfAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const groups = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
  const assets = new Map<string, Buffer>();
  let prefix = '/pdfjs-assets/';
  return {
    name: 'folio-local-pdf-assets',
    configResolved(config) {
      prefix = `${config.base}pdfjs-assets/`;
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
        }
      }
      assets.set('pdf.worker.min.mjs', await readFile(join(root, 'build', 'pdf.worker.min.mjs')));
      assets.set('LICENSE', await readFile(join(root, 'LICENSE')));
    },
    generateBundle() {
      for (const [name, source] of assets) {
        this.emitFile({ type: 'asset', fileName: `pdfjs-assets/${name}`, source });
      }
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
        const type = pathname.endsWith('.wasm') ? 'application/wasm' : /\.m?js$/.test(pathname) ? 'text/javascript' : 'application/octet-stream';
        response.setHeader('Content-Type', type);
        response.setHeader('Cache-Control', 'no-cache');
        response.end(source);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localPdfAssets()],
  clearScreen: false,
  // Only the app entry belongs to this Vite instance. Cargo output and disposable
  // native/benchmark worktrees can otherwise add hundreds of thousands of watch paths.
  optimizeDeps: { entries: ['index.html'] },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['artifacts', 'src-tauri', 'video', 'test-results', 'playwright-report'].map(directory =>
        normalizePath(fileURLToPath(new URL(directory, import.meta.url))) + '/**'),
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: 'es2022' },
});
