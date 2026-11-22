import { mkdir, writeFile, rename } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { launchBrowser } from './browser.mjs';
import { readSpeakerFeedback, attachSpeakerFeedback } from './feedback.mjs';

const source = 'https://plustab.org/t/seattle-u-sat-nov-21-2026/results';
const startedAt = new Date().toISOString();
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.setDefaultTimeout(20000);
const debates = [];

async function select(id, label) {
  await page.locator(id).click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await page.waitForFunction(({ id, label }) => document.querySelector(id)?.textContent.trim() === label, { id, label });
  await page.waitForTimeout(200);
}

try {
  await page.goto(source, { waitUntil: 'networkidle' });
  await page.locator('#division-select').click();
  const divisions = (await page.getByRole('option').allTextContents()).map(x => x.trim()).filter(x => x !== 'All Divisions');
  await page.keyboard.press('Escape');
  console.log('Divisions:', divisions.join(', '));
  await page.locator('#round-select').click();
  const availableRounds = await page.getByRole('option').allTextContents();
  await page.keyboard.press('Escape');
  const rounds = [1, 2, 3, 4].filter(round => availableRounds.some(label => label.trim() === `Round ${round}`));
  assert.ok(rounds.includes(1) && rounds.includes(2), 'Required rounds unavailable');
  let sourceUpdatedLabel = null;
  for (const round of rounds) {
    await select('#round-select', `Round ${round}`);
    for (const division of divisions) {
      await select('#division-select', division);
      const selected = await page.locator('#round-select').innerText();
      assert.equal(selected.trim(), `Round ${round}`);
      // Read only result rows. Winner evidence comes from actual computed styles.
      const rows = await page.locator('tbody tr').evaluateAll(rows => rows.map(row => {
        const cells = [...row.querySelectorAll('td')];
        if (cells.length !== 6) return null;
        const team = i => {
          const el = cells[i].querySelector('span[aria-label]') || cells[i];
          const css = getComputedStyle(el);
          return { name: el.textContent.trim(), style: { fontWeight: css.fontWeight, textDecorationLine: css.textDecorationLine } };
        };
        return { division: cells[0].textContent.trim(), aff: team(1), neg: team(2), room: cells[4].textContent.trim(), buttonId: cells[5].querySelector('button')?.id || null };
      }).filter(Boolean));
      console.log(`Round ${round} / ${division}: ${rows.length} debates`);
      const updated = page.getByText(/^Last updated /);
      if (await updated.count()) sourceUpdatedLabel = await updated.first().innerText();
      for (const [i, row] of rows.entries()) {
        assert.equal(row.division, division);
        const marked = ['aff', 'neg'].filter(side => row[side].style.textDecorationLine.includes('underline'));
        const bold = ['aff', 'neg'].filter(side => Number(row[side].style.fontWeight) > Number(row[side === 'aff' ? 'neg' : 'aff'].style.fontWeight));
        const winnerSide = marked.length === 1 ? marked[0] : marked.length === 0 && bold.length === 1 ? bold[0] : null;
        const debate = {
          id: row.buttonId?.replace('view-ballot-', '') || `${division}-r${round}-${i + 1}`,
          division, round, room: row.room, aff: row.aff, neg: row.neg, winnerSide,
          winnerEvidence: marked.length === 1 ? 'computed underline' : winnerSide ? 'computed relative font weight' : 'not determined',
          isBye: [row.aff.name, row.neg.name].includes('BYE'),
          ballotStatus: row.buttonId ? 'pending' : 'unavailable', ballot: null
        };
        if (row.buttonId) {
          await page.locator(`[id="${row.buttonId}"]`).click();
          await page.getByRole('button', { name: 'Back to Results', exact: true }).waitFor();
          await page.getByText(/^Ballot:/).waitFor();
          // Read score cards, then match individual speaker feedback separately.
          debate.ballot = await page.evaluate(() => {
            const norm = el => el?.textContent.trim() || '';
            const headings = [...document.querySelectorAll('h6')];
            const sides = {};
            for (const [key, label] of [['aff', 'Proposition'], ['neg', 'Opposition']]) {
              const h = headings.find(e => e.querySelector('span')?.textContent.trim() === label);
              if (!h) continue;
              const side = h.parentElement.parentElement;
              const lines = [...side.querySelectorAll('p')].map(norm);
              const speakers = [];
              let total = null;
              for (let j = 1; j < lines.length; j += 3) {
                if (lines[j + 2] !== 'pts') throw new Error(`Unrecognized score card: ${lines.slice(j, j+3).join('|')}`);
                const scoreText = lines[j + 1];
                const score = /^\d+(?:\.\d+)?$/.test(scoreText) ? Number(scoreText) : null;
                if (lines[j] === 'Total') total = score;
                else speakers.push({ name: lines[j], score, displayedScore: scoreText });
              }
              sides[key] = { school: '', teamName: lines[0], speakers, total };
              const schoolHeading = [...h.parentElement.querySelectorAll('h6')].find(e => e !== h);
              sides[key].school = norm(schoolHeading);
            }
            const matchHeading = document.querySelector('h3');
            const meta = [...document.querySelectorAll('p strong')].map(norm);
            const winner = [...document.querySelectorAll('span')].map(norm).find(t => /^Winner: (Proposition|Opposition)$/.test(t));
            return {
              code: [...document.querySelectorAll('h2 span')].map(norm).find(x => x.startsWith('Ballot:'))?.replace(/^Ballot:\s*/, '') || null,
              roundLabel: headings.map(norm).find(x => /^Round \d+$/.test(x)) || null,
              match: norm(matchHeading), division: meta[0] || null, room: meta[1] || null,
              winnerSide: winner === 'Winner: Proposition' ? 'aff' : winner === 'Winner: Opposition' ? 'neg' : null,
              sides
            };
          });
          attachSpeakerFeedback(debate.ballot, await page.evaluate(readSpeakerFeedback));
          debate.ballot.url = page.url();
          assert.equal(debate.ballot.roundLabel, `Round ${round}`, `Wrong round on ballot ${debate.id}`);
          assert.equal(debate.ballot.division, division);
          assert.equal(debate.ballot.room, row.room);
          for (const side of ['aff', 'neg']) {
            if (debate.ballot.sides[side]) {
              if (row[side].name === 'BYE') assert.match(debate.ballot.sides[side].teamName, /^BYE\b/);
              else assert.equal(debate.ballot.sides[side].teamName, row[side].name);
            }
          }
          debate.ballotStatus = Object.values(debate.ballot.sides).some(s => s.speakers.some(p => p.score !== null)) ? 'scored' : 'no-scores';
          await page.getByRole('button', { name: 'Back to Results', exact: true }).click();
          await page.locator('#round-select').waitFor();
          // Navigation may reset filters to the current round. Always restore both.
          if ((await page.locator('#round-select').innerText()).trim() !== `Round ${round}`) await select('#round-select', `Round ${round}`);
          if ((await page.locator('#division-select').innerText()).trim() !== division) await select('#division-select', division);
        }
        debates.push(debate);
        await mkdir('.local', { recursive: true });
        await writeFile('.local/scrape-progress.json', JSON.stringify({ startedAt, divisions, debates }, null, 2));
        console.log(`  ${i + 1}/${rows.length} ${row.room}: ${debate.ballotStatus}${debate.isBye ? ' (BYE)' : ''}; ${debate.ballot?.feedbackNoteCount || 0} feedback notes`);
      }
    }
  }
  const snapshot = { schemaVersion: 2, title: 'Seattle U Debate Rankings — November 21, 2026', source, extractedAt: new Date().toISOString(), extractionStartedAt: startedAt, sourceUpdatedLabel, rounds, divisions, debates };
  const output = process.env.SCRAPE_OUTPUT || 'data/results.json';
  await mkdir(dirname(output), { recursive: true });
  await writeFile(`${output}.next`, JSON.stringify(snapshot, null, 2) + '\n');
  await rename(`${output}.next`, output);
  console.log(`Saved ${debates.length} debates and ${debates.reduce((n,d)=>n+(d.ballot?.feedbackNoteCount || 0),0)} individual feedback notes.`);
} finally {
  await browser.close();
}
