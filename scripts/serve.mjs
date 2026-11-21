import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root=resolve('.');
const types={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css','.js':'text/javascript'};
const server=http.createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const path=resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
    if(path!==root&&!path.startsWith(root+sep))throw new Error('Invalid path');
    if(!(await stat(path)).isFile())throw new Error('Not a file');
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(path));
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(4173,'127.0.0.1',()=>console.log('Local preview: http://127.0.0.1:4173'));
