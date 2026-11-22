const archivedPages=new Map((snapshot.archive?.pages || []).map(page=>[page.id,page]));
const archivedBallots=new Map(snapshot.debates.filter(d=>d.ballot).map(d=>[d.id,d]));
const archiveDialog=$('archive-dialog');
const archiveHistory=[];
let currentArchiveRoute=null;
$('archive-page').innerHTML='<option value="" disabled>Choose an archived page</option>'+[...archivedPages.values()].map(p=>`<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');

function ballotMarkup(debate) {
  const ballot=debate.ballot;
  const sideMarkup=side=>{
    const team=ballot.sides[side];
    if(!team)return '';
    return `<section class="ballot-side"><h3>${side==='aff'?'Proposition':'Opposition'}${ballot.winnerSide===side?' · Winner':''}</h3><p class="ballot-team">${esc(team.teamName)}</p>${team.school&&!normalize(team.teamName).includes(normalize(team.school))?`<p class="sub">${esc(team.school)}</p>`:''}<table><thead><tr><th>Speaker</th><th>Score</th></tr></thead><tbody>${team.speakers.map(p=>`<tr><td>${esc(p.name)}</td><td class="ballot-score">${esc(p.displayedScore)}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><td class="ballot-score">${scoreText(team.total)}</td></tr></tfoot></table></section>`;
  };
  const feedback=['aff','neg'].flatMap(side=>(ballot.sides[side]?.speakers || []).map(p=>`<details class="ballot-feedback"><summary>${esc(p.name)} <span>${side==='aff'?'Proposition':'Opposition'}</span></summary>${p.feedback?`<blockquote>${esc(p.feedback.text)}</blockquote>`:'<p class="missing">No individual feedback posted.</p>'}</details>`)).join('');
  return `<p class="ballot-context">${esc(debate.division)} · ${esc(debate.room)} · Ballot ${esc(ballot.code || debate.id)}</p>${ballot.topic?`<p class="ballot-topic">${esc(ballot.topic)}</p>`:''}<p class="ballot-judge">Judge: ${esc(ballot.judgeName || debate.judges || 'Not listed')}${ballot.judgeSchool?` · ${esc(ballot.judgeSchool)}`:''}</p><div class="ballot-sides">${sideMarkup('aff')}${sideMarkup('neg')}</div><section class="ballot-decision"><h3>Decision / Reason for Decision</h3>${ballot.decisionText?`<blockquote>${esc(ballot.decisionText)}</blockquote>`:'<p class="missing">No written decision posted.</p>'}</section><section><h3>Speaker feedback</h3>${feedback}</section>${ballot.archive?`<details class="original-text"><summary>Full captured ballot text</summary><pre>${esc(ballot.archive.text)}</pre></details>`:''}`;
}

function renderArchive(route,remember=true) {
  const [,kind,id]=route.match(/^#(ballot|archive)\/(.+)$/) || [];
  const debate=kind==='ballot'?archivedBallots.get(decodeURIComponent(id)):null;
  const page=kind==='archive'?archivedPages.get(decodeURIComponent(id)):null;
  if(!debate&&!page)return false;
  if(remember&&currentArchiveRoute&&currentArchiveRoute!==route)archiveHistory.push(currentArchiveRoute);
  currentArchiveRoute=route;
  $('archive-title').textContent=debate?`Round ${debate.round} ballot`:page.label;
  $('archive-content').innerHTML=debate?ballotMarkup(debate):`<div class="source-page">${page.html}</div><details class="original-text"><summary>Full captured page text</summary><pre>${esc(page.text)}</pre></details>`;
  // The dialog title already identifies the page; the exact heading remains in captured text.
  if(page)$('archive-content').querySelector('.source-page h2')?.remove();
  $('archive-page').value=page?.id || '';
  $('archive-search').value='';
  $('archive-search').hidden=Boolean(debate)||!page.tableRows;
  $('archive-back').hidden=archiveHistory.length===0;
  $('archive-original').href=debate?debate.ballot.url:page.url;
  const captured=debate?debate.ballot.archive?.capturedAt:page.capturedAt;
  $('archive-captured').textContent=`Captured ${new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Los_Angeles'}).format(new Date(captured || snapshot.extractedAt))} Pacific`;
  // Wrap wide source tables, and make links to this tournament stay in the archive.
  for(const table of $('archive-content').querySelectorAll('.source-page table')){
    const wrap=document.createElement('div');wrap.className='table-wrap';table.replaceWith(wrap);wrap.append(table);
  }
  for(const link of $('archive-content').querySelectorAll('a[href]')){
    const href=link.getAttribute('href');
    if(href.startsWith('#ballot/'))continue;
    const match=[...archivedPages.values()].find(p=>p.url===href);
    if(match){link.href=`#archive/${match.id}`;link.removeAttribute('target');}
  }
  if(!archiveDialog.open)archiveDialog.showModal();
  archiveDialog.scrollTop=0;
  return true;
}
function closeArchive() {
  archiveDialog.close();
  if(/^#(ballot|archive)\//.test(location.hash))history.replaceState(null,'',location.pathname+location.search);
  currentArchiveRoute=null;archiveHistory.length=0;
}
document.addEventListener('click',event=>{
  const link=event.target.closest('a[href^="#ballot/"],a[href^="#archive/"]');
  if(!link||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  const route=link.getAttribute('href');
  if(location.hash!==route)history.pushState(null,'',route);
  renderArchive(route);
});
window.addEventListener('popstate',()=>{
  if(!renderArchive(location.hash,false)&&archiveDialog.open)closeArchive();
});
$('archive-page').addEventListener('change',()=>{
  const route=`#archive/${$('archive-page').value}`;history.pushState(null,'',route);renderArchive(route);
});
$('archive-back').addEventListener('click',()=>{
  const route=archiveHistory.pop();if(route){history.replaceState(null,'',route);renderArchive(route,false);}
});
$('archive-close').addEventListener('click',closeArchive);
archiveDialog.addEventListener('cancel',event=>{event.preventDefault();closeArchive();});
archiveDialog.addEventListener('click',event=>{
  const box=archiveDialog.getBoundingClientRect();
  if(event.target===archiveDialog&&(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom))closeArchive();
});
$('archive-search').addEventListener('input',()=>{
  const query=normalize($('archive-search').value);
  for(const row of $('archive-content').querySelectorAll('.source-page tbody tr'))row.hidden=!normalize(row.textContent).includes(query);
});
function downloadFile(name,content,type) {
  const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
$('offline-download').addEventListener('click',event=>{event.preventDefault();downloadFile('seattle-u-debate-2026.html',offlineHtml,'text/html;charset=utf-8');});
$('data-download').addEventListener('click',event=>{event.preventDefault();downloadFile('results.json',JSON.stringify(snapshot,null,2),'application/json');});
renderArchive(location.hash);
