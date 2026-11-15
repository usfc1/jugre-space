const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const port = 4179;
const address = `http://127.0.0.1:${port}/`;
const game = path.resolve(__dirname, '..', 'assembly_hangar', 'index.html');
const server = http.createServer((request, response) => {
  if (!['127.0.0.1:4179', 'localhost:4179'].includes(request.headers.host)
      || !['GET', 'HEAD'].includes(request.method) || !['/', '/index.html'].includes(new URL(request.url, address).pathname)) {
    response.writeHead(404).end();
    return;
  }
  fs.stat(game, (error, stats) => {
    if (error || !stats.isFile()) { response.writeHead(503).end('The game build is unavailable.'); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': stats.size,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = fs.createReadStream(game);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  });
});
server.on('error', error => { console.error(`Unable to start the local game: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`JUGRE web version: ${address}\nKeep this window open while playing. Press Ctrl+C to stop.`);
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', address], { detached: true, stdio: 'ignore', windowsHide: true });
    browser.on('error', () => console.error(`Open ${address} in your browser.`));
    browser.unref();
  }
});
