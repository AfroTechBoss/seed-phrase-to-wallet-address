// Tiny static server for running locally (Vercel serves public/ directly via vercel.json).
// It only serves files; it never receives keys.
// All key handling and signing happens in the browser (public/app.js).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1'; // local machine only

const FILES = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/tronweb.js': ['public/tronweb.js', 'text/javascript; charset=utf-8'],
};

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  'connect-src https://api.trongrid.io https://api.shasta.trongrid.io https://nile.trongrid.io',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const entry = FILES[path];
  if (req.method !== 'GET' || !entry) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(join(root, entry[0]));
    res.writeHead(200, {
      'Content-Type': entry[1],
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(500).end('Missing file. Did you run npm install?');
  }
}).listen(PORT, HOST, () => {
  console.log(`TRC-20 Mover running at http://${HOST}:${PORT}`);
});
