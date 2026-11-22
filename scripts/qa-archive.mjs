import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from './browser.mjs';
import { readPageArchive } from './archive.mjs';
const snapshot=JSON.parse(await readFile('data/results.json','utf8'));
const url=process.argv[2] || 'http://127.0.0.1:4173/';
const browser=await launchBrowser();
await mkdir('.local',{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  const errors=[],sourceRequests=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
    if(new URL(route.request().url()).hostname==='plustab.org'){sourceRequests.push(route.request().url());return route.abort();}
    return route.continue();
  });
  await page.goto(url,{waitUntil:'networkidle'});
  await page.locator('.results-link').click();
  assert.equal(await page.locator('#archive-dialog').isVisible(),true);
  assert.equal(await page.locator('#archive-page').inputValue(),`results-${snapshot.rounds.at(-1)}`);
  await page.locator('#archive-search').fill('Jia-Hao');
  assert.equal(await page.locator('.source-page tbody tr:visible').count(),1);
  await page.locator('.source-page tbody tr:visible').getByRole('link',{name:'Ballot',exact:true}).click();
  assert.match(await page.locator('#archive-content').innerText(),/Jia-Hao Stevenson/);
  assert.equal(await page.locator('.ballot-side').count(),2);
  await page.screenshot({path:'.local/archive-desktop-ballot.png'});
  await page.locator('#archive-back').click();
  assert.equal(await page.locator('#archive-page').inputValue(),`results-${snapshot.rounds.at(-1)}`);
  const checks=await page.evaluate(()=>{
    const data=JSON.parse(document.querySelector('#results-data').textContent),failures=[];
    // Exercise every view without creating hundreds of browser-history entries.
    const pushState=history.pushState;history.pushState=()=>{};
    const open=route=>{const a=document.createElement('a');a.href=route;document.body.append(a);a.click();a.remove();};
    for(const d of data.debates.filter(d=>d.ballot)) {
      open(`#ballot/${d.id}`);
      const b=d.ballot,root=document.querySelector('#archive-content');
      if(root.querySelector('.original-text pre')?.textContent!==b.archive.text)failures.push(`Full ballot text ${d.id}`);
      if((root.querySelector('.ballot-decision blockquote')?.textContent || null)!==b.decisionText)failures.push(`Decision ${d.id}`);
      if((root.querySelector('.ballot-topic')?.textContent || null)!==b.topic)failures.push(`Topic ${d.id}`);
      const expected=Object.values(b.sides).flatMap(t=>t.speakers.map(p=>p.displayedScore));
      if(JSON.stringify([...root.querySelectorAll('tbody .ballot-score')].map(e=>e.textContent))!==JSON.stringify(expected))failures.push(`Scores ${d.id}`);
      const feedback=Object.values(b.sides).flatMap(t=>t.speakers.filter(p=>p.feedback).map(p=>p.feedback.text));
      if(JSON.stringify([...root.querySelectorAll('.ballot-feedback blockquote')].map(e=>e.textContent))!==JSON.stringify(feedback))failures.push(`Feedback ${d.id}`);
    }
    for(const p of data.archive.pages) {
      open(`#archive/${p.id}`);
      if(document.querySelector('#archive-content .original-text pre')?.textContent!==p.text)failures.push(`Full page text ${p.id}`);
      if(document.querySelectorAll('.source-page tbody tr').length!==p.tableRows)failures.push(`Table rows ${p.id}`);
      for(const a of document.querySelectorAll('.source-page a[href^="#ballot/"]'))if(!data.debates.some(d=>`#ballot/${d.id}`===a.getAttribute('href')))failures.push(`Broken ballot link ${a.getAttribute('href')}`);
    }
    history.pushState=pushState;
    return {failures,ballots:data.debates.filter(d=>d.ballot).length,pages:data.archive.pages.length};
  });
  assert.deepEqual(checks.failures,[]);
  await page.locator('#archive-page').selectOption('schedule');
  await page.screenshot({path:'.local/archive-desktop-schedule.png'});
  await page.locator('#archive-close').click();
  await page.locator('#search').fill('Jia-Hao');
  await page.getByRole('button',{name:'Feedback and round details for Jia-Hao Stevenson',exact:true}).click();
  await page.locator('.feedback-round[data-round="1"]').getByRole('link',{name:'Ballot',exact:true}).click();
  assert.equal(await page.locator('#archive-dialog').isVisible(),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#speaker-dialog').isVisible(),true);
  await page.keyboard.press('Escape');
  const pendingDownload=page.waitForEvent('download');
  await page.locator('#offline-download').click();
  const download=await pendingDownload,offlinePath=resolve('.local/offline-archive.html');
  await download.saveAs(offlinePath);
  const offline=await browser.newContext({offline:true,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const mobile=await offline.newPage(),network=[];
  mobile.on('pageerror',e=>errors.push(e.message));mobile.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await mobile.goto(`${pathToFileURL(offlinePath).href}#ballot/901`,{waitUntil:'load'});
  assert.equal(await mobile.locator('#archive-dialog').isVisible(),true);
  assert.deepEqual(JSON.parse(await mobile.locator('#results-data').textContent()),snapshot);
  assert.equal(await mobile.locator('#archive-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth),true,'Mobile ballot overflow');
  await mobile.screenshot({path:'.local/archive-mobile-ballot.png'});
  await mobile.locator('#archive-page').selectOption('teams');
  assert.equal(await mobile.locator('.source-page tbody tr').count(),snapshot.archive.pages.find(p=>p.id==='teams').tableRows);
  assert.equal(await mobile.locator('#archive-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth),true,'Mobile archive overflow');
  await mobile.screenshot({path:'.local/archive-mobile-teams.png'});
  assert.deepEqual(network,[],'Offline copy attempted network requests');
  assert.deepEqual(sourceRequests,[],'App tried to access Plustab');
  assert.deepEqual(errors,[]);
  // The archive renderer retains passive content and strips executable source markup.
  const fixture=await browser.newPage();
  await fixture.setContent('<main><p onclick="alert(1)">Text &amp; details</p><a href="javascript:alert(1)">Unsafe link</a><button id="view-ballot-901">View Ballot &amp; Comments</button><script>window.fixtureExecuted=true</script><table><tbody><tr><td><span aria-label="A" style="text-decoration:underline">Winner</span></td></tr></tbody></table></main>');
  const sanitized=await fixture.evaluate(readPageArchive);
  assert.ok(!/onclick=|javascript:|<script|style=/.test(sanitized.html));
  assert.match(sanitized.html,/<strong>Winner<\/strong>/);
  assert.match(sanitized.html,/#ballot\/901/);
  console.log(`Archive QA passed: ${checks.ballots} complete ballots, ${checks.pages} public pages, local links, safe markup, mobile layouts, and downloaded HTML working with the network disabled.`);
} finally {await browser.close();}
