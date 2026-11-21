import test from 'node:test';
import assert from 'node:assert/strict';
import { attachSpeakerFeedback } from '../scripts/feedback.mjs';

const ballot = () => ({ sides: { aff: { speakers: [{name:'Alex'},{name:'ABC'}] }, neg: { speakers: [{name:'Alex'},{name:'ABC'}] } } });
const note = (side,position,name,text) => ({side,speakerPosition:position,speakerName:name,sourceHeading:`${side==='aff'?'Proposition':'Opposition'} Speaker ${position} — ${name}`,text});
test('same-name speakers receive only their own side and position feedback',()=>{
  const b=ballot();
  attachSpeakerFeedback(b,{sectionPresent:true,judgeName:'Judge',entries:[note('aff',1,'Alex','Aff note'),note('neg',1,'Alex','Opp note'),note('neg',2,'ABC','Roster-label note')]});
  assert.equal(b.sides.aff.speakers[0].feedback.text,'Aff note');
  assert.equal(b.sides.neg.speakers[0].feedback.text,'Opp note');
  assert.equal(b.sides.aff.speakers[1].feedback,null);
  assert.equal(b.sides.neg.speakers[1].feedback.text,'Roster-label note');
});
test('feedback cannot silently attach to the wrong speaker or overwrite another note',()=>{
  assert.throws(()=>attachSpeakerFeedback(ballot(),{entries:[note('aff',2,'Alex','Wrong position')]}),/mismatch/);
  const n=note('aff',1,'Alex','Note');
  assert.throws(()=>attachSpeakerFeedback(ballot(),{entries:[n,n]}),/Duplicate feedback/);
});
test('missing feedback stays absent; original line breaks and literal text are retained',()=>{
  const b=ballot();
  attachSpeakerFeedback(b,{sectionPresent:false,judgeName:null,entries:[]});
  assert.ok(Object.values(b.sides).every(s=>s.speakers.every(p=>p.feedback===null)));
  const text='A "quoted" point.\n\nKeep <examples> & line breaks.';
  attachSpeakerFeedback(b,{sectionPresent:true,judgeName:'Judge',entries:[note('aff',1,'Alex',text)]});
  assert.equal(b.sides.aff.speakers[0].feedback.text,text);
});
