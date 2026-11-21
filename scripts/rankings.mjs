export const normalize = value => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
const alphabetic = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });
export const isRosterLabel = name => /^(abc|aa|speaker\s*\d+)$/i.test(name.trim());

export function deriveDivision(snapshot, division) {
  const debates = snapshot.debates.filter(d => d.division === division);
  const teamMap = new Map();
  const speakerMap = new Map();
  const issues = [];
  const getTeam = name => {
    const key = normalize(name);
    if (!teamMap.has(key)) teamMap.set(key, { id: key, name, school: '', members: [], rounds: {}, wins: 0, losses: 0, byes: 0 });
    return teamMap.get(key);
  };
  for (const debate of debates) {
    const allScores = ['aff', 'neg'].flatMap(side => debate[side].name === 'BYE' ? [] : debate.ballot?.sides[side]?.speakers || []);
    const roomComplete = !debate.isBye && ['aff', 'neg'].every(side => (debate.ballot?.sides[side]?.speakers.length || 0) > 0) && allScores.every(p => p.score !== null);
    const high = roomComplete ? Math.max(...allScores.map(p => p.score)) : null;
    if (debate.ballotStatus === 'unavailable') issues.push({ type: 'missing-ballot', round: debate.round, room: debate.room, text: `Round ${debate.round}, ${debate.room}: ballot unavailable.` });
    if (!debate.isBye && debate.ballotStatus === 'no-scores') issues.push({ type: 'unscored-ballot', round: debate.round, room: debate.room, text: `Round ${debate.round}, ${debate.room}: ${debate.aff.name} vs. ${debate.neg.name}; ballot contains no numeric speaker scores.` });
    if (!debate.isBye && debate.ballotStatus === 'scored' && !roomComplete) issues.push({ type: 'partial-ballot', round: debate.round, room: debate.room, text: `Round ${debate.round}, ${debate.room}: some speaker scores are missing; room-highest honors are unverified.` });
    if (!debate.winnerSide) issues.push({ type: 'missing-result', round: debate.round, room: debate.room, text: `Round ${debate.round}, ${debate.room}: winner not established by source styling.` });
    for (const side of ['aff', 'neg']) {
      if (debate[side].name === 'BYE') continue;
      const team = getTeam(debate[side].name);
      const opponent = debate[side === 'aff' ? 'neg' : 'aff'].name;
      const ballotTeam = debate.ballot?.sides[side];
      if (team.rounds[debate.round]) throw new Error(`Duplicate team in round: ${division} / ${team.name} / ${debate.round}`);
      // A BYE counts only with the same explicit winner in both result styling and ballot.
      const verifiedBye = debate.isBye && debate.winnerSide === side && debate.ballot?.winnerSide === side;
      const result = debate.isBye ? (verifiedBye ? 'W' : null) : debate.winnerSide ? (debate.winnerSide === side ? 'W' : 'L') : null;
      if (debate.isBye && !verifiedBye) issues.push({ type: 'ambiguous-bye', round: debate.round, room: debate.room, text: `${team.name}: Round ${debate.round} BYE has no confirmed decision.` });
      team.rounds[debate.round] = { result, opponent, room: debate.room, isBye: debate.isBye, debateId: debate.id, ballotUrl: debate.ballot?.url || null };
      if (result === 'W') team.wins++;
      if (result === 'L') team.losses++;
      if (debate.isBye) team.byes++;
      if (ballotTeam) {
        team.school ||= ballotTeam.school;
        for (const person of ballotTeam.speakers) {
          if (!team.members.some(n => normalize(n) === normalize(person.name))) team.members.push(person.name);
          const key = `${team.id}\u0000${normalize(person.name)}`;
          if (!speakerMap.has(key)) speakerMap.set(key, { id: key, name: person.name, teamId: team.id, team: team.name, school: ballotTeam.school, sourceRosterLabel: isRosterLabel(person.name), rounds: {} });
          const speaker = speakerMap.get(key);
          if (speaker.rounds[debate.round]) throw new Error(`Duplicate speaker in round: ${key}`);
          speaker.rounds[debate.round] = { score: person.score, displayedScore: person.displayedScore, room: debate.room, opponent, team: team.name, division, round: debate.round, debateId: debate.id, isBye: debate.isBye, roomHighest: high === null ? null : person.score === high, roomMaximum: high, ballotUrl: debate.ballot.url };
        }
      }
    }
  }
  const teams = [...teamMap.values()];
  for (const team of teams) {
    team.complete = [1, 2].every(r => team.rounds[r]?.result);
    team.record = `${team.wins}–${team.losses}`;
    team.displayName = team.school && team.members.length ? `${team.school} — ${team.members.join(', ')}` : team.name;
    team.searchText = normalize([team.name, team.school, ...team.members].join(' '));
    for (const round of [1, 2]) if (!team.rounds[round]) issues.push({ type: 'missing-pairing', round, team: team.name, text: `${team.name}: not listed in Round ${round}.` });
  }
  teams.sort((a, b) => Number(b.complete) - Number(a.complete) || b.wins - a.wins || a.losses - b.losses || alphabetic(a.displayName, b.displayName));
  let lastRecord, lastRank;
  teams.forEach((t, i) => {
    if (!t.complete) { t.rank = null; return; }
    if (t.record !== lastRecord) { lastRecord = t.record; lastRank = i + 1; }
    t.rank = lastRank;
    t.recordGroupSize = teams.filter(x => x.complete && x.record === t.record).length;
  });
  const speakers = [...speakerMap.values()];
  for (const speaker of speakers) {
    const rounds = Object.values(speaker.rounds);
    const scores = rounds.filter(r => r.score !== null);
    speaker.scoreCount = scores.length;
    speaker.average = scores.length ? scores.reduce((sum, r) => sum + r.score, 0) / scores.length : null;
    speaker.complete = scores.length === 2;
    speaker.stars = rounds.filter(r => r.roomHighest === true).length;
    speaker.starStatusKnown = [1, 2].every(r => speaker.rounds[r]?.roomHighest !== null && speaker.rounds[r]?.roomHighest !== undefined || speaker.rounds[r]?.isBye);
    speaker.awardedStars = speaker.starStatusKnown ? speaker.stars : 0;
    speaker.searchText = normalize(`${speaker.name} ${speaker.team} ${speaker.school} ${teamMap.get(speaker.teamId).members.join(' ')}`);
  }
  speakers.sort((a, b) => (b.average ?? -Infinity) - (a.average ?? -Infinity) || alphabetic(a.name, b.name) || alphabetic(a.team, b.team));
  let previousAverage, rank, completeIndex = 0, previousCompleteAverage, completeRank;
  speakers.forEach((speaker, i) => {
    if (speaker.average === null) { speaker.rank = null; speaker.completeRank = null; return; }
    if (speaker.average !== previousAverage) { previousAverage = speaker.average; rank = i + 1; }
    speaker.rank = rank;
    if (speaker.complete) {
      completeIndex++;
      if (speaker.average !== previousCompleteAverage) { previousCompleteAverage = speaker.average; completeRank = completeIndex; }
      speaker.completeRank = completeRank;
    } else speaker.completeRank = null;
  });
  const rosterLabels = speakers.filter(p => p.sourceRosterLabel);
  if (rosterLabels.length) issues.push({ type: 'roster-labels', text: `${rosterLabels.length} speaker entries use source roster labels such as ABC or aa; identities are not inferred.` });
  return { division, teams, speakers, issues, counts: {
    teams: teams.length, speakers: speakers.length, namedSpeakers: speakers.length - rosterLabels.length,
    rosterLabels: rosterLabels.length, scoredSpeakers: speakers.filter(p => p.scoreCount > 0).length,
    completeSpeakers: speakers.filter(p => p.complete).length, debates: debates.length,
    scoredBallots: debates.filter(d => d.ballotStatus === 'scored').length,
    unavailableBallots: debates.filter(d => d.ballotStatus === 'unavailable').length,
    byes: debates.filter(d => d.isBye).length, completeTeams: teams.filter(t => t.complete).length
  } };
}

export function deriveAll(snapshot) { return snapshot.divisions.map(division => deriveDivision(snapshot, division)); }
