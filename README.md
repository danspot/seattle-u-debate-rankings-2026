# Seattle U Debate Rankings — November 21, 2026

Public site: **https://danspot.github.io/seattle-u-debate-rankings-2026/**

Independent rankings for Rounds **1 and 2 only**, sourced exclusively from [Plustab](https://plustab.org/t/seattle-u-sat-nov-21-2026/results). No login, backend, live API requests, scheduled scraping, or paid services. The generated `index.html` embeds its data, styles, and JavaScript and also works as a standalone local file.

## Refresh and republish

Ask Codex: **“Update the debate rankings.”** Codex should rerun extraction, validation, generation, browser QA, commit and push the new snapshot, and verify the public GitHub Pages deployment. Keep the scope at Rounds 1 and 2 unless explicitly requested otherwise.

For a manual run, use Node.js 22 or newer, Git, and an authenticated GitHub CLI:

```sh
npm ci
npx playwright install chromium
npm run scrape
npm run verify
node scripts/verify-source.mjs
npm test
npm run build
npm run preview
```

In another terminal, run `npm run qa`. The preview uses http://127.0.0.1:4173. Stop it after checking. If using an existing Chromium executable instead of Playwright's download, set `CHROMIUM_PATH` to its absolute path (PowerShell: `$env:CHROMIUM_PATH='C:\path\to\chrome.exe'`). The browser runs headlessly.

Review the changed data and coverage notes, then publish:

```sh
git add index.html data/results.json data/verification.json
git commit -m "Refresh Round 1 and 2 tournament snapshot"
git push origin main
gh run list --limit 5
```

GitHub Pages publishes from the `main` branch, repository root. `.nojekyll` keeps it a plain static site. Wait for the new `pages-build-deployment` run to succeed (`gh run watch <run-id> --exit-status`), then run:

```sh
node scripts/qa.mjs https://danspot.github.io/seattle-u-debate-rankings-2026/
```

Check that the public extraction timestamp and downloaded `data/results.json` match the committed snapshot. Never publish a failed or partial extraction. The scraper writes the public JSON only after finishing every selected division and round; diagnostic progress stays in ignored `.local/`.

## Files

- `index.html`: generated, self-contained public site. Edit the files under `site/`, then build.
- `data/results.json`: actual result rows, computed winner styles, speaker scores and individual feedback, URLs, and extraction timestamps. Context nests each score and feedback note under its team, division, round, and room; opponents are the other side of the same debate.
- `data/verification.json`: consistency report and the requested test case; not featured in the page.
- `scripts/scrape.mjs`: Playwright browser extraction. Explicitly selects each division and Round 1/2, clicks every available ballot, verifies context, and restores filters after navigation.
- `scripts/feedback.mjs`: extracts original individual speaker feedback and matches each note by side, speaking position, and speaker name. General decision explanations are not attributed to individual speakers.
- `scripts/rankings.mjs`: shared ranking and standings calculation.
- `scripts/verify.mjs`: checks duplicate debates/rooms/teams/speakers, roster consistency across rounds, ballot context, numeric scores and team totals, source-style/ballot decisions, paired win/loss results, and rank arithmetic.
- `scripts/verify-source.mjs`: independently revisits the requested team's ballots plus feedback samples from both rounds of each populated division in Chromium.
- `scripts/build.mjs`: validates and generates the public HTML plus verification report.
- `scripts/qa.mjs`: Chromium checks at desktop and iPhone sizes; screenshots remain local and ignored.
- `tests/rankings.test.mjs`: edge cases for ties, missing scores, BYEs, duplicate identities, and unknown decisions.
- `tests/feedback.test.mjs`: same-name speakers on opposite teams, speaker-position mismatches, duplicate notes, and absent or multiline feedback.

## Interpretation

Speaker rank uses the average of available numeric scores. One-round averages are visibly provisional and participate in this ranking; each speaker's expanded details also shows rank among entries with two scores. Equal averages use competition ranks (1, 2, 2, 4). Search and table sorting preserve the original ranks.

The division dropdown supports multiple selections and All divisions, with NoviceS selected by default. When several divisions are selected, both tables group entries by division and sort within each group. Ranks are never combined across divisions; search covers all selected groups.

Click a speaker's name to open their feedback popup. It combines the original notes from Rounds 1 and 2, labeled by round and judge, with source ballot links. Missing feedback is explicit. Notes are preserved as written, not summarized or inferred; they are safely rendered as plain text. Feedback refreshes with `npm run scrape` and remains part of the committed static snapshot.

Blue stars count rounds with the highest score on the speaker's own team; gold stars count rounds with the highest score across both teams in the room. Each set awards one star per qualifying round, including ties, and is sortable separately. BYEs earn no stars. Missing scores leave that comparison unverified (`?`); a team high can still be verified when only an opponent's score is missing. The speaker popup shows which honors were earned in each round.

Team standings group complete 2–0, 1–1, and 0–2 records, with a shared standing and alphabetical order within each group. A BYE is a win only when the rendered result styling and ballot both confirm it. `B` is never converted to a numeric score. Incomplete team records remain separate and unranked.

The source's `ABC`, `abc`, and `aa` roster labels are retained and flagged; they are scored source entries, not inferred identities. Counts include these labels, with separate named/label counts in the verification report. The `Test mars-almond-hershey` entry is likewise retained as displayed, without treating it as an ordinary BYE or inventing a missing Round 2 result. All source dropdown divisions, including empty `DONTUSETHIS MS 3-on-3`, are preserved. Individual speaker comments are published at the user's request.

The source's own “Last updated” label is retained verbatim but is not used as the extraction timestamp. `extractedAt` is captured by the scraper in UTC and displayed in Pacific time.
