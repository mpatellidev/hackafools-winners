const http = require('http');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const rawUrl = req.url || '/';
  const safeUrl = rawUrl.split('?')[0];
  const requestPath = safeUrl === '/' ? '/index.html' : safeUrl;
  const normalizedPath = path.normalize(requestPath).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(frontendDir, normalizedPath);

  const isInsideFrontend = filePath.startsWith(frontendDir);

  if (!isInsideFrontend) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  const finalPath = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
    ? path.join(filePath, 'index.html')
    : filePath;

  if (!fs.existsSync(finalPath)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  fs.readFile(finalPath, (error, content) => {
    if (error) {
      res.statusCode = 500;
      res.end('Internal server error');
      return;
    }

    const ext = path.extname(finalPath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.end(content);
  });
});

const port = Number(process.env.PORT || 3000);

server.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
