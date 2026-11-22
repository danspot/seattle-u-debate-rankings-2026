import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareSnapshots, contentHash, notificationKey } from '../scripts/watch-checks.mjs';
const snapshot=JSON.parse(await readFile(new URL('../data/results.json',import.meta.url),'utf8'));
const clone=()=>structuredClone(snapshot);
test('extraction timestamps do not cause publications',()=>{
  const next=clone();next.extractedAt='2099-01-01T00:00:00Z';next.extractionStartedAt=next.extractedAt;next.sourceUpdatedLabel='new label';
  assert.equal(contentHash(snapshot),contentHash(next));assert.equal(compareSnapshots(snapshot,next).changed,false);
});
test('newly posted ballots are updates, not corrections or anomalies',()=>{
  const old=clone(),d=old.debates.find(d=>d.round===3&&d.ballotStatus==='scored');
  d.ballot=null;d.ballotStatus='unavailable';d.winnerSide=null;
  const diff=compareSnapshots(old,snapshot);
  assert.equal(diff.changed,true);assert.equal(diff.newBallots,1);assert.equal(diff.newDecisions,1);assert.equal(diff.blocked,false);assert.deepEqual(diff.alerts,[]);
});
test('withdrawn scores and changed pairings are held instead of erasing published data',()=>{
  const next=clone(),d=next.debates.find(d=>d.ballotStatus==='scored');d.ballot.sides.aff.speakers[0].score=null;
  assert.equal(compareSnapshots(snapshot,next).blocked,true);
  const missing=clone();missing.debates.shift();assert.equal(compareSnapshots(snapshot,missing).blocked,true);
});
test('corrections and statistical outliers require a fresh ballot audit and notification',()=>{
  const next=clone(),d=next.debates.find(d=>d.ballotStatus==='scored');
  d.ballot.sides.aff.speakers[0].score=900;d.winnerSide=d.winnerSide==='aff'?'neg':'aff';
  const diff=compareSnapshots(snapshot,next);
  assert.equal(diff.blocked,false);
  assert.ok(diff.alerts.some(a=>a.kind==='changed-score'));assert.ok(diff.alerts.some(a=>a.kind==='unusual-score'));assert.ok(diff.alerts.some(a=>a.kind==='changed-decision'));
  assert.deepEqual(diff.auditIds,[d.id]);
});
test('new feedback triggers publication without declaring a score anomaly',()=>{
  const next=clone(),d=next.debates.find(d=>d.ballot?.sides.aff.speakers[0].feedback);
  d.ballot.sides.aff.speakers[0].feedback.text+=' Additional feedback.';
  const diff=compareSnapshots(snapshot,next);assert.equal(diff.changed,true);assert.deepEqual(diff.alerts,[]);
});
test('repeated operational failures share one alert even across numbered checks',()=>{
  assert.equal(notificationKey({key:'timeout:source-audit',text:'Check 9 failed'}),notificationKey({key:'timeout:source-audit',text:'Check 10 failed'}));
  assert.notEqual(notificationKey({text:'Score changed for A'}),notificationKey({text:'Score changed for B'}));
});
test('archive content changes trigger updates while capture timestamps do not',()=>{
  const before=clone();before.archive={pages:[{id:'schedule',text:'Round 1',capturedAt:'2026-11-21T00:00:00Z'}]};
  const after=structuredClone(before);after.archive.pages[0].capturedAt='2026-11-22T00:00:00Z';
  assert.equal(contentHash(before),contentHash(after));
  after.archive.pages[0].text='Round 1 revised';
  assert.notEqual(contentHash(before),contentHash(after));
});
