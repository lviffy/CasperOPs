#!/usr/bin/env node
/**
 * Local RPC proxy: listens on localhost:7777
 * Forwards all requests to https://node.testnet.cspr.cloud/rpc
 * with the Authorization header so casper-client can work despite ISP blocks.
 *
 * Usage:  node scripts/rpc-proxy.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load API key from backend/.env
const dotenvPath = path.resolve(__dirname, '../../backend/.env');
let CSPR_CLOUD_KEY = '';
if (fs.existsSync(dotenvPath)) {
  const lines = fs.readFileSync(dotenvPath, 'utf8').split('\n');
  const keyLine = lines.find(l => l.startsWith('CSPR_CLOUD_API_KEY='));
  if (keyLine) CSPR_CLOUD_KEY = keyLine.split('=')[1].trim();
}

if (!CSPR_CLOUD_KEY) {
  console.error('❌  CSPR_CLOUD_API_KEY not set in backend/.env');
  process.exit(1);
}

const TARGET = 'node.testnet.cspr.cloud';
const PORT = 7777;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    const options = {
      hostname: TARGET,
      port: 443,
      path: '/rpc',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'Authorization': CSPR_CLOUD_KEY,
      },
    };

    const proxyReq = https.request(options, proxyRes => {
      res.writeHead(proxyRes.statusCode, { 'content-type': 'application/json' });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', err => {
      console.error('Proxy error:', err.message);
      res.writeHead(502);
      res.end(JSON.stringify({ error: err.message }));
    });

    proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✅  RPC proxy running at http://127.0.0.1:${PORT}`);
  console.log(`    Forwarding to https://${TARGET}/rpc`);
  console.log(`    Use --node-address http://127.0.0.1:${PORT} with casper-client`);
});
