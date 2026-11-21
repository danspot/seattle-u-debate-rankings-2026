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
    if (key === 'members' && kind === 'team') return row.members.join(', ');
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
  const missing = entry?.isBye ? 'BYE' : entry?.displayedScore && entry.displayedScore !== '—' ? entry.displayedScore : 'Missing';
  return `<td class="score-cell"><span class="score${entry?.score == null ? ' missing' : ''}">${scoreText(entry?.score)}</span>${entry?.score == null ? `<span class="sub">${esc(missing)}</span>` : ''}</td>`;
}
function speakerDetails(speaker) {
  return `<details class="row-detail"><summary><span class="speaker-name"${speaker.sourceRosterLabel ? ' title="Source roster label"' : ''}>${esc(speaker.name)}</span><span class="sub">${esc(speaker.school || speaker.team)}</span></summary><p>${esc(speaker.team)}</p>${[1,2].map(round => {
    const r = speaker.rounds[round];
    if (!r) return `<p>R${round}: missing.</p>`;
    const high = r.roomHighest === true ? ' · Room-highest' : '';
    return `<p><strong>R${round}</strong> · ${r.ballotUrl ? `<a href="${esc(r.ballotUrl)}" target="_blank" rel="noopener">${esc(r.room)}</a>` : esc(r.room)}<br>vs. ${esc(r.opponent)}${high}</p>`;
  }).join('')}${speaker.completeRank ? `<p>Two-score rank: ${speaker.completeRank}.</p>` : ''}</details>`;
}
function renderSpeaker(speaker) {
  const honors = speaker.awardedStars ? `<span class="stars" aria-label="Room-highest in ${speaker.awardedStars} ${speaker.awardedStars === 1 ? 'round' : 'rounds'}">${'★'.repeat(speaker.awardedStars)}</span>` : speaker.starStatusKnown ? '<span class="missing">—</span>' : '<span class="missing" title="Room honors unverified: missing scores" aria-label="Room honors unverified">?</span>';
  return `<tr data-name="${esc(speaker.name)}"><td class="rank">${speaker.rank ?? '—'}</td><td class="person">${speakerDetails(speaker)}</td>${scoreCell(speaker,1)}${scoreCell(speaker,2)}<td class="score-cell"><span class="average">${averageText(speaker.average)}</span>${!speaker.complete && speaker.scoreCount ? '<span class="sub provisional" title="Provisional average from one round">1 round</span>' : ''}</td><td class="honors">${honors}</td></tr>`;
}
function teamRound(team, round) {
  const r = team.rounds[round];
  if (!r) return `<td><span class="mobile-label">R${round}</span><span class="missing">Not listed</span></td>`;
  const result = r.result || 'Unknown';
  const outcome = r.ballotUrl ? `<a class="outcome${r.result === 'L' ? ' loss' : ''}" href="${esc(r.ballotUrl)}" target="_blank" rel="noopener" aria-label="Round ${round} ballot: ${r.result === 'W' ? 'win' : r.result === 'L' ? 'loss' : 'unknown result'}">${result}</a>` : `<span class="outcome${r.result === 'L' ? ' loss' : ''}" title="Ballot unavailable">${result}</span>`;
  return `<td><span class="mobile-label">R${round}</span>${outcome}<span class="opponent">${r.isBye ? 'BYE' : esc(r.opponent)}</span></td>`;
}
function renderTeam(team) {
  const alias = team.members.length && !team.members.some(name => team.name.includes(name)) ? ` <span class="team-alias">(${esc(team.name)})</span>` : '';
  return `<tr data-name="${esc(team.name)}"><td class="rank">${team.rank ?? '—'}</td><td class="team-school" title="${esc(team.name)}"><span class="team-name">${esc(team.school || team.name)}</span>${alias}</td><td class="members-cell">${team.members.length ? `<span class="team-members">${team.members.map(esc).join(', ')}</span>` : '<span class="sub">Roster unavailable</span>'}</td><td class="record">${team.record}${!team.complete ? '<span class="sub provisional">Incomplete</span>' : ''}</td>${teamRound(team,1)}${teamRound(team,2)}</tr>`;
}
function render() {
  const query = normalize($('search').value);
  const speakers = current.speakers.filter(s => s.searchText.includes(query));
  const teams = current.teams.filter(t => t.searchText.includes(query));
  $('speaker-rows').innerHTML = sortRows(speakers,'speaker').map(renderSpeaker).join('');
  $('team-rows').innerHTML = sortRows(teams,'team').map(renderTeam).join('');
  $('clear').hidden = !query;
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
  const visible = speakerActive ? speakers.length : teams.length;
  const all = speakerActive ? current.speakers.length : current.teams.length;
  $('showing').textContent = `Showing ${visible} of ${all} ${speakerActive ? 'entries' : 'teams'}`;
  $('empty').hidden = visible > 0;
  $('empty').textContent = all === 0 ? 'No Round 1–2 results.' : 'No matches.';
}
function changeDivision() {
  current = divisions.find(d => d.division === $('division').value);
  $('issues').innerHTML = current.issues.filter(i=>i.type!=='roster-labels').map(i=>`<li>${esc(i.text)}</li>`).join('');
  render();
}
$('division').addEventListener('change',changeDivision);
$('search').addEventListener('input',render);
$('clear').addEventListener('click',()=>{$('search').value='';render();$('search').focus();});
for (const kind of ['speaker','team']) {
  $(`${kind}-tab`).addEventListener('click',()=>{activeTab=kind;render();});
  $(`${kind}-tab`).addEventListener('keydown',event=>{
    if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();activeTab=event.key==='Home'?'speaker':event.key==='End'?'team':activeTab==='speaker'?'team':'speaker';render();$(`${activeTab}-tab`).focus();
    }
  });
  document.querySelectorAll(`#${kind}-panel [data-sort]`).forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.sort;sort[kind]={key,direction:sort[kind].key===key?(sort[kind].direction==='asc'?'desc':'asc'):['name','school','members','rank'].includes(key)?'asc':'desc'};render();
  }));
}
changeDivision();
