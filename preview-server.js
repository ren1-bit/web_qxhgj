/**
 * 纯静态预览服务器（无后端依赖）
 * 仅用于托管 index.html / styles.css / app.js 等静态文件。
 * 无 Python 时由 start.bat 自动调用 node preview-server.js。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

const MIME = {
  html: 'text/html; charset=utf-8',
  css: 'text/css',
  js: 'text/javascript',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  ico: 'image/x-icon',
  json: 'application/json',
};

const server = http.createServer((req, res) => {
  let p = '.' + req.url.split('?')[0];
  if (p === './') p = './index.html';

  const ext = path.extname(p).slice(1);
  fs.readFile(p, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('404 Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log('情绪烘干机静态预览已启动：http://localhost:' + PORT);
  console.log('按 Ctrl+C 可停止服务。');
});
