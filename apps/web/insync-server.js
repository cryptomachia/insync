#!/usr/bin/env node
// Minimal custom Next server so the running process is named "insync-web" (visible in
// Activity Monitor / `ps`) instead of the generic "next-server". Serves the production
// build — run `npm run build` first, then `npm run serve` (or `node insync-server.js`).
process.title = 'insync-web';

const http = require('http');
const next = require('next');

const port = parseInt(process.env.PORT || '3100', 10);
const hostname = process.env.HOST || '0.0.0.0';
const app = next({ dev: false, dir: __dirname, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  http
    .createServer((req, res) => handle(req, res))
    .listen(port, hostname, () => {
      console.log(`inSync web (insync-web) listening on http://localhost:${port}`);
    });
});
