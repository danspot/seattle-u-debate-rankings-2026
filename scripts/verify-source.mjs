import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';
import { readSpeakerFeedback, attachSpeakerFeedback } from './feedback.mjs';
import { readBallotDetails } from './archive.mjs';
const data=JSON.parse(await readFile(process.env.SNAPSHOT_PATH || 'data/results.json','utf8'));
const refreshFeedback=process.env.REFRESH_FEEDBACK==='1';
let feedbackRefreshes=0;
const browser=await launchBrowser();
const audit=[],pageAudit=[],failures=[];
const selected=data.debates.filter(d=>d.ballot && [d.aff.name,d.neg.name].some(t=>t.includes('Jia-Hao Stevenson')));
const extraIds=new Set((process.env.AUDIT_IDS || '').split(',').filter(Boolean));
selected.push(...data.debates.filter(d=>d.ballot && extraIds.has(d.id)));
for(const division of data.divisions)for(const round of data.rounds){
  const sample=data.debates.find(d=>d.division===division&&d.round===round&&d.ballot?.feedbackNoteCount>0);
  if(sample)selected.push(sample);
}
const target=[...new Map(selected.map(d=>[d.id,d])).values()];
console.log(`Auditing ${target.length} ballots with three browser pages.`);
let next=0;
async function check(page,d) {
  const context=`ballot ${d.id}, ${d.division}, Round ${d.round}`;
  await page.goto(data.source,{waitUntil:'networkidle'});
  await page.locator('#round-select').click();await page.getByRole('option',{name:`Round ${d.round}`,exact:true}).click();
  await page.locator('#division-select').click();await page.getByRole('option',{name:d.division,exact:true}).click();
  const row=page.locator('tbody tr').filter({has:page.locator(`[id="view-ballot-${d.id}"]`)});
  await row.waitFor();
  const cells=await row.locator('td').allTextContents();
  assert.equal(cells[1],d.aff.name,`Team mismatch: ${context}`);assert.equal(cells[2],d.neg.name,`Team mismatch: ${context}`);assert.equal(cells[4],d.room,`Room mismatch: ${context}`);
  const styles=await row.locator('td span[aria-label]').evaluateAll(es=>es.map(e=>({name:e.textContent,weight:getComputedStyle(e).fontWeight,decoration:getComputedStyle(e).textDecorationLine})));
  const winner=styles.find(s=>s.decoration.includes('underline'))?.name;
  assert.ok(winner===d[d.winnerSide]?.name,`Decision changed since extraction: ${context}; expected ${d[d.winnerSide]?.name}, found ${winner}`);
  await row.getByRole('button',{name:'View Ballot & Comments'}).click();
  await page.getByRole('heading',{name:`Round ${d.round}`,exact:true}).waitFor();
  assert.equal(page.url(),d.ballot.url);
  const ballotWinner=await page.getByText(/^Winner: (Proposition|Opposition)$/).innerText();
  assert.ok(ballotWinner===`Winner: ${d.winnerSide==='aff'?'Proposition':'Opposition'}`,`Ballot/result decision mismatch: ${context}`);
  if(data.schemaVersion>=3) {
    const topic=page.locator('[data-testid="ballot-debate-topic"] h2 + *');
    assert.equal(await topic.count()? (await topic.innerText()).trim() || null:null,d.ballot.topic,`Topic mismatch: ${context}`);
    const heading=page.getByRole('heading',{name:'Decision / Reason for Decision',exact:true});
    assert.equal(await heading.count()?(await heading.locator('xpath=following-sibling::*[1]').innerText()).trim() || null:null,d.ballot.decisionText,`Decision text mismatch: ${context}`);
    if(!refreshFeedback)assert.equal((await page.locator('main').innerText()).trim(),d.ballot.archive.text,`Full ballot archive mismatch: ${context}`);
  }
  for(const [sideKey,side] of Object.entries(d.ballot.sides)) {
    const sideLabel=sideKey==='aff'?'Proposition':'Opposition';
    // Read rendered score-card text separately for each side, independently of the scraper's p-element parser.
    const sideText=await page.getByRole('heading',{name:sideLabel,exact:true}).locator('xpath=../..').innerText();
    for(const [position,speaker] of side.speakers.entries()) {
      const escaped=speaker.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const actualScore=sideText.match(new RegExp(`${escaped}\\s+([^\\s]+)\\s+pts`))?.[1];
      assert.ok(actualScore===speaker.displayedScore,`Score changed since extraction: ${context}, ${sideLabel}, ${speaker.name}; expected ${speaker.displayedScore}, found ${actualScore}`);
      const label=page.getByText(`${sideLabel} Speaker ${position+1} — ${speaker.name}`,{exact:true});
      const actualFeedback=await label.count()?(await label.locator('xpath=following-sibling::*[1]').innerText()).trim():'';
      if(!refreshFeedback)assert.ok(actualFeedback===(speaker.feedback?.text || ''),`Feedback changed since extraction: ${context}, ${sideLabel}, ${speaker.name}`);
    }
  }
  if(refreshFeedback) {
    const before=JSON.stringify(d.ballot);
    attachSpeakerFeedback(d.ballot,await page.evaluate(readSpeakerFeedback));
    if(data.schemaVersion>=3)Object.assign(d.ballot,await page.evaluate(readBallotDetails));
    if(before!==JSON.stringify(d.ballot))feedbackRefreshes++;
  }
  audit.push({id:d.id,round:d.round,room:d.room,styles,passed:true});
  console.log(`Independently checked ${context}: scores and individual feedback match.`);
}
async function worker(){
  const page=await browser.newPage();page.setDefaultTimeout(20000);
  try {while(next<target.length){const d=target[next++];try{await check(page,d);}catch(error){failures.push({id:d.id,message:error.message});console.error(`AUDIT FAILED: ${error.message}`);}}}
  finally {await page.close();}
}
try {
  const outcomes=await Promise.allSettled(Array.from({length:Math.min(3,target.length)},()=>worker()));
  for(const outcome of outcomes)if(outcome.status==='rejected')failures.push({message:outcome.reason.message});
  if(data.archive) {
    const page=await browser.newPage();page.setDefaultTimeout(20000);
    try {for(const saved of data.archive.pages) {
      try {
        await page.goto(saved.url,{waitUntil:'networkidle'});
        await page.locator('main').getByRole('heading').first().waitFor();
        if(saved.round){
          await page.locator('#round-select').click();await page.getByRole('option',{name:`Round ${saved.round}`,exact:true}).click();
          await page.locator('#division-select').click();await page.getByRole('option',{name:'All Divisions',exact:true}).click();
        }
        if(saved.tableRows)await page.waitForFunction(count=>document.querySelectorAll('main tbody tr').length===count,saved.tableRows);
        assert.ok((await page.locator('main').innerText()).trim()===saved.text,`Archived page changed since capture: ${saved.id}`);
        pageAudit.push({id:saved.id,passed:true});
      } catch(error){failures.push({id:saved.id,message:error.message});console.error(`AUDIT FAILED: ${error.message}`);}
    }} finally {await page.close();}
    console.log(`Independently checked ${pageAudit.length} public tournament pages.`);
  }
  await mkdir('.local',{recursive:true});
  await writeFile('.local/source-audit.json',JSON.stringify({checkedAt:new Date().toISOString(),audit,pageAudit,failures,feedbackRefreshes},null,2));
  assert.ok(failures.length===0,`${failures.length} ballot audit(s) failed: ${failures.map(f=>f.message).join('; ')}`);
  if(feedbackRefreshes){data.extractedAt=new Date().toISOString();await writeFile(process.env.SNAPSHOT_PATH || 'data/results.json',JSON.stringify(data,null,2)+'\n');console.log(`Refreshed live speaker feedback on ${feedbackRefreshes} audited ballots.`);}
} finally {await browser.close();}
