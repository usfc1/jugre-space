import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
createServer(async (request, response) => {
  const filename = path.resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
  if (path.relative(root, filename).startsWith('..')) { response.writeHead(403).end(); return; }
  try {
    const info = await stat(filename);
    if (!info.isFile()) throw new Error('Not a file');
    const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }[path.extname(filename)] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': mime, 'Content-Length': info.size });
    createReadStream(filename).pipe(response);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(Number(process.env.JUGRE_TEST_PORT) || 4179, '127.0.0.1');
