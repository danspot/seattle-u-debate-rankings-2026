import { readFile, writeFile } from 'node:fs/promises';
import { verifySnapshot } from './verify.mjs';
const snapshot = JSON.parse(await readFile('data/results.json', 'utf8'));
const report = verifySnapshot(snapshot);
const [template, css, rankings, app] = await Promise.all(['site/template.html','site/style.css','scripts/rankings.mjs','site/app.js'].map(p=>readFile(p,'utf8')));
const html = template.replace('/* SITE_CSS */', css).replace('/* SNAPSHOT_JSON */', () => JSON.stringify(snapshot).replace(/</g,'\\u003c')).replace('/* SITE_JS */', () => rankings.replace(/^export /gm,'') + '\n' + app);
await writeFile('index.html', html);
await writeFile('data/verification.json', JSON.stringify(report,null,2)+'\n');
console.log(`Built self-contained index.html from ${snapshot.debates.length} debates. No live data calls.`);
