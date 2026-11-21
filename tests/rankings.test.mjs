import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDivision } from '../scripts/rankings.mjs';
const division='Fixture division';
function debate(id,round,aff,neg,points,winnerSide='aff') {
  const team=(name,scores)=>({teamName:name,school:name,speakers:scores.map((score,i)=>({name:`${name} ${i+1}`,score,displayedScore:score===null?'B':String(score)})),total:null});
  return {id,round,division,room:`Room ${id}`,aff:{name:aff},neg:{name:neg},isBye:neg==='BYE',winnerSide,ballotStatus:points.flat().some(x=>x!==null)?'scored':'no-scores',ballot:{winnerSide,url:'https://plustab.org/fixture',sides:{aff:team(aff,points[0]),neg:team(neg,points[1])}}};
}
const rank=debates=>deriveDivision({divisions:[division],debates},division);
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
