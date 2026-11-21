import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.mjs';
const data=JSON.parse(await readFile('data/results.json','utf8'));
const browser=await launchBrowser();const page=await browser.newPage();
const audit=[];
try {
  const target=data.debates.filter(d=>[d.aff.name,d.neg.name].some(t=>t.includes('Jia-Hao Stevenson')));
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
    const card=page.locator('h6').filter({has:page.locator('span').getByText('Proposition',{exact:true})});
    const scoreCardText=await page.getByText('Proposition',{exact:true}).locator('xpath=../../../../..').innerText();
    const safeText=scoreCardText.split(/JUDGE COMMENTS|Judge Comments/)[0];
    for(const side of Object.values(d.ballot.sides)) {
      for(const speaker of side.speakers) {
        const escaped=speaker.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        assert.match(safeText,new RegExp(`${escaped}\\s+${speaker.displayedScore}\\s+pts`),`Score audit ${speaker.name} R${d.round}`);
      }
    }
    audit.push({id:d.id,round:d.round,room:d.room,styles,scores:Object.values(d.ballot.sides).flatMap(s=>s.speakers.map(p=>({team:s.teamName,...p}))),passed:true});
    console.log(`Independently checked target ballot ${d.id}, Round ${d.round}: all six scores match.`);
  }
  await mkdir('.local',{recursive:true});
  await writeFile('.local/source-audit.json',JSON.stringify({checkedAt:new Date().toISOString(),audit},null,2));
} finally { await browser.close(); }
