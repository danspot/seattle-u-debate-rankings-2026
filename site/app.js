const snapshot = JSON.parse(document.querySelector('#results-data').textContent);
const divisions = deriveAll(snapshot);
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scoreText = value => value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 3 });
const averageText = value => value === null ? '—' : Number(value).toFixed(2);
let current = divisions.find(d => d.division === 'NoviceS MS 3-on-3') || divisions[0];
let activeTab = 'speaker';
const sort = { speaker: { key: 'rank', direction: 'asc' }, team: { key: 'rank', direction: 'asc' } };
const stamp = new Intl.DateTimeFormat('en-US', { dateStyle:'medium', timeStyle:'short', timeZone:'America/Los_Angeles' }).format(new Date(snapshot.extractedAt));
$('extracted').textContent = `Extracted ${stamp} Pacific`;
$('extracted').title = snapshot.extractedAt;
$('source-updated').textContent = `Source page label: ${snapshot.sourceUpdatedLabel || 'not provided'}. The extraction time above is recorded independently in UTC and displayed in Pacific time.`;
$('division').innerHTML = divisions.map(d => `<option value="${esc(d.division)}">${esc(d.division)}</option>`).join('');
$('division').value = current.division;

function sortRows(rows, kind) {
  const { key, direction } = sort[kind];
  const value = row => {
    if (key.startsWith('round')) {
      const r = row.rounds[Number(key.slice(-1))];
      return kind === 'speaker' ? r?.score : r?.result === 'W' ? 1 : r?.result === 'L' ? 0 : null;
    }
    if (key === 'name' && kind === 'team') return row.displayName;
    if (key === 'stars') return row.awardedStars;
    return row[key];
  };
  return [...rows].sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av === null || av === undefined) return bv === null || bv === undefined ? a.name.localeCompare(b.name) : 1;
    if (bv === null || bv === undefined) return -1;
    const compare = typeof av === 'number' ? av - bv : av.localeCompare(bv, 'en', {sensitivity:'base'});
    return compare * (direction === 'asc' ? 1 : -1) || (kind === 'team' ? a.displayName : a.name).localeCompare(kind === 'team' ? b.displayName : b.name);
  });
}
function scoreCell(speaker, round) {
  const entry = speaker.rounds[round];
  const missing = entry?.isBye ? 'BYE' : entry?.displayedScore && entry.displayedScore !== '—' ? `Source: ${entry.displayedScore}` : 'Unavailable';
  return `<td class="score-cell"><span class="mobile-label">Round ${round}</span><span class="score${entry?.score == null ? ' missing' : ''}">${scoreText(entry?.score)}</span>${entry?.score == null ? `<span class="sub">${esc(missing)}</span>` : ''}</td>`;
}
function speakerDetails(speaker) {
  return `<details class="row-detail"><summary>Team & rounds</summary><p>${esc(speaker.team)}</p>${[1,2].map(round => {
    const r = speaker.rounds[round];
    if (!r) return `<p>Round ${round}: no score or ballot entry available.</p>`;
    const high = r.roomHighest === true ? ' · Room-highest (including ties)' : r.roomHighest === null && !r.isBye ? ' · Room high unverified' : '';
    return `<p><strong>R${round}</strong> · ${esc(r.room)}<br>vs. ${esc(r.opponent)}${high}${r.ballotUrl ? `<br><a href="${esc(r.ballotUrl)}" target="_blank" rel="noopener">Source ballot for Round ${round}</a>` : ''}</p>`;
  }).join('')}${speaker.completeRank ? `<p>Rank among entries with both scores: ${speaker.completeRank}.</p>` : ''}</details>`;
}
function renderSpeaker(speaker) {
  const honors = speaker.awardedStars ? `<span class="stars" aria-label="Room-highest in ${speaker.awardedStars} ${speaker.awardedStars === 1 ? 'round' : 'rounds'}">${'★'.repeat(speaker.awardedStars)}</span>` : '<span class="missing">—</span>';
  return `<tr data-name="${esc(speaker.name)}"><td class="rank"><span class="mobile-label">Rank </span>${speaker.rank ?? '—'}</td><td class="person"><span class="speaker-name">${esc(speaker.name)}</span><span class="sub">${esc(speaker.school || speaker.team)}</span>${speaker.sourceRosterLabel ? '<span class="source-label">Source roster label</span>' : ''}${speakerDetails(speaker)}</td>${scoreCell(speaker,1)}${scoreCell(speaker,2)}<td class="score-cell"><span class="mobile-label">Average</span><span class="average">${averageText(speaker.average)}</span><span class="sub">${speaker.complete ? '2 of 2 rounds' : speaker.scoreCount ? '<span class="pill provisional">1 round · provisional</span>' : 'No numeric scores'}</span></td><td class="honors"><span class="mobile-label">Room honors</span>${honors}${!speaker.starStatusKnown ? `<span class="sub">${speaker.stars ? `${speaker.stars} high verified;<br>` : ''}incomplete</span>` : ''}</td></tr>`;
}
function teamRound(team, round) {
  const r = team.rounds[round];
  if (!r) return `<td><span class="mobile-label">Round ${round}</span><span class="missing">Not listed</span></td>`;
  return `<td><span class="mobile-label">Round ${round}</span>${r.result ? `<span class="outcome${r.result === 'L' ? ' loss' : ''}">${r.result}</span>` : '<span class="missing">Unknown</span>'}${r.isBye ? '<span class="sub">BYE · source decision</span>' : ''}<span class="opponent">${r.isBye ? 'No opponent' : `vs. ${esc(r.opponent)}`}</span><span class="sub">${esc(r.room)}</span>${r.ballotUrl ? `<a class="row-detail" href="${esc(r.ballotUrl)}" target="_blank" rel="noopener">Ballot</a>` : '<span class="sub">Ballot unavailable</span>'}</td>`;
}
function renderTeam(team) {
  return `<tr data-name="${esc(team.name)}"><td class="rank"><span class="mobile-label">Standing </span>${team.rank ?? '—'}${team.complete ? '<span class="sub">shared</span>' : ''}</td><td><span class="team-name">${esc(team.school || team.name)}</span>${team.members.length ? `<span class="team-members">${team.members.map(esc).join(', ')}</span><span class="team-source">Source team: ${esc(team.name)}</span>` : '<span class="sub">Member roster unavailable</span>'}</td><td class="record"><span class="mobile-label">Record </span>${team.record}${!team.complete ? '<span class="sub"><span class="pill provisional">Incomplete</span></span>' : ''}</td>${teamRound(team,1)}${teamRound(team,2)}</tr>`;
}
function render() {
  const query = normalize($('search').value);
  const speakers = current.speakers.filter(s => s.searchText.includes(query));
  const teams = current.teams.filter(t => t.searchText.includes(query));
  $('speaker-rows').innerHTML = sortRows(speakers,'speaker').map(renderSpeaker).join('');
  $('team-rows').innerHTML = sortRows(teams,'team').map(renderTeam).join('');
  $('clear').hidden = !query;
  $('speaker-tab-count').textContent = speakers.length;
  $('team-tab-count').textContent = teams.length;
  const speakerActive = activeTab === 'speaker';
  $('speaker-panel').hidden = !speakerActive;
  $('team-panel').hidden = speakerActive;
  for (const kind of ['speaker','team']) {
    $(`${kind}-tab`).setAttribute('aria-selected', String(activeTab === kind));
    $(`${kind}-tab`).tabIndex = activeTab === kind ? 0 : -1;
    document.querySelectorAll(`#${kind}-panel th`).forEach(th => {
      th.removeAttribute('aria-sort');
      const selected = th.dataset.key === sort[kind].key;
      th.querySelector('span').textContent = selected ? sort[kind].direction === 'asc' ? '↑' : '↓' : '↕';
      if(selected) th.setAttribute('aria-sort', sort[kind].direction === 'asc' ? 'ascending' : 'descending');
    });
  }
  $('section-title').textContent = speakerActive ? 'Speaker rankings' : 'Team standings';
  $('section-note').textContent = speakerActive ? 'Ranked by available-score average · ties share a rank' : 'Grouped by record · tied teams listed alphabetically';
  const visible = speakerActive ? speakers.length : teams.length;
  const all = speakerActive ? current.speakers.length : current.teams.length;
  $('showing').textContent = `Showing ${visible} of ${all} ${speakerActive ? 'entries' : 'teams'}`;
  $('empty').hidden = visible > 0;
  $('empty').textContent = all === 0 ? 'No Round 1 or Round 2 debates are listed for this division on the source website.' : 'No matching results. Try another name or clear the search.';
}
function changeDivision() {
  current = divisions.find(d => d.division === $('division').value);
  const c = current.counts;
  $('team-count').textContent = c.teams;
  $('speaker-count').textContent = c.speakers;
  $('ballot-count').textContent = c.scoredBallots;
  $('complete-count').textContent = c.completeSpeakers;
  const notes = [];
  if (c.speakers - c.completeSpeakers) notes.push(`${c.speakers - c.completeSpeakers} entries do not have two numeric scores.`);
  if (c.rosterLabels) notes.push(`${c.rosterLabels} source roster labels are retained.`);
  if (c.byes) notes.push(`${c.byes} BYE ballots; no speaker scores assigned.`);
  if (c.unavailableBallots) notes.push(`${c.unavailableBallots} ballots unavailable.`);
  $('data-note').innerHTML = `${notes.map(esc).join(' ')} ${notes.length ? '<a href="#coverage">See data notes</a>' : 'All available data is shown below.'}`;
  $('issue-count').textContent = current.issues.length ? `(${current.issues.length})` : '';
  $('issues').innerHTML = current.issues.length ? current.issues.map(i=>`<li>${esc(i.text)}</li>`).join('') : '<li>No missing or ambiguous results found in this division.</li>';
  $('coverage-summary').innerHTML = `<p>${c.debates} debates inspected across Rounds 1 and 2; ${c.scoredBallots} scored ballots, ${c.byes} BYEs, ${c.unavailableBallots} unavailable ballots. ${c.completeTeams} of ${c.teams} teams have two confirmed decisions. ${c.namedSpeakers} named speaker entries plus ${c.rosterLabels} source roster labels; ${c.completeSpeakers} entries have both numeric scores.</p>`;
  render();
}
$('division').addEventListener('change',changeDivision);
$('search').addEventListener('input',render);
$('clear').addEventListener('click',()=>{$('search').value='';render();$('search').focus();});
document.querySelector('.data-note').addEventListener('click',event=>{if(event.target.closest('a')) $('coverage').open=true;});
for (const kind of ['speaker','team']) {
  $(`${kind}-tab`).addEventListener('click',()=>{activeTab=kind;render();});
  $(`${kind}-tab`).addEventListener('keydown',event=>{
    if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();activeTab=event.key==='Home'?'speaker':event.key==='End'?'team':activeTab==='speaker'?'team':'speaker';render();$(`${activeTab}-tab`).focus();
    }
  });
  document.querySelectorAll(`#${kind}-panel [data-sort]`).forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.sort;sort[kind]={key,direction:sort[kind].key===key?(sort[kind].direction==='asc'?'desc':'asc'):['name','school','rank'].includes(key)?'asc':'desc'};render();
  }));
  $(`${kind}-sort`).addEventListener('change',event=>{const [key,direction]=event.target.value.split(':');sort[kind]={key,direction};render();});
}
changeDivision();
