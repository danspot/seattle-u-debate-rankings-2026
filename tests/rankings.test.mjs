import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDivision, mergeDivisions } from '../scripts/rankings.mjs';
const division='Fixture division';
function debate(id,round,aff,neg,points,winnerSide='aff') {
  const team=(name,scores)=>({teamName:name,school:name,speakers:scores.map((score,i)=>({name:`${name} ${i+1}`,score,displayedScore:score===null?'B':String(score)})),total:null});
  return {id,round,division,room:`Room ${id}`,aff:{name:aff},neg:{name:neg},isBye:neg==='BYE',winnerSide,ballotStatus:points.flat().some(x=>x!==null)?'scored':'no-scores',ballot:{winnerSide,url:'https://plustab.org/fixture',sides:{aff:team(aff,points[0]),neg:team(neg,points[1])}}};
}
const rank=(debates,rounds=[1,2])=>deriveDivision({divisions:[division],rounds,debates},division);
test('tied room highs credit every tied speaker; average ties share competition ranks',()=>{
  const d=rank([debate('1',1,'A','B',[[90,90,80],[90,80,70]]),debate('2',2,'A','B',[[80,90,80],[90,70,70]],'neg')]);
  const person=name=>d.speakers.find(s=>s.name===name);
  assert.equal(person('A 1').awardedStars,1);
  assert.equal(person('A 2').awardedStars,2);
  assert.equal(person('B 1').awardedStars,2);
  assert.equal(person('A 2').rank,1);assert.equal(person('B 1').rank,1);assert.equal(person('A 1').rank,3);
  assert.deepEqual(d.teams.map(t=>t.record),['1–1','1–1']);assert.deepEqual(d.teams.map(t=>t.rank),[1,1]);
});
test('missing scores produce provisional means, never fabricated zeros or room highs',()=>{
  const d=rank([debate('1',1,'A','B',[[90,null,80],[85,80,70]]),debate('2',2,'A','B',[[80,88,80],[90,70,70]])]);
  const a=d.speakers.find(s=>s.name==='A 2');
  assert.equal(a.average,88);assert.equal(a.scoreCount,1);assert.equal(a.complete,false);assert.equal(a.rank,1);
  const b=d.speakers.find(s=>s.name==='B 1');
  assert.equal(b.stars,1);assert.equal(b.awardedStars,0);assert.equal(b.starStatusKnown,false);
  assert.equal(b.awardedTeamStars,2);assert.equal(b.teamStarStatusKnown,true);
  assert.equal(a.teamStars,1);assert.equal(a.awardedTeamStars,0);assert.equal(a.teamStarStatusKnown,false);
});
test('team highs and room highs count independently, including tied teammates',()=>{
  const d=rank([debate('1',1,'A','B',[[88,88,80],[92,90,70]]),debate('2',2,'A','B',[[89,87,86],[91,91,80]])]);
  const honors=name=>{const s=d.speakers.find(s=>s.name===name);return [s.awardedTeamStars,s.awardedStars];};
  assert.deepEqual(honors('A 1'),[2,0]);
  assert.deepEqual(honors('A 2'),[1,0]);
  assert.deepEqual(honors('B 1'),[2,2]);
  assert.deepEqual(honors('B 2'),[1,1]);
});
test('BYEs earn neither star type while a scored round still earns its highs',()=>{
  const d=rank([debate('1',1,'A','BYE',[[null,null,null],[null,null,null]]),debate('2',2,'A','B',[[90,80,70],[85,80,75]])]);
  const s=d.speakers.find(s=>s.name==='A 1');
  assert.equal(s.awardedTeamStars,1);assert.equal(s.awardedStars,1);
  assert.equal(s.rounds[1].teamHighest,null);assert.equal(s.rounds[1].roomHighest,null);
});
test('BYEs require explicit matching decisions, and B is not a speaker score',()=>{
  const confirmed=debate('1',1,'A','BYE',[[null,null,null],[null,null,null]]);
  let d=rank([confirmed]);assert.equal(d.teams.length,1);assert.equal(d.teams[0].wins,1);
  assert.equal(d.speakers.length,3);assert.equal(d.speakers[0].average,null);
  confirmed.ballot.winnerSide=null;d=rank([confirmed]);assert.equal(d.teams[0].wins,0);assert.equal(d.teams[0].rounds[1].result,null);
  assert.ok(d.issues.some(i=>i.type==='ambiguous-bye'));
});
test('speaker identity is scoped to team; repeated team appearances fail',()=>{
  const a=debate('1',1,'A','B',[[80,80,80],[80,80,80]]);
  a.ballot.sides.aff.speakers[0].name='Alex';a.ballot.sides.neg.speakers[0].name='Alex';
  assert.equal(rank([a]).speakers.filter(s=>s.name==='Alex').length,2);
  assert.throws(()=>rank([a,{...a,id:'other'}]),/Duplicate team/);
});
test('unknown decisions remain incomplete despite numeric scores',()=>{
  const d=rank([debate('1',1,'A','B',[[80,80,80],[70,70,70]],null)]);
  assert.ok(d.teams.every(t=>t.wins===0&&t.losses===0&&t.rank===null&&!t.complete));
});
test('Round 3 updates averages, records, ranks, and both star sets',()=>{
  const d=rank([debate('1',1,'A','B',[[90,80,70],[85,80,75]]),debate('2',2,'A','B',[[91,80,70],[85,80,75]]),debate('3',3,'A','B',[[92,80,70],[85,80,75]],'neg')],[1,2,3]);
  const a=d.speakers.find(s=>s.name==='A 1'),b=d.speakers.find(s=>s.name==='B 1');
  assert.equal(a.average,91);assert.equal(a.scoreCount,3);assert.equal(a.complete,true);assert.equal(a.rank,1);
  assert.equal(a.awardedStars,3);assert.equal(a.awardedTeamStars,3);
  assert.equal(b.awardedStars,0);assert.equal(b.awardedTeamStars,3);
  assert.deepEqual(d.teams.map(t=>t.record),['2–1','1–2']);
  assert.deepEqual(d.teams.map(t=>t.rank),[1,2]);
  assert.ok(d.teams.every(t=>t.complete));
});
test('pending Round 3 keeps previous scores and records provisional without inventing a decision',()=>{
  const pending=debate('3',3,'A','B',[[null,null,null],[null,null,null]],null);
  pending.ballot=null;pending.ballotStatus='unavailable';
  const d=rank([debate('1',1,'A','B',[[90,80,70],[85,80,75]]),debate('2',2,'A','B',[[91,80,70],[85,80,75]]),pending],[1,2,3]);
  const a=d.speakers.find(s=>s.name==='A 1');
  assert.equal(a.average,90.5);assert.equal(a.scoreCount,2);assert.equal(a.complete,false);assert.equal(a.completeRank,null);
  assert.equal(a.stars,2);assert.equal(a.starStatusKnown,false);assert.equal(a.teamStarStatusKnown,false);
  assert.ok(d.teams.every(t=>!t.complete && t.rank===null && t.rounds[3].result===null));
  assert.equal(d.teams.find(t=>t.name==='A').record,'2–0');
});
test('selected divisions merge with shared ranks and ties without changing division rankings',()=>{
  const first=rank([debate('1',1,'A','B',[[90,85,80],[80,75,70]]),debate('2',2,'A','B',[[90,85,80],[80,75,70]])]);
  const second=rank([debate('3',1,'C','D',[[95,85,75],[80,70,65]]),debate('4',2,'C','D',[[95,85,75],[80,70,65]])]);
  second.division='Other division';
  const selected=[first,second],before=structuredClone(selected);
  const merged=mergeDivisions(selected),speaker=name=>merged.speakers.find(s=>s.name===name);
  assert.equal(merged.speakers.length,12);assert.equal(merged.teams.length,4);
  assert.equal(speaker('C 1').rank,1);assert.equal(speaker('A 1').rank,2);
  assert.equal(speaker('A 2').rank,3);assert.equal(speaker('C 2').rank,3);assert.equal(speaker('A 3').rank,5);
  assert.equal(speaker('A 1').divisionRank,1);assert.equal(speaker('C 1').division,second.division);
  assert.ok(merged.teams.filter(t=>t.wins===2).every(t=>t.rank===1 && t.recordGroupSize===2));
  assert.ok(merged.teams.filter(t=>t.wins===0).every(t=>t.rank===3));
  assert.deepEqual(selected,before);
  assert.deepEqual(mergeDivisions([]),{speakers:[],teams:[]});
});
