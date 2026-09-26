'use strict';
/*
 * 壁毯织补定位网校核 —— Web 服务
 *  - 静态托管浏览器端页面（public/）
 *  - GET  /health        健康检查
 *  - POST /api/evaluate  校核接口（与浏览器共用 public/geometry.js 同一套判定逻辑）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const geometry = require('./public/geometry.js');

const PORT = parseInt(process.env.PORT || '8080', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 1024 * 1024; // 1MB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req, cb) {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      cb(new Error('请求体过大'));
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    try {
      cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch (e) {
      cb(new Error('请求体不是合法 JSON'));
    }
  });
  req.on('error', () => cb(new Error('读取请求体失败')));
}

function serveStatic(pathname, res) {
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'content-length': data.length,
      'cache-control': 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      service: 'tapestry-grid-checker',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (url.pathname === '/api/evaluate') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    readBody(req, (err, body) => {
      if (err) {
        sendJson(res, 400, { ok: false, failure: { type: 'invalid', target: 'input', reason: err.message } });
        return;
      }
      sendJson(res, 200, geometry.evaluateGrid(body));
    });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(url.pathname, res);
    return;
  }

  sendJson(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, () => {
  console.log(`[web] 壁毯织补定位网校核服务已启动: http://0.0.0.0:${PORT}`);
});
