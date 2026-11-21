import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { deriveAll, normalize } from './rankings.mjs';

export function verifySnapshot(snapshot) {
  assert.deepEqual(snapshot.rounds, [1,2]);
  assert.equal(snapshot.source, 'https://plustab.org/t/seattle-u-sat-nov-21-2026/results');
  assert.ok(Number.isFinite(Date.parse(snapshot.extractedAt)));
  assert.equal(new Set(snapshot.divisions).size, snapshot.divisions.length);
  const ids = new Set(), rooms = new Set(), appearances = new Set(), rosters = new Map();
  let numericScores = 0, feedbackNotes = 0;
  for (const d of snapshot.debates) {
    assert.ok([1,2].includes(d.round), `Unexpected round ${d.round}`);
    assert.ok(snapshot.divisions.includes(d.division));
    assert.ok(!ids.has(d.id), `Duplicate ballot ID ${d.id}`); ids.add(d.id);
    const room = `${d.division}|${d.round}|${d.room}`;
    assert.ok(!rooms.has(room), `Duplicate room ${room}`); rooms.add(room);
    assert.notEqual(d.aff.name, d.neg.name);
    const underlined = ['aff','neg'].filter(side => d[side].style.textDecorationLine.includes('underline'));
    if (d.winnerEvidence === 'computed underline') {
      assert.equal(underlined.length, 1); assert.equal(d.winnerSide,underlined[0]);
      assert.ok(Number(d[d.winnerSide].style.fontWeight) > Number(d[d.winnerSide === 'aff' ? 'neg' : 'aff'].style.fontWeight));
    }
    if (d.ballot) {
      assert.equal(d.ballot.roundLabel, `Round ${d.round}`);
      assert.equal(d.ballot.room,d.room); assert.equal(d.ballot.division,d.division);
      assert.equal(d.ballot.url, `${snapshot.source}/ballot/${d.id}`);
      assert.equal(d.winnerSide,d.ballot.winnerSide, `Decision mismatch for ${d.id}`);
      if (snapshot.schemaVersion >= 2) {
        assert.equal(typeof d.ballot.feedbackSectionPresent,'boolean');
        const notes = Object.values(d.ballot.sides).flatMap(t=>t.speakers).filter(s=>s.feedback);
        assert.equal(d.ballot.feedbackNoteCount,notes.length,`Feedback count mismatch ${d.id}`);
        if (notes.length) assert.equal(d.ballot.feedbackSectionPresent,true);
      }
    }
    for (const side of ['aff','neg']) {
      const t = d.ballot?.sides[side];
      if (d[side].name !== 'BYE') {
        const key=`${d.division}|${normalize(d[side].name)}`;
        assert.ok(!appearances.has(`${key}|${d.round}`), `Duplicate team appearance ${key}`);
        appearances.add(`${key}|${d.round}`);
        if (t) {
          assert.equal(t.teamName,d[side].name);
          const roster=t.speakers.map(p=>normalize(p.name)).sort();
          assert.equal(new Set(roster).size,roster.length,`Duplicate speaker in ${d.id}`);
          if(rosters.has(key))assert.deepEqual(rosters.get(key),roster,`Roster changed between rounds: ${key}`);
          rosters.set(key,roster);
        }
      }
      if (t) {
        for(const [position,s] of t.speakers.entries()) {
          assert.ok(s.name.trim());
          if (snapshot.schemaVersion >= 2) {
            assert.ok(Object.hasOwn(s,'feedback'));
            if (s.feedback !== null) {
              const note=s.feedback;
              assert.equal(note.side,side);
              assert.equal(note.speakerPosition,position+1);
              assert.equal(normalize(note.speakerName),normalize(s.name));
              assert.equal(note.sourceHeading,`${side==='aff'?'Proposition':'Opposition'} Speaker ${position+1} — ${note.speakerName}`);
              assert.equal(typeof note.text,'string'); assert.ok(note.text.trim());
              feedbackNotes++;
            }
          }
          if(s.score !== null) {
            assert.ok(Number.isFinite(s.score));
            assert.match(s.displayedScore,/^\d+(?:\.\d+)?$/);
            assert.equal(s.score,Number(s.displayedScore)); numericScores++;
          } else assert.ok(!/^\d+(?:\.\d+)?$/.test(s.displayedScore));
        }
        if(t.total !== null && t.speakers.every(p=>p.score !== null))assert.equal(t.total,t.speakers.reduce((n,p)=>n+p.score,0),`Score total mismatch ${d.id} ${side}`);
      }
    }
  }
  const divisions=deriveAll(snapshot);
  for(const div of divisions) {
    for(const s of div.speakers) {
      if(s.average !== null)assert.equal(s.rank,1+div.speakers.filter(x=>x.average !== null && x.average>s.average).length);
      for(const round of Object.values(s.rounds)) {
        const debate=snapshot.debates.find(d=>d.id===round.debateId);
        assert.equal(round.room,debate.room);assert.equal(round.division,debate.division);
        assert.ok([debate.aff.name,debate.neg.name].includes(s.team));
        const sourceSide=['aff','neg'].find(side=>debate[side].name===s.team);
        const sourcePerson=debate.ballot.sides[sourceSide].speakers.find(p=>normalize(p.name)===normalize(s.name));
        assert.equal(round.feedback,sourcePerson.feedback?.text || null,`Feedback aggregation mismatch for ${s.name}`);
      }
      assert.ok(s.awardedStars<=2);
    }
    const paired=snapshot.debates.filter(d=>d.division===div.division&&!d.isBye&&d.winnerSide);
    for(const d of paired) {
      const results=div.teams.filter(t=>t.rounds[d.round]?.debateId===d.id).map(t=>t.rounds[d.round].result).sort();
      assert.deepEqual(results,['L','W']);
    }
  }
  const novice=divisions.find(d=>d.division==='NoviceS MS 3-on-3');
  const person=novice?.speakers.find(s=>s.name==='Jia-Hao Stevenson' && s.school==='Bellevue Youth Debate');
  const team=novice?.teams.find(t=>t.id===person?.teamId);
  return { verifiedAt:new Date().toISOString(), extractedAt:snapshot.extractedAt, checksPassed:true, debateCount:ids.size, numericScores, feedbackNotes, speakersWithFeedback:divisions.reduce((n,d)=>n+d.speakers.filter(s=>Object.values(s.rounds).some(r=>r.feedback)).length,0), divisions:divisions.map(d=>({division:d.division,...d.counts,issues:d.issues})), testCase:person?{name:person.name,rounds:person.rounds,average:person.average,rank:person.rank,rankAmongComplete:person.completeRank,stars:person.awardedStars,teamRecord:team.record,teamStanding:team.rank,teamsSharingRecord:team.recordGroupSize}:null };
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const report=verifySnapshot(JSON.parse(await readFile('data/results.json','utf8')));
  console.log(JSON.stringify(report,null,2));
}
