const snapshot = JSON.parse(document.querySelector('#results-data').textContent);
const divisions = deriveAll(snapshot);
const rounds = snapshot.rounds;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scoreText = value => value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 3 });
const averageText = value => value === null ? '—' : Number(value).toFixed(2);
const defaultDivision = divisions.find(d => d.division === 'NoviceS MS 3-on-3') || divisions[0];
const selectedDivisions = new Set([defaultDivision.division]);
const speakerKey = speaker => encodeURIComponent(`${speaker.division}\u0000${speaker.id}`);
const speakerLookup = new Map(divisions.flatMap(d=>d.speakers.map(s=>[speakerKey(s),s])));
let activeTab = 'speaker';
const sort = { speaker: { key: 'rank', direction: 'asc' }, team: { key: 'rank', direction: 'asc' } };
const stamp = new Intl.DateTimeFormat('en-US', { dateStyle:'medium', timeStyle:'short', timeZone:'America/Los_Angeles' }).format(new Date(snapshot.extractedAt));
$('extracted').textContent = `Extracted ${stamp} Pacific`;
$('extracted').title = snapshot.extractedAt;
$('division-choices').innerHTML = divisions.map(d => `<label><input type="checkbox" value="${esc(d.division)}">${esc(d.division)}</label>`).join('');

function sortRows(rows, kind) {
  const { key, direction } = sort[kind];
  const value = row => {
    if (key.startsWith('round')) {
      const r = row.rounds[Number(key.slice(-1))];
      return kind === 'speaker' ? r?.score : r?.result === 'W' ? 1 : r?.result === 'L' ? 0 : null;
    }
    if (key === 'name' && kind === 'team') return row.displayName;
    if (key === 'members' && kind === 'team') return row.members.join(', ');
    if (key === 'stars') return row.starStatusKnown ? row.awardedStars : null;
    if (key === 'teamStars') return row.teamStarStatusKnown ? row.awardedTeamStars : null;
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
  const missing = entry?.isBye ? 'BYE' : entry?.displayedScore && entry.displayedScore !== '—' ? entry.displayedScore : '';
  return `<td class="score-cell"><span class="score${entry?.score == null ? ' missing' : ''}"${entry?.score == null ? ` title="${esc(missing || 'Score unavailable')}" aria-label="${esc(missing || 'Score unavailable')}"` : ''}>${scoreText(entry?.score)}</span>${entry?.score == null && missing ? `<span class="sub">${esc(missing)}</span>` : ''}</td>`;
}
function speakerDetails(speaker) {
  return `<button class="speaker-open" type="button" data-speaker="${speakerKey(speaker)}" aria-haspopup="dialog" aria-label="Feedback and round details for ${esc(speaker.name)}"><span class="speaker-name"${speaker.sourceRosterLabel ? ' title="Source roster label"' : ''}>${esc(speaker.name)}</span><span class="sub">${esc(speaker.school || speaker.team)}</span></button>`;
}
function openSpeakerFeedback(speaker) {
  $('feedback-title').textContent = speaker.name;
  $('feedback-team').textContent = `${speaker.team} · ${speaker.division}`;
  $('feedback-rounds').innerHTML = rounds.map(round => {
    const r = speaker.rounds[round];
    const score = r?.score == null ? r?.isBye ? 'BYE' : 'No score' : `${scoreText(r.score)} points`;
    const text = r?.feedback ? `<blockquote class="feedback-text">${esc(r.feedback)}</blockquote>` : `<p class="feedback-missing">${!r ? 'No ballot entry available.' : r.isBye ? 'BYE — no speaker feedback.' : 'No speaker feedback posted.'}</p>`;
    const honors = [r?.teamHighest ? '<span class="stars team-stars" title="Highest score on own team, including ties">★ Team</span>' : '', r?.roomHighest ? '<span class="stars room-stars" title="Highest score across both teams, including ties">★ Room</span>' : ''].filter(Boolean).join(' · ');
    return `<section class="feedback-round" data-round="${round}"><div class="feedback-round-heading"><h3>Round ${round} <span>${score}</span></h3>${r?.ballotUrl ? `<a href="${esc(r.ballotUrl)}" target="_blank" rel="noopener">Ballot</a>` : ''}</div>${honors ? `<p class="feedback-honors">${honors}</p>` : ''}${r ? `<p class="feedback-opponent">vs. ${esc(r.opponent)}</p>` : ''}${r?.feedback && r.judgeName ? `<p class="feedback-judge">${esc(r.judgeName)}</p>` : ''}${text}</section>`;
  }).join('') + (speaker.completeRank ? `<p class="feedback-rank">${rounds.length}-score rank: ${speaker.completeRank}</p>` : '');
  $('speaker-dialog').showModal();
}
$('speaker-rows').addEventListener('click', event => {
  const button = event.target.closest('[data-speaker]');
  if (button) openSpeakerFeedback(speakerLookup.get(button.dataset.speaker));
});
$('feedback-close').addEventListener('click', () => $('speaker-dialog').close());
$('speaker-dialog').addEventListener('click', event => {
  const box = $('speaker-dialog').getBoundingClientRect();
  if (event.target === $('speaker-dialog') && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) $('speaker-dialog').close();
});
function renderHonors(speaker, scope) {
  const team = scope === 'team';
  const count = team ? speaker.awardedTeamStars : speaker.awardedStars;
  const known = team ? speaker.teamStarStatusKnown : speaker.starStatusKnown;
  const label = team ? 'Team' : 'Room';
  const title = `${label}-highest in ${count} ${count === 1 ? 'round' : 'rounds'} (ties count)`;
  const content = count ? `<span class="stars ${scope}-stars" title="${title}" aria-label="${title}">${'★'.repeat(count)}</span>` : known ? `<span class="missing" aria-label="No ${scope}-highest rounds">—</span>` : `<span class="missing" title="${label} honors unverified: missing scores" aria-label="${label} honors unverified">?</span>`;
  return `<td class="honors ${scope}-honors">${content}</td>`;
}
function renderSpeaker(speaker) {
  return `<tr data-name="${esc(speaker.name)}"><td class="rank">${speaker.rank ?? '—'}</td><td class="person">${speakerDetails(speaker)}</td>${rounds.map(round=>scoreCell(speaker,round)).join('')}<td class="score-cell"><span class="average">${averageText(speaker.average)}</span>${!speaker.complete && speaker.scoreCount ? `<span class="sub provisional" title="Provisional average from ${speaker.scoreCount} of ${rounds.length} rounds">${speaker.scoreCount}/${rounds.length}</span>` : ''}</td>${renderHonors(speaker,'team')}${renderHonors(speaker,'room')}</tr>`;
}
function teamRound(team, round) {
  const r = team.rounds[round];
  if (!r) return `<td class="round-result"><span class="mobile-label">R${round}</span><span class="missing">Not listed</span></td>`;
  const result = r.result || 'Unknown';
  const outcome = r.ballotUrl ? `<a class="outcome${r.result === 'L' ? ' loss' : ''}" href="${esc(r.ballotUrl)}" target="_blank" rel="noopener" aria-label="Round ${round} ballot: ${r.result === 'W' ? 'win' : r.result === 'L' ? 'loss' : 'unknown result'}">${result}</a>` : `<span class="outcome${r.result === 'L' ? ' loss' : ''}" title="Ballot unavailable">${result}</span>`;
  return `<td class="round-result"><span class="mobile-label">R${round}</span>${outcome}<span class="opponent">${r.isBye ? 'BYE' : esc(r.opponent)}</span></td>`;
}
function renderTeam(team) {
  const alias = team.members.length && !team.members.some(name => team.name.includes(name)) ? ` <span class="team-alias">(${esc(team.name)})</span>` : '';
  return `<tr data-name="${esc(team.name)}"><td class="rank">${team.rank ?? '—'}</td><td class="team-school" title="${esc(team.name)}"><span class="team-name">${esc(team.school || team.name)}</span>${alias}</td><td class="members-cell">${team.members.length ? `<span class="team-members">${team.members.map(esc).join(', ')}</span>` : '<span class="sub">Roster unavailable</span>'}</td><td class="record">${team.record}${!team.complete ? `<span class="sub provisional" title="Incomplete record">${Object.values(team.rounds).filter(r=>r.result).length}/${rounds.length}</span>` : ''}</td>${rounds.map(round=>teamRound(team,round)).join('')}</tr>`;
}
function render() {
  const query = normalize($('search').value);
  const selected = divisions.filter(d => selectedDivisions.has(d.division));
  const groups = selected.map(d => ({ division: d.division, speakers: d.speakers.filter(s => s.searchText.includes(query)), teams: d.teams.filter(t => t.searchText.includes(query)) }));
  const groupHeading = (division, columns) => selected.length > 1 ? `<tr class="division-heading"><td colspan="${columns}">${esc(division)}</td></tr>` : '';
  $('speaker-rows').innerHTML = groups.filter(d => d.speakers.length).map(d => groupHeading(d.division,rounds.length+5) + sortRows(d.speakers,'speaker').map(renderSpeaker).join('')).join('');
  $('team-rows').innerHTML = groups.filter(d => d.teams.length).map(d => groupHeading(d.division,rounds.length+4) + sortRows(d.teams,'team').map(renderTeam).join('')).join('');
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
  const visible = groups.reduce((sum,d) => sum + (speakerActive ? d.speakers.length : d.teams.length),0);
  const all = selected.reduce((sum,d) => sum + (speakerActive ? d.speakers.length : d.teams.length),0);
  $('showing').textContent = `Showing ${visible} of ${all} ${speakerActive ? 'entries' : 'teams'}`;
  $('empty').hidden = visible > 0;
  $('empty').textContent = selected.length === 0 ? 'Select a division.' : all === 0 ? 'No results for these rounds.' : 'No matches.';
}
function changeDivision() {
  const selected = divisions.filter(d => selectedDivisions.has(d.division));
  const label = selected.length === divisions.length ? 'All divisions' : selected.length === 1 ? selected[0].division : selected.length ? selected.map(d=>d.division.replace(/ MS 3-on-3$/, '')).join(', ') : 'Select divisions';
  $('division-label').textContent = label;
  $('division').setAttribute('aria-label', `Divisions: ${label}`);
  $('division').title = selected.map(d=>d.division).join(', ');
  $('division-all').checked = selected.length === divisions.length;
  $('division-all').indeterminate = selected.length > 0 && selected.length < divisions.length;
  document.querySelectorAll('#division-choices input').forEach(input => { input.checked = selectedDivisions.has(input.value); });
  $('issues').innerHTML = selected.flatMap(d=>d.issues.filter(i=>i.type!=='roster-labels').map(i=>`<li>${selected.length > 1 ? `${esc(d.division)}: ` : ''}${esc(i.text)}</li>`)).join('');
  render();
}
function setPickerOpen(open, restoreFocus = false) {
  $('division-options').hidden = !open;
  $('division').setAttribute('aria-expanded', String(open));
  if (restoreFocus) $('division').focus();
}
$('division').addEventListener('click', () => setPickerOpen($('division-options').hidden));
$('division').addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') { event.preventDefault(); setPickerOpen(true); $('division-all').focus(); }
});
$('division-all').addEventListener('change', event => {
  selectedDivisions.clear();
  if (event.target.checked) divisions.forEach(d => selectedDivisions.add(d.division));
  changeDivision();
});
$('division-choices').addEventListener('change', event => {
  if (event.target.checked) selectedDivisions.add(event.target.value);
  else selectedDivisions.delete(event.target.value);
  changeDivision();
});
$('division-picker').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); setPickerOpen(false, true); }
});
$('division-picker').addEventListener('focusout', event => {
  if (event.relatedTarget && !$('division-picker').contains(event.relatedTarget)) setPickerOpen(false);
});
document.addEventListener('click', event => {
  if (!$('division-picker').contains(event.target)) setPickerOpen(false);
});
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
