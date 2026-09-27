// Tiny static server for Local Preview of build output (SPA fallback to index.html)
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 4173);
// Project key: every response carries X-BID-Project so the engine can recognise (and adopt) a server it
// lost track of, and DELETE /__bid__/stop with the matching X-BID-Key shuts it down without a pid.
const projectKey = process.argv[4] || '';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
};

function resolveFile(url) {
  let pathname = '/';
  try {
    pathname = decodeURIComponent((url || '/').split('?')[0]);
  } catch {}
  const target = path.resolve(root, '.' + pathname);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

http
  .createServer((req, res) => {
    if (projectKey) res.setHeader('X-BID-Project', projectKey);
    if (req.method === 'DELETE' && req.url === '/__bid__/stop') {
      if (!projectKey || req.headers['x-bid-key'] !== projectKey) {
        res.statusCode = 403;
        return res.end('Forbidden');
      }
      res.end('stopping');
      setTimeout(() => process.exit(0), 50);
      return;
    }
    let file = resolveFile(req.url);
    if (!file) {
      res.statusCode = 403;
      return res.end('Forbidden');
    }
    try {
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file) && !path.extname(file) && fs.existsSync(file + '.html')) file = file + '.html';
      if (!fs.existsSync(file)) {
        const fallback = path.join(root, 'index.html');
        if (!path.extname(file) && fs.existsSync(fallback)) file = fallback;
        else {
          res.statusCode = 404;
          return res.end('404');
        }
      }
      res.setHeader('Content-Type', types[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    } catch {
      res.statusCode = 500;
      res.end('Server error');
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`READY http://127.0.0.1:${port}`));
