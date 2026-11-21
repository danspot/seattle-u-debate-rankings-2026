import { createHash } from 'node:crypto';

const pairingKey = d => JSON.stringify([d.division,d.round,d.aff.name,d.neg.name]);
const label = d => `${d.division}, Round ${d.round}: ${d.aff.name} vs. ${d.neg.name}`;
export const contentHash = snapshot => createHash('sha256').update(JSON.stringify({rounds:snapshot.rounds,divisions:snapshot.divisions,debates:snapshot.debates})).digest('hex');

export function compareSnapshots(before, after) {
  const previous=new Map(before.debates.map(d=>[pairingKey(d),d]));
  const current=new Map(after.debates.map(d=>[pairingKey(d),d]));
  const alerts=[],auditIds=new Set();
  const warn=(kind,debate,text,blocking=false)=>{alerts.push({kind,text,blocking,url:debate.ballot?.url || after.source});if(debate.ballot)auditIds.add(debate.id);};
  let newBallots=0,newDecisions=0;
  const bounds=new Map(before.divisions.map(division=>{
    const scores=before.debates.filter(d=>d.division===division).flatMap(d=>Object.values(d.ballot?.sides || {}).flatMap(t=>t.speakers.map(s=>s.score))).filter(Number.isFinite).sort((a,b)=>a-b);
    const q1=scores[Math.floor(scores.length*.25)],q3=scores[Math.floor(scores.length*.75)],spread=Math.max(5,q3-q1);
    return [division,scores.length>=12?[q1-3*spread,q3+3*spread]:null];
  }));
  for(const old of before.debates)if(!current.has(pairingKey(old)))warn('missing-pairing',old,`${label(old)}: pairing disappeared or changed.`,true);
  for(const d of after.debates) {
    const old=previous.get(pairingKey(d));
    if(d.ballot && !old?.ballot)newBallots++;
    if(d.winnerSide && !old?.winnerSide)newDecisions++;
    if(old?.ballot && !d.ballot)warn('withdrawn-ballot',d,`${label(d)}: a previously available ballot disappeared.`,true);
    if(old?.winnerSide && old.winnerSide!==d.winnerSide)warn('changed-decision',d,`${label(d)}: decision changed from ${old.winnerSide} to ${d.winnerSide || 'unavailable'}.`,!d.winnerSide);
    for(const side of ['aff','neg']) {
      const oldSpeakers=new Map((old?.ballot?.sides[side]?.speakers || []).map(s=>[s.name,s]));
      for(const speaker of d.ballot?.sides[side]?.speakers || []) {
        const prior=oldSpeakers.get(speaker.name),range=bounds.get(d.division);
        if(prior?.score!=null && prior.score!==speaker.score)warn('changed-score',d,`${label(d)}: ${speaker.name}'s score changed from ${prior.score} to ${speaker.score ?? 'missing'}.`,speaker.score===null);
        if(speaker.score!==null && speaker.score!==prior?.score && range && (speaker.score<range[0] || speaker.score>range[1]))warn('unusual-score',d,`${label(d)}: ${speaker.name}'s score ${speaker.score} is far outside this division's previous score distribution (review band ${range[0]}–${range[1]}, not an official scoring rule).`);
      }
      for(const prior of oldSpeakers.values())if(prior.score!==null && !(d.ballot?.sides[side]?.speakers || []).some(s=>s.name===prior.name))warn('missing-speaker',d,`${label(d)}: previously scored speaker ${prior.name} is missing.`,true);
    }
  }
  return {changed:contentHash(before)!==contentHash(after),newBallots,newDecisions,alerts,auditIds:[...auditIds],blocked:alerts.some(a=>a.blocking)};
}
