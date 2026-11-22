// Functions in this module execute in Chromium against the rendered public page.
export function readBallotDetails() {
  const main=document.querySelector('main');
  if(!main)throw Error('Ballot content is missing');
  const topicLabel=main.querySelector('[data-testid="ballot-debate-topic"] h2');
  const decisionHeading=[...main.querySelectorAll('h6')].find(e=>e.textContent.trim()==='Decision / Reason for Decision');
  return {
    topic:topicLabel?.nextElementSibling?.innerText.trim() || null,
    judgeSchool:main.querySelector('[data-testid="ballot-judge-program-name"]')?.innerText.trim() || null,
    decisionText:decisionHeading?.nextElementSibling?.innerText.trim() || null,
    archive:{capturedAt:new Date().toISOString(),text:main.innerText.trim()}
  };
}

export function readPageArchive() {
  const root=document.querySelector('main');
  if(!root)throw Error('Public page content is missing');
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const allowed=new Set(['h1','h2','h3','h4','h5','h6','p','ul','ol','li','dl','dt','dd','strong','b','em','i','br','hr','table','caption','thead','tbody','tfoot','tr','th','td','blockquote']);
  const drop=new Set(['script','style','svg','input','textarea','select','noscript','iframe','object','embed','img']);
  const walk=node=>{
    if(node.nodeType===Node.TEXT_NODE)return escape(node.textContent);
    if(node.nodeType!==Node.ELEMENT_NODE)return '';
    const name=node.tagName.toLowerCase(),css=getComputedStyle(node);
    if(drop.has(name)||css.display==='none'||css.visibility==='hidden'||node.getAttribute('aria-hidden')==='true')return '';
    const content=[...node.childNodes].map(walk).join('');
    if(name==='button'&&/^view-ballot-\d+$/.test(node.id))return `<a href="#ballot/${node.id.slice(12)}">Ballot</a>`;
    if(name==='a') {
      const href=node.getAttribute('href') || '';
      if(/^(https?:|mailto:)/i.test(node.href))return `<a href="${escape(node.href)}" target="_blank" rel="noopener">${content}</a>`;
      return content;
    }
    if(css.textDecorationLine.includes('underline')&&name==='span'&&node.hasAttribute('aria-label'))return `<strong>${content}</strong>`;
    if(!content.trim()&&!['br','hr'].includes(name))return '';
    const tag=allowed.has(name)?name:['div','section','article','form'].includes(name)?'div':'span';
    const attrs=['th','td'].includes(tag)?['colspan','rowspan'].filter(a=>/^\d+$/.test(node.getAttribute(a)||'')).map(a=>` ${a}="${node.getAttribute(a)}"`).join(''):'';
    return `<${tag}${attrs}>${content}${['br','hr'].includes(tag)?'':`</${tag}>`}`;
  };
  return {
    url:location.href,capturedAt:new Date().toISOString(),text:root.innerText.trim(),
    html:[...root.childNodes].map(walk).join(''),
    tableRows:[...root.querySelectorAll('tbody')].reduce((sum,t)=>sum+t.querySelectorAll('tr').length,0),
    assets:[...root.querySelectorAll('img[src],a[download]')].map(e=>e.src || e.href)
  };
}

export const publicPages=[
  ['about','About','Seattle U SAT NOV 21 2026'],['fees','Fees','Tournament Fees'],
  ['divisions','Divisions','Tournament Divisions'],['schools','Schools','Schools'],
  ['coaches','Coaches','Coaches'],['helpers','Helpers','Helpers'],['teams','Teams','Teams'],
  ['judges','Judges','Judges'],['speakers','Speech events','Speech Events'],
  ['schedule','Schedule & topics','Schedule & Topics'],['announcements','Announcements','Announcements'],
  ['attachments','Attachments','Attachments'],['contact','Contact','Contact Tournament Staff']
];
