import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.csv':'text/csv; charset=utf-8','.svg':'image/svg+xml'};
const server = http.createServer(async (req,res)=>{
  const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file = path.resolve(root, '.'+pathname, pathname.endsWith('/')?'index.html':'');
  if (!file.startsWith(root+path.sep) && file!==root) {res.writeHead(403).end();return;}
  if (pathname.startsWith('/.git/') || pathname.startsWith('/tests/') || pathname.startsWith('/scripts/')) {res.writeHead(404).end();return;}
  try {const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(data);}
  catch {res.writeHead(404).end('Not found');}
});
server.listen(4173,'127.0.0.1',()=>console.log('http://127.0.0.1:4173'));
