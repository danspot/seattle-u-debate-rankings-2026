import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.mjs';
const data=JSON.parse(await readFile(process.env.SNAPSHOT_PATH || 'data/results.json','utf8'));
const browser=await launchBrowser();const page=await browser.newPage();
const audit=[];
try {
  const selected=data.debates.filter(d=>d.ballot && [d.aff.name,d.neg.name].some(t=>t.includes('Jia-Hao Stevenson')));
  const extraIds=new Set((process.env.AUDIT_IDS || '').split(',').filter(Boolean));
  selected.push(...data.debates.filter(d=>d.ballot && extraIds.has(d.id)));
  for (const division of data.divisions) {
    for (const round of data.rounds) {
      const sample=data.debates.find(d=>d.division===division&&d.round===round&&d.ballot?.feedbackNoteCount>0);
      if(sample)selected.push(sample);
    }
  }
  const target=[...new Map(selected.map(d=>[d.id,d])).values()];
  for(const d of target) {
    await page.goto(data.source,{waitUntil:'networkidle'});
    await page.locator('#round-select').click();await page.getByRole('option',{name:`Round ${d.round}`,exact:true}).click();
    await page.locator('#division-select').click();await page.getByRole('option',{name:d.division,exact:true}).click();
    const row=page.locator('tbody tr').filter({has:page.locator(`[id="view-ballot-${d.id}"]`)});
    const cells=await row.locator('td').allTextContents();
    assert.equal(cells[1],d.aff.name);assert.equal(cells[2],d.neg.name);assert.equal(cells[4],d.room);
    const styles=await row.locator('td span[aria-label]').evaluateAll(es=>es.map(e=>({name:e.textContent,weight:getComputedStyle(e).fontWeight,decoration:getComputedStyle(e).textDecorationLine})));
    assert.equal(styles.find(s=>s.decoration.includes('underline')).name,d[d.winnerSide].name);
    await row.getByRole('button',{name:'View Ballot & Comments'}).click();
    await page.getByRole('button',{name:'Back to Results',exact:true}).waitFor();
    // Independently inspect the text of the score-card container, excluding the comments sibling.
    const scoreCardText=await page.getByText('Proposition',{exact:true}).locator('xpath=../../../../..').innerText();
    const safeText=scoreCardText.split(/JUDGE COMMENTS|Judge Comments/)[0];
    for(const [sideKey,side] of Object.entries(d.ballot.sides)) {
      for(const [position,speaker] of side.speakers.entries()) {
        const escaped=speaker.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        assert.match(safeText,new RegExp(`${escaped}\\s+${speaker.displayedScore}\\s+pts`),`Score audit ${speaker.name} R${d.round}`);
        const heading=`${sideKey==='aff'?'Proposition':'Opposition'} Speaker ${position+1} — ${speaker.name}`;
        const label=page.getByText(heading,{exact:true});
        if (speaker.feedback) {
          assert.equal(await label.count(),1);
          const actual=await label.locator('xpath=following-sibling::*[1]').innerText();
          assert.equal(actual.trim(),speaker.feedback.text,`Feedback audit ${speaker.name} R${d.round}`);
        } else {
          if(await label.count())assert.equal((await label.locator('xpath=following-sibling::*[1]').innerText()).trim(),'');
        }
      }
    }
    audit.push({id:d.id,round:d.round,room:d.room,styles,scores:Object.values(d.ballot.sides).flatMap(s=>s.speakers.map(p=>({team:s.teamName,...p}))),passed:true});
    console.log(`Independently checked ballot ${d.id}, Round ${d.round}: scores and individual feedback match.`);
  }
  await mkdir('.local',{recursive:true});
  await writeFile('.local/source-audit.json',JSON.stringify({checkedAt:new Date().toISOString(),audit},null,2));
} finally { await browser.close(); }
