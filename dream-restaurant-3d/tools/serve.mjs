// ============================================================================
// serve.mjs — 夢幻西餐廳 3D 專用的零依賴靜態伺服器
//   用法：node tools/serve.mjs [port]     預設 http://127.0.0.1:8081/
// ============================================================================
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8081);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const safe = normalize(pathname).replace(/^([/\\])+/, '');
    const full = join(ROOT, safe);
    if (!full.startsWith(ROOT + sep) && full !== ROOT) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(full).catch(() => null);
    const target = info && info.isDirectory() ? join(full, 'index.html') : full;
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('夢幻西餐廳 3D ─ 日本編');
  console.log(`遊戲網址: http://127.0.0.1:${PORT}/`);
  console.log(`驗證頁面: http://127.0.0.1:${PORT}/tools/scene-test.html`);
});
