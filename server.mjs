import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.ROUTEROPTIMAL_PORT || 8000);
const host = process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1';
const mime = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', js: 'text/javascript; charset=utf-8', wasm: 'application/wasm', png: 'image/png', webp: 'image/webp'
};
const publicFile = /^(?:index\.html|styles\.css|(?:app|model|project-file|map|examples|cad|cad-worker|field-help)\.mjs|assets\/[\w-]+\.(?:png|webp))$/;

const cadFiles = {
  'cad-runtime/dist/libredwg-web.js': 'node_modules/@mlightcad/libredwg-web/dist/libredwg-web.js',
  'cad-runtime/wasm/libredwg-web.js': 'node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.js',
  'cad-runtime/wasm/libredwg-web.wasm': 'node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm'
};

createServer(async (req, res) => {
  const path = req.url?.split('?')[0] ?? '';
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!['GET', 'HEAD'].includes(req.method) || !(publicFile.test(file) || Object.hasOwn(cadFiles, file))) {
    res.writeHead(404).end();
    return;
  }
  try {
    const data = await readFile(new URL(cadFiles[file] ?? file, import.meta.url));
    res.writeHead(200, {
      'Content-Type': mime[file.split('.').at(-1)],
      'Content-Length': data.length,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, host, () => {
  console.log(`RouterOptimalSmart: http://127.0.0.1:${port}`);
  if (host === '0.0.0.0') console.log('Para el celular, usa la IP local del computador en la misma red.');
});


