import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFile, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifySnapshot } from './verify.mjs';
import { compareSnapshots, contentHash, notificationKey } from './watch-checks.mjs';

// Reset/checkout operations below are confined to the disposable Actions runner.
assert.equal(process.env.GITHUB_ACTIONS,'true','The watcher runs only in GitHub Actions.');
assert.equal(resolve(process.cwd()),resolve(process.env.GITHUB_WORKSPACE));
const repo='danspot/seattle-u-debate-rankings-2026';
assert.equal(process.env.GITHUB_REPOSITORY,repo);
const site='https://danspot.github.io/seattle-u-debate-rankings-2026/';
const runUrl=`https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const interval=10*60*1000;
const start=Date.parse(process.env.WATCH_START),end=Date.parse(process.env.WATCH_END);
assert.ok(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=4*60*60*1000,'Watch window must be at most four hours.');
const state={start:new Date(start).toISOString(),end:new Date(end).toISOString(),checks:0,published:0,alerts:0,runUrl,history:[]};
const notified=new Set();
let issueNumber,checkId,needsDeployment=false,phase='startup';
const pause=ms=>new Promise(r=>setTimeout(r,ms));

async function api(path,method='GET',body) {
  for(let attempt=0;attempt<4;attempt++) {
    const response=await fetch(`https://api.github.com/repos/${repo}/${path}`,{method,signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const text=await response.text();
    // A newly created check can briefly be absent from the update endpoint.
    if(response.status===404 && method==='PATCH' && path.startsWith('check-runs/') && attempt<3){await pause(1000*(attempt+1));continue;}
    if(!response.ok)throw Error(`GitHub ${method} ${path}: ${response.status} ${text.slice(0,500)}`);
    return text?JSON.parse(text):null;
  }
}
async function run(command,args,timeout=120000,env={}) {
  console.log(`> ${command} ${args.join(' ')}`);
  const label=args[0]?.startsWith('scripts/') ? args[0] : command;
  return new Promise((done,fail)=>{
    const child=spawn(command,args,{env:{...process.env,...env},stdio:['ignore','pipe','pipe'],detached:true});
    let output='';
    const capture=chunk=>{process.stdout.write(chunk);output=(output+chunk).slice(-6000);};
    child.stdout.on('data',capture);child.stderr.on('data',capture);
    const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}fail(Object.assign(Error(`${label} timed out after ${timeout/1000}s`),{watchKey:`timeout:${label}`}));},timeout);
    child.on('error',e=>{clearTimeout(timer);fail(e);});
    child.on('exit',code=>{clearTimeout(timer);const detail=output.match(/(?:AUDIT FAILED:|AssertionError[^:]*:|Error:) ([^\n]+)/)?.[1] || 'See the run log for details.';code===0?done(output.trim()):fail(Object.assign(Error(`${label} exited ${code}: ${detail.slice(0,500)}`),{watchKey:`exit:${label}:${code}:${detail.slice(0,200)}`}));});
  });
}
async function status(message,nextCheck=null) {
  const entry={at:new Date().toISOString(),message,nextCheck};
  state.history.push(entry);state.lastStatus=entry;
  console.log(JSON.stringify(entry));
  await writeFile('.local/watch-status.json',JSON.stringify(state,null,2));
  await appendFile('.local/watch.jsonl',JSON.stringify(entry)+'\n');
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`- ${entry.at}: ${message}\n`);
  if(checkId)await api(`check-runs/${checkId}`,'PATCH',{output:{title:message,summary:`Checks: ${state.checks}; publications: ${state.published}; alerts: ${state.alerts}.\n\nStops: ${state.end}. ${nextCheck?`Next check: ${nextCheck}.`:''}\n\n${state.history.slice(-24).map(h=>`- ${h.at}: ${h.message}`).join('\n')}`}}).catch(error=>console.warn(`Progress display update failed; monitoring continues: ${error.message}`));
}
async function alert(items) {
  const fresh=items.filter(item=>{
    const key=notificationKey(item);
    if(notified.has(key))return false;notified.add(key);return true;
  });
  if(!fresh.length)return;
  const safe=text=>text.replaceAll('@','＠').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const body=`@danspot — the tournament watch found items to review.\n\n${fresh.slice(0,100).map(a=>`- ${safe(a.text)}${a.url?` [Source](${a.url})`:''}`).join('\n')}${fresh.length>100?`\n\n${fresh.length-100} more items are recorded in the watch log.`:''}\n\n[Watch run](${runUrl}) · [Public rankings](${site})\n\nCandidate score/decision changes still require a separate live ballot check before publication. Missing/contradictory data is held from publication. A debate decision differing from speaker-score totals is not treated as an error.`;
  if(!issueNumber){const issue=await api('issues','POST',{title:`Tournament watch alerts — ${new Date(start).toISOString()}`,body,assignees:['danspot']});issueNumber=issue.number;state.alertUrl=issue.html_url;}
  else await api(`issues/${issueNumber}/comments`,'POST',{body});
  state.alerts+=fresh.length;
}
async function localQA() {
  const server=spawn(process.execPath,['scripts/serve.mjs'],{stdio:'inherit'});
  try {
    let ready=false;
    for(let i=0;i<30;i++){try{ready=(await fetch('http://127.0.0.1:4173/')).ok;}catch{}if(ready)break;await pause(200);}
    assert.ok(ready,'Preview did not start');
    await run(process.execPath,['scripts/qa.mjs']);
  } finally {server.kill('SIGTERM');}
}
async function deploy() {
  const sha=await run('git',['rev-parse','HEAD']);
  await api('pages/builds','POST',{});
  let built=false;
  for(let i=0;i<48;i++) {
    await pause(5000);
    const build=await api('pages/builds/latest');
    if(build.commit===sha && build.status==='errored')throw Error(`Pages failed: ${build.error?.message}`);
    if(build.commit===sha && build.status==='built'){built=true;break;}
  }
  assert.ok(built,'Pages did not finish building the new commit');
  // Allow the public CDN to converge before declaring a failed publication.
  let lastError;
  for(let i=0;i<4;i++){
    try{await run(process.execPath,['scripts/qa.mjs',`${site}?v=${sha}`]);needsDeployment=false;return sha;}
    catch(error){lastError=error;if(i<3)await pause(15000);}
  }
  throw lastError;
}
async function cycle() {
  await run('git',['fetch','origin','main']);
  await run('git',['reset','--hard','origin/main']);
  const base=await run('git',['rev-parse','HEAD']);
  if(needsDeployment){await deploy();await status('Retried deployment and verified public site.');}
  const previous=JSON.parse(await readFile('data/results.json','utf8'));
  phase='extraction';await status(`Check ${state.checks}: reading all source ballots.`);
  await run(process.execPath,['scripts/scrape.mjs'],8*60*1000,{SCRAPE_OUTPUT:'.local/candidate.json'});
  const candidate=JSON.parse(await readFile('.local/candidate.json','utf8'));
  verifySnapshot(candidate);
  const diff=compareSnapshots(previous,candidate);
  await writeFile('.local/watch-diff.json',JSON.stringify(diff,null,2));
  if(diff.blocked){await alert(diff.alerts);await status('Suspicious regression held for review; public snapshot preserved.');return;}
  if(!diff.changed){
    const published=await fetch(`${site}data/results.json?v=${Date.now()}`,{signal:AbortSignal.timeout(30000)});
    if(!published.ok || contentHash(await published.json())!==contentHash(previous)){needsDeployment=true;await deploy();await status('Repaired a stale public deployment.');}
    await status('No tournament data changes.');return;
  }
  await alert(diff.alerts);
  phase='source audit';await status(`Check ${state.checks}: auditing source samples and ${diff.auditIds.length} changed ballots.`);
  await run(process.execPath,['scripts/verify-source.mjs'],3*60*1000,{SNAPSHOT_PATH:'.local/candidate.json',AUDIT_IDS:diff.auditIds.join(','),REFRESH_FEEDBACK:'1'});
  phase='build and browser checks';await status(`Check ${state.checks}: source audit passed; testing the new site.`);
  await copyFile('.local/candidate.json','data/results.json');
  await run(process.execPath,['scripts/build.mjs']);
  await run('npm',['test']);
  await localQA();
  await run('git',['fetch','origin','main']);
  if(await run('git',['rev-parse','origin/main'])!==base){await status('Repository changed during extraction; will retry from the latest version.');return;}
  await run('git',['add','data/results.json','data/verification.json','index.html']);
  await run('git',['commit','-m',`Refresh posted Rounds 1–3 results (${new Date().toISOString()})`]);
  await run('git',['push','origin','HEAD:main']);
  needsDeployment=true;
  phase='publication';await status(`Check ${state.checks}: deploying and checking the public site.`);
  const sha=await deploy();
  state.published++;
  if(diff.alerts.length && issueNumber)await api(`issues/${issueNumber}/comments`,'POST',{body:`All ${diff.alerts.length} candidate changes passed the live ballot audit and were published in [${sha.slice(0,7)}](https://github.com/${repo}/commit/${sha}). Public desktop/iPhone checks passed. [Rankings](${site})`});
  await status(`Published ${sha.slice(0,7)}: ${diff.newDecisions} new decisions, ${diff.newBallots} newly available ballots; public desktop/iPhone checks passed.`);
}

await mkdir('.local',{recursive:true});
try {
  if(process.argv.includes('--failure')) {
    await alert([{text:'The scheduled watch failed unexpectedly. Check the linked run; future checks may have stopped.'}]);
  } else {
    const existing=(await api('issues?state=open&per_page=100')).find(i=>i.title===`Tournament watch alerts — ${new Date(start).toISOString()}`);
    if(existing){issueNumber=existing.number;state.alertUrl=existing.html_url;}
    if(process.env.WATCH_REPLACES_CHECK)await api(`check-runs/${process.env.WATCH_REPLACES_CHECK}`,'PATCH',{status:'completed',conclusion:'cancelled',completed_at:new Date().toISOString()}).catch(error=>console.warn(`Previous progress display could not be closed: ${error.message}`));
    const head=await run('git',['rev-parse','HEAD']);
    const check=await api('check-runs','POST',{name:'Tournament results monitor',head_sha:head,status:'in_progress',started_at:new Date().toISOString(),details_url:runUrl,output:{title:'Checking every 10 minutes',summary:`Automatic stop: ${state.end}.`}});
    checkId=check.id;
    await status('Watch started. Rounds 1–3 only.');
    const cadenceStart=Date.now();
    while(Date.now()<end) {
      state.checks++;
      try {await cycle();}
      catch(error){console.error(error);await alert([{key:error.watchKey || `${phase}:${error.message}`,text:`Monitoring failed during ${phase}: ${error.message.slice(0,700)}`}]);await status(`Check ${state.checks} failed during ${phase}; next scheduled check will retry.`);}
      const next=cadenceStart+(Math.floor((Date.now()-cadenceStart)/interval)+1)*interval;
      await status('Waiting for next check.',next<end?new Date(next).toISOString():null);
      while(Date.now()<Math.min(next,end))await pause(Math.min(30000,Math.min(next,end)-Date.now()));
    }
    await status('Four-hour watch finished. No further checks scheduled.');
    await api(`check-runs/${checkId}`,'PATCH',{status:'completed',conclusion:state.alerts?'neutral':'success',completed_at:new Date().toISOString()});
  }
} catch(error) {
  console.error(error);
  if(checkId)await api(`check-runs/${checkId}`,'PATCH',{status:'completed',conclusion:'failure',completed_at:new Date().toISOString()}).catch(console.error);
  throw error;
}
