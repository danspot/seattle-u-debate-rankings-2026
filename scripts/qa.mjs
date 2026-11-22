import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';
import { deriveAll } from './rankings.mjs';
const url=process.argv[2]||'http://127.0.0.1:4173/';
const snapshot=JSON.parse(await readFile('data/results.json','utf8'));
const divisions=deriveAll(snapshot);
const browser=await launchBrowser();
const errors=[];
await mkdir('.local',{recursive:true});
async function selectDivisions(page, names) {
  if (await page.locator('#division').getAttribute('aria-expanded') !== 'true') await page.locator('#division').click();
  for (const d of divisions) await page.getByRole('checkbox',{name:d.division,exact:true}).setChecked(names.includes(d.division));
  await page.keyboard.press('Escape');
}
async function checkCounts(page, selected) {
  assert.equal(await page.locator('#speaker-rows tr[data-name]').count(),selected.reduce((n,d)=>n+d.speakers.length,0));
  assert.equal(await page.locator('#team-rows tr[data-name]').count(),selected.reduce((n,d)=>n+d.teams.length,0));
  for(const kind of ['speaker','team']) {
    assert.equal(await page.locator(`#${kind}-rows .division-heading`).count(),0);
    const count=await page.locator(`#${kind}-rows tr[data-name]`).count();
    assert.equal(await page.locator(`#${kind}-rows .division-tag`).count(),selected.length>1?count:0);
  }
}
async function checkMergedRanks(page,selected) {
  for(const kind of ['speaker','team']) {
    const expected=selected.flatMap(d=>d[kind==='speaker'?'speakers':'teams'].map(row=>({...row,division:d.division})));
    const rows=await page.locator(`#${kind}-rows tr[data-name]`).evaluateAll(rows=>rows.map(row=>({name:row.dataset.name,division:row.dataset.division,key:row.querySelector('[data-speaker]')?.dataset.speaker,rank:row.querySelector('.rank').firstChild.textContent.trim(),tag:row.querySelector('.division-tag')?.title})));
    for(const row of rows) {
      const entry=expected.find(e=>kind==='speaker'?encodeURIComponent(`${e.division}\u0000${e.id}`)===row.key:e.name===row.name&&e.division===row.division);
      assert.ok(entry);
      const rank=kind==='speaker' ? entry.average===null?null:1+expected.filter(e=>e.average!==null&&e.average>entry.average).length : !entry.complete?null:1+expected.filter(e=>e.complete&&(e.wins>entry.wins||e.wins===entry.wins&&e.losses<entry.losses)).length;
      assert.equal(row.rank,String(rank??'—'));
      assert.equal(row.tag,entry.division);
    }
  }
}
async function checkFeedback(page, speaker) {
  const key=encodeURIComponent(`${speaker.division}\u0000${speaker.id}`);
  await page.locator(`[data-speaker="${key}"]`).click();
  assert.equal(await page.getByRole('dialog').isVisible(),true);
  assert.equal(await page.locator('#feedback-title').textContent(),speaker.name);
  assert.equal(await page.locator('.feedback-round').count(),snapshot.rounds.length);
  for (const round of snapshot.rounds) {
    const section=page.locator(`.feedback-round[data-round="${round}"]`);
    const expected=speaker.rounds[round];
    if(expected?.feedback)assert.equal(await section.locator('.feedback-text').textContent(),expected.feedback);
    else assert.equal(await section.locator('.feedback-missing').isVisible(),true);
    if(expected)assert.equal(await section.getByRole('link',{name:'Ballot',exact:true}).getAttribute('href'),expected.ballotUrl);
    assert.equal(await section.locator('.team-stars').count(),Number(expected?.teamHighest===true));
    assert.equal(await section.locator('.room-stars').count(),Number(expected?.roomHighest===true));
  }
  assert.equal(await page.locator('#speaker-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth),true,'Feedback popup overflows horizontally');
}
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  page.on('pageerror',error=>errors.push(error.message));
  const requests=[];page.on('request',req=>requests.push(req.url()));
  const response=await page.goto(url,{waitUntil:'networkidle'});assert.equal(response.status(),200);
  assert.deepEqual(JSON.parse(await page.locator('#results-data').textContent()),snapshot,'Rendered snapshot differs from committed data');
  const publicData=await page.request.get(new URL('data/results.json',url).href);
  assert.equal(publicData.status(),200);assert.deepEqual(await publicData.json(),snapshot,'Download differs from committed data');
  assert.equal(await page.title(),'Seattle U Debate Rankings — November 21, 2026');
  for(const kind of ['speaker','team']) {
    assert.equal(await page.locator(`#${kind}-panel th.round-column`).count(),snapshot.rounds.length);
    for(const round of snapshot.rounds)assert.equal(await page.locator(`#${kind}-panel [data-sort="round${round}"]`).count(),1);
  }
  assert.equal(await page.locator('#division-label').textContent(),'NoviceS MS 3-on-3');
  for(const d of divisions) {
    await selectDivisions(page,[d.division]);
    await checkCounts(page,[d]);
  }
  await page.locator('#division').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#division-options').isVisible(),true);
  await page.getByRole('checkbox',{name:'All divisions',exact:true}).check();
  await checkCounts(page,divisions);
  await checkMergedRanks(page,divisions);
  const mergedAverages=(await page.locator('#speaker-rows .average').allTextContents()).filter(x=>x!=='—').map(Number);
  assert.deepEqual(mergedAverages,[...mergedAverages].sort((a,b)=>b-a));
  assert.equal(await page.locator('#division-label').textContent(),'All divisions');
  await page.getByRole('checkbox',{name:'NoviceS MS 3-on-3',exact:true}).uncheck();
  await checkCounts(page,divisions.filter(d=>d.division!=='NoviceS MS 3-on-3'));
  assert.equal(await page.locator('#division-all').evaluate(e=>e.indeterminate),true);
  await page.getByRole('checkbox',{name:'All divisions',exact:true}).check();
  await page.getByRole('checkbox',{name:'All divisions',exact:true}).uncheck();
  await checkCounts(page,[]);
  assert.equal(await page.locator('#empty').textContent(),'Select a division.');
  const pair=divisions.filter(d=>d.division.startsWith('Novice'));
  await selectDivisions(page,pair.map(d=>d.division));
  await checkCounts(page,pair);
  await checkMergedRanks(page,pair);
  await page.locator('#speaker-panel [data-sort="name"]').click();
  const mergedNames=await page.locator('#speaker-rows .speaker-name').allTextContents();
  assert.deepEqual(mergedNames,[...mergedNames].sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'})));
  await page.locator('#speaker-panel [data-sort="rank"]').click();
  assert.equal(await page.locator('#division-options').isVisible(),false);
  await page.locator('#division').click();
  await page.screenshot({path:'.local/desktop-divisions.png',fullPage:false});
  await page.locator('#search').click();
  assert.equal(await page.locator('#division-options').isVisible(),false);
  await page.locator('#search').fill('Bellevue');
  assert.equal(await page.locator('#speaker-rows tr[data-name]').count(),pair.flatMap(d=>d.speakers).filter(s=>s.searchText.includes('bellevue')).length);
  assert.equal(await page.locator('#team-rows tr[data-name]').count(),pair.flatMap(d=>d.teams).filter(t=>t.searchText.includes('bellevue')).length);
  await checkMergedRanks(page,pair);
  await page.screenshot({path:'.local/desktop-merged.png',fullPage:false});
  await page.locator('#search').fill('');
  await selectDivisions(page,['NoviceS MS 3-on-3']);
  await page.screenshot({path:'.local/desktop.png',fullPage:false});
  await page.locator('#search').fill('Jia-Hao');
  const person=divisions.find(d=>d.division==='NoviceS MS 3-on-3').speakers.find(p=>p.name==='Jia-Hao Stevenson');
  const row=page.locator('#speaker-rows tr').filter({has:page.getByText('Jia-Hao Stevenson',{exact:true})});
  assert.equal(await row.count(),1);
  assert.equal(await row.locator('.average').textContent(),person.average.toFixed(2));
  assert.equal(await row.locator('.team-honors .stars').textContent(),'★'.repeat(person.awardedTeamStars));
  assert.equal(await row.locator('.room-honors .stars').textContent(),'★'.repeat(person.awardedStars));
  assert.notEqual(await row.locator('.team-stars').evaluate(e=>getComputedStyle(e).color),await row.locator('.room-stars').evaluate(e=>getComputedStyle(e).color));
  assert.equal((await row.locator('.rank').innerText()).trim(),String(person.rank));
  assert.deepEqual(await row.locator('.score').allTextContents(),snapshot.rounds.map(r=>person.rounds[r]?.score==null?'—':String(person.rounds[r].score)));
  await checkFeedback(page,person);
  await page.screenshot({path:'.local/desktop-feedback.png',fullPage:false});
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').isVisible(),false);
  assert.equal(await row.locator('.speaker-open').evaluate(e=>document.activeElement===e),true);
  await page.getByRole('tab',{name:/Team Standings/}).click();
  assert.equal(await page.locator('#team-rows tr').count(),1);
  const team=divisions.find(d=>d.division===person.rounds[1].division).teams.find(t=>t.id===person.teamId);
  assert.ok((await page.locator('#team-rows').innerText()).includes(team.record));
  assert.equal(await page.locator('#team-rows .round-result').count(),snapshot.rounds.length);
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  await page.screenshot({path:'.local/desktop-teams.png',fullPage:false});
  await page.locator('#search').fill('no-such-speaker-zzzz');assert.equal(await page.locator('#empty').isVisible(),true);
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  await page.getByRole('tab',{name:/Speaker Rankings/}).click();
  await page.locator('#speaker-panel [data-sort="average"]').click();
  const visible=await page.locator('#speaker-rows .average').allTextContents();
  const numeric=visible.filter(x=>x!=='—').map(Number);assert.deepEqual(numeric,[...numeric].sort((a,b)=>b-a));
  await page.locator('#speaker-panel [data-sort="average"]').click();
  const asc=(await page.locator('#speaker-rows .average').allTextContents()).filter(x=>x!=='—').map(Number);assert.deepEqual(asc,[...asc].sort((a,b)=>a-b));
  for(const [index,round] of snapshot.rounds.entries()) {
    await page.locator(`#speaker-panel [data-sort="round${round}"]`).click();
    const values=(await page.locator(`#speaker-rows tr[data-name] td:nth-child(${index+3}) .score`).allTextContents()).filter(t=>t!=='—').map(Number);
    assert.deepEqual(values,[...values].sort((a,b)=>b-a));
  }
  const provisional=divisions.find(d=>d.division==='NoviceS MS 3-on-3').speakers.find(s=>s.scoreCount>0&&!s.complete);
  if(provisional) {
    const key=encodeURIComponent(`${provisional.division}\u0000${provisional.id}`);
    const partial=page.locator(`[data-speaker="${key}"]`).locator('xpath=ancestor::tr');
    assert.equal(await partial.locator('.provisional').textContent(),`${provisional.scoreCount}/${snapshot.rounds.length}`);
  }
  for(const [key,scope] of [['teamStars','team'],['stars','room']]) {
    for(const direction of ['desc','asc']) {
      await page.locator(`#speaker-panel [data-sort="${key}"]`).click();
      const texts=await page.locator(`#speaker-rows .${scope}-honors`).allTextContents();
      const counts=texts.filter(t=>t!=='?').map(t=>(t.match(/★/g)||[]).length);
      assert.deepEqual(counts,[...counts].sort((a,b)=>direction==='desc'?b-a:a-b));
      const unknown=texts.indexOf('?');
      if(unknown>=0)assert.ok(texts.slice(unknown).every(t=>t==='?'),'Unknown honors must sort last');
    }
  }
  // A fresh iPhone-sized page verifies default state, touch controls, and document overflow.
  const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(url,{waitUntil:'networkidle'});
  assert.equal(await mobile.locator('#division-label').textContent(),'NoviceS MS 3-on-3');
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile horizontal overflow');
  assert.equal(await mobile.locator('.honors .stars').evaluateAll(stars=>stars.every(star=>{
    const text=star.getBoundingClientRect(),cell=star.closest('td').getBoundingClientRect();
    return text.left>=cell.left && text.right<=cell.right-2;
  })),true,'Mobile honors overflow into the next column');
  await mobile.screenshot({path:'.local/mobile.png',fullPage:false});
  const firstRow=await mobile.locator('#speaker-rows tr').first().boundingBox();
  assert.ok(firstRow.y<320,'Rankings should begin near the top on mobile');
  await mobile.locator('#rankings').scrollIntoViewIfNeeded();
  await mobile.screenshot({path:'.local/mobile-speakers.png',fullPage:false});
  await mobile.locator('#speaker-panel [data-sort="round1"]').click();
  await mobile.locator('#search').fill('Bellevue');
  await mobile.getByRole('tab',{name:/Team Standings/}).click();
  assert.ok(await mobile.locator('#team-rows tr').count()>0);
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.locator('#rankings').scrollIntoViewIfNeeded();
  await mobile.screenshot({path:'.local/mobile-teams.png',fullPage:false});
  await mobile.locator('#search').fill('');
  await mobile.locator('#division').click();
  await mobile.getByRole('checkbox',{name:'All divisions',exact:true}).check();
  await checkCounts(mobile,divisions);
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.screenshot({path:'.local/mobile-divisions.png',fullPage:false});
  await mobile.keyboard.press('Escape');
  await mobile.getByRole('tab',{name:/Speaker Rankings/}).click();
  await checkMergedRanks(mobile,divisions);
  await mobile.locator('#speaker-panel [data-sort="rank"]').click();
  await mobile.screenshot({path:'.local/mobile-merged-speakers.png',fullPage:false});
  await mobile.getByRole('tab',{name:/Team Standings/}).click();
  await mobile.screenshot({path:'.local/mobile-merged-teams.png',fullPage:false});
  await mobile.getByRole('tab',{name:/Speaker Rankings/}).click();
  await mobile.locator('#search').fill(person.name);
  await checkFeedback(mobile,person);
  await mobile.screenshot({path:'.local/mobile-feedback.png',fullPage:false});
  await mobile.getByRole('button',{name:'Close speaker feedback',exact:true}).click();
  assert.equal(await mobile.getByRole('dialog').isVisible(),false);
  await mobile.locator('#search').fill('');
  const withBoth=divisions.flatMap(d=>d.speakers).find(s=>s.rounds[1]?.feedback&&s.rounds[2]?.feedback);
  assert.ok(withBoth,'Expected at least one speaker with feedback in both rounds');
  await checkFeedback(mobile,withBoth);
  await mobile.getByRole('button',{name:'Close speaker feedback',exact:true}).click();
  assert.deepEqual(errors,[]);
  assert.ok(requests.every(r=>new URL(r).origin===new URL(url).origin),'External runtime request');
  console.log(`Browser QA passed at ${url}: division multi-select, search, sorting, scores, speaker feedback and missing states, popup keyboard/focus behavior, desktop and iPhone layouts, no script errors or live source requests.`);
}finally{await browser.close();}
