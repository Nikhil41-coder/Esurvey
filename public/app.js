import { annotate, parentFamilies } from '/tree.mjs';
const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
let members = [], revision = 0, csrf = '', selectedId = null, editingId = null, demo = false, zoom = 1, graphWidth = 700, graphHeight = 500, positions = new Map();
const demoMembers = annotate([
  {id:'demo-head',name:'Robert Doe',gender:'male',age:62,occupation:'Retired teacher',place:'Springfield',doorNumber:'5',notes:'Example head of family.',relativeTo:null,connection:null},
  {id:'demo-parent',name:'Elizabeth Doe',gender:'female',age:86,occupation:'Retired librarian',place:'Springfield',doorNumber:'5',notes:'These are fictional example records.',relativeTo:'demo-head',connection:'parent'},
  {id:'demo-spouse',name:'Maria Doe',gender:'female',age:59,occupation:'Artist',place:'Springfield',doorNumber:'5',notes:'Enjoys painting and family gatherings.',relativeTo:'demo-head',connection:'spouse'},
  {id:'demo-son',name:'John Doe',gender:'male',age:30,occupation:'Engineer',place:'Springfield',doorNumber:'5',notes:'Fictional example family member.',relativeTo:'demo-head',connection:'child',secondParent:'demo-spouse'},
  {id:'demo-daughter',name:'Emily Doe',gender:'female',age:27,occupation:'Architect',place:'Riverside',doorNumber:'12B',notes:'Fictional example family member.',relativeTo:'demo-head',connection:'child',secondParent:'demo-spouse'},
  {id:'demo-inlaw',name:'Ava Doe',gender:'female',age:29,occupation:'Designer',place:'Springfield',doorNumber:'5',notes:'Fictional example family member.',relativeTo:'demo-son',connection:'spouse'},
  {id:'demo-grandson',name:'Oliver Doe',gender:'male',age:6,occupation:'Student',place:'Springfield',doorNumber:'5',notes:'Fictional example family member.',relativeTo:'demo-son',connection:'child',secondParent:'demo-inlaw'}
]);
const current = () => demo ? demoMembers : members;
const initials = name => name.trim().split(/\s+/).slice(0,2).map(w=>Array.from(w)[0]).join('').toUpperCase();
function svgElement(tag,attrs={}){const el=document.createElementNS(svgNS,tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));return el;}
function announce(text,error=false){$('page-message').textContent=text;$('page-message').classList.toggle('error',error);}
async function api(url,method='GET',data){const response=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(data!==undefined?{body:JSON.stringify(data)}:{})});if(response.status===401){location.assign('/');throw new Error('Your session has expired. Sign in again.');}const result=await response.json();if(!response.ok){const error=new Error(result.error);error.status=response.status;throw error;}return result;}
function updateFamily(result){members=result.members;revision=result.revision;demo=false;render();}
function showDialog(id){$(id).showModal();}
document.querySelectorAll('dialog .dialog-close,dialog .cancel').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const box=dialog.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)dialog.close();}}));
function renderDirectory(){
  const list=$('member-list'),query=$('search').value.trim().toLowerCase(),people=current();list.replaceChildren();
  const matches=people.filter(p=>[p.name,p.place,p.relationship,p.doorNumber].some(v=>v.toLowerCase().includes(query)));
  $('search-status').textContent=`${matches.length} matching member${matches.length===1?'':'s'}`;
  if(!matches.length){const p=document.createElement('p');p.className='directory-empty';p.textContent=people.length?'No matching members. Try a different name or place.':'Your family members will appear here.';list.append(p);}
  for(const p of matches){const button=document.createElement('button');button.type='button';button.className='member-row';button.dataset.memberId=p.id;const avatar=document.createElement('span');avatar.className='avatar';avatar.textContent=initials(p.name);const text=document.createElement('span'),name=document.createElement('strong'),relation=document.createElement('small');name.textContent=p.name;relation.textContent=p.relationship;text.append(name,relation);button.append(avatar,text);button.addEventListener('click',()=>{focusMember(p.id);showDetails(p.id);});list.append(button);}
  document.querySelectorAll('.node-card').forEach(card=>{const p=people.find(p=>p.id===card.dataset.memberId);card.classList.toggle('highlighted',!!query&&matches.some(m=>m.id===p.id));});
}
function layout(people){
  const byId=new Map(people.map(p=>[p.id,p])),children=new Map(people.map(p=>[p.id,[]]));
  const head=people.find(p=>!p.relativeTo);
  for(const p of people)if(p.relativeTo)children.get(p.relativeTo).push(p.id);
  // Post-order subtree centres determine stable left-to-right order. Members are
  // then grouped into biological generation rows, keeping same-row peers apart.
  let leaf=0;const preferred=new Map();
  function visit(id){const kids=children.get(id);if(!kids.length){preferred.set(id,leaf++);return;}kids.forEach(visit);preferred.set(id,kids.reduce((sum,k)=>sum+preferred.get(k),0)/kids.length);}
  visit(head.id);
  const ranks=[...new Set(people.map(p=>p.generation))].sort((a,b)=>a-b),rows=new Map(ranks.map(rank=>[rank,people.filter(p=>p.generation===rank).sort((a,b)=>preferred.get(a.id)-preferred.get(b.id))]));
  const columns=Math.max(...[...rows.values()].map(row=>row.length));graphWidth=Math.max(700,columns*260+160);graphHeight=Math.max(470,ranks.length*185+110);
  positions=new Map();
  ranks.forEach((rank,index)=>{const row=rows.get(rank),start=(graphWidth-(row.length*260-58))/2;row.forEach((p,col)=>positions.set(p.id,{x:start+col*260,y:82+index*185}));});
  return {ranks,byId};
}
function drawTree(){
  const people=current(),stage=$('tree-stage');stage.replaceChildren();
  if(!people.length){stage.hidden=true;$('empty-state').hidden=false;return;}stage.hidden=false;$('empty-state').hidden=true;
  const {ranks,byId}=layout(people),svg=svgElement('svg',{viewBox:`0 0 ${graphWidth} ${graphHeight}`,width:graphWidth,height:graphHeight,role:'group','aria-label':'Interactive family tree'}),edges=svgElement('g');
  ranks.forEach((rank,index)=>{const label=svgElement('text',{x:24,y:62+index*185,class:'generation-label'});label.textContent=rank===0?'HEAD’S GENERATION':rank<0?`${Math.abs(rank)} GENERATION${rank===-1?'':'S'} ABOVE`:`${rank} GENERATION${rank===1?'':'S'} BELOW`;svg.append(label);});
  const families=parentFamilies(people);
  families.forEach((family,index)=>{
    const parentPoints=family.parents.map(id=>positions.get(id)),childPoints=family.children.map(id=>positions.get(id));
    const xs=parentPoints.map(pos=>pos.x+101),parentY=Math.max(...parentPoints.map(pos=>pos.y+104)),junctionY=parentY+23+(index%2)*8,centre=(Math.min(...xs)+Math.max(...xs))/2;
    const childY=Math.min(...childPoints.map(pos=>pos.y)),busY=(junctionY+childY)/2,childXs=childPoints.map(pos=>pos.x+101);
    const group=svgElement('g',{'data-parent-family':JSON.stringify(family.parents),role:'img','aria-label':`${family.parents.map(id=>byId.get(id).name).join(' and ')} connected as parents of ${family.children.map(id=>byId.get(id).name).join(', ')}`});
    for(const pos of parentPoints)group.append(svgElement('path',{d:`M ${pos.x+101} ${pos.y+104} V ${junctionY}`,class:'edge parent'}));
    if(xs.length>1)group.append(svgElement('path',{d:`M ${Math.min(...xs)} ${junctionY} H ${Math.max(...xs)}`,class:'edge parent'}));
    group.append(svgElement('path',{d:`M ${centre} ${junctionY} V ${busY} H ${Math.min(centre,...childXs)} M ${centre} ${busY} H ${Math.max(centre,...childXs)}`,class:'edge child'}));
    for(const pos of childPoints)group.append(svgElement('path',{d:`M ${pos.x+101} ${busY} V ${pos.y}`,class:'edge child'}));
    if(xs.length>1)group.append(svgElement('circle',{cx:centre,cy:junctionY,r:3,fill:'#6e9674'}));
    edges.append(group);
  });
  people.forEach((p,index)=>{if(!p.relativeTo||p.connection==='child'||p.connection==='parent')return;const a=positions.get(p.relativeTo),b=positions.get(p.id);let d,labelX,labelY;
    if(a.y===b.y){const y=a.y-28-(index%2)*14;d=`M ${a.x+101} ${a.y} C ${a.x+101} ${y}, ${b.x+101} ${y}, ${b.x+101} ${b.y}`;labelX=(a.x+b.x)/2+101;labelY=y+2;}
    else {const fromY=a.y<b.y?a.y+104:a.y,toY=a.y<b.y?b.y:b.y+104,mid=(fromY+toY)/2;d=`M ${a.x+101} ${fromY} C ${a.x+101} ${mid}, ${b.x+101} ${mid}, ${b.x+101} ${toY}`;labelX=(a.x+b.x)/2+101;labelY=mid-6;}
    const path=svgElement('path',{d,class:`edge ${p.connection}`}),title=svgElement('title');title.textContent=`${p.name} is a ${p.connection} of ${byId.get(p.relativeTo).name}`;path.append(title);edges.append(path);
  });svg.append(edges);
  for(const p of people){const pos=positions.get(p.id),foreign=svgElement('foreignObject',{x:pos.x-4,y:pos.y-4,width:212,height:115}),button=document.createElement('button');button.type='button';button.className=`node-card${p.relativeTo?'':' head'}`;button.dataset.memberId=p.id;button.setAttribute('aria-label',`${p.name}, ${p.relationship}. View details`);button.title=`${p.name} · ${p.relationship}`;
    const avatar=document.createElement('span');avatar.className='avatar';avatar.textContent=initials(p.name);const content=document.createElement('span'),name=document.createElement('span'),relation=document.createElement('span');name.className='node-name';name.textContent=p.name;relation.className='node-relation';relation.textContent=p.relationship;content.append(name,relation);button.append(avatar,content);if(!p.relativeTo){const dot=document.createElement('span');dot.className='node-head-dot';dot.textContent='◆';dot.setAttribute('aria-hidden','true');button.append(dot);}button.addEventListener('click',()=>showDetails(p.id));foreign.append(button);svg.append(foreign);}
  stage.append(svg);applyZoom();
}
function render(){
  const people=current(),head=people.find(p=>!p.relativeTo);
  $('side-count').textContent=people.length;$('stat-members').textContent=people.length;
  $('stat-generations').textContent=people.length?Math.max(...people.map(p=>p.generation))-Math.min(...people.map(p=>p.generation))+1:0;
  $('stat-homes').textContent=new Set(people.map(p=>`${p.place.trim().toLowerCase()}\u0000${p.doorNumber.trim().toLowerCase()}`)).size;
  $('head-caption').textContent=head?`Relationships shown relative to ${head.name}`:'Begin with the head of your family';
  $('export').disabled=!members.length||demo;$('demo-notice').hidden=!demo;$('add-member').textContent=members.length?'＋ Add a member':'＋ Add head of family';
  drawTree();fitTree(.8);if(head)focusMember(head.id);renderDirectory();
}
function applyZoom(){const svg=$('tree-stage').querySelector('svg');if(svg){svg.setAttribute('width',graphWidth*zoom);svg.setAttribute('height',graphHeight*zoom);$('tree-stage').style.width=`${graphWidth*zoom}px`;$('tree-stage').style.height=`${graphHeight*zoom}px`;}$('zoom-label').textContent=`${Math.round(zoom*100)}%`;}
function fitTree(minZoom=.3){zoom=Math.max(minZoom,Math.min(1,($('tree-viewport').clientWidth-20)/graphWidth));applyZoom();$('tree-viewport').scrollLeft=0;}
function focusMember(id){const pos=positions.get(id);if(pos){$('tree-viewport').scrollTo({left:Math.max(0,(pos.x+101)*zoom-$('tree-viewport').clientWidth/2),top:Math.max(0,(pos.y+52)*zoom-$('tree-viewport').clientHeight/2)});}}
$('zoom-out').addEventListener('click',()=>{zoom=Math.max(.3,zoom-.1);applyZoom();});$('zoom-in').addEventListener('click',()=>{zoom=Math.min(2,zoom+.1);applyZoom();});$('fit').addEventListener('click',()=>fitTree());
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{fitTree(.8);const head=current().find(p=>!p.relativeTo);if(head)focusMember(head.id);},150);});
$('search').addEventListener('input',renderDirectory);
function updateRelationPreview(){const relative=members.find(p=>p.id===$('relative-to').value);if(!relative){$('relation-preview').textContent='';return;}const kind=$('connection').value,second=members.find(p=>p.id===$('second-parent').value);$('relation-preview').textContent=kind==='child'&&second?`This child will connect to both ${relative.name} and ${second.name}. Their relationship is shown relative to the family head.`:`This person will be recorded as a ${kind} of ${relative.name}. Their label on the tree will be calculated relative to the family head.`;}
function updateParentOptions(preferred){
  const relative=members.find(p=>p.id===$('relative-to').value),isChild=$('connection').value==='child';$('second-parent-field').hidden=!isChild;
  const select=$('second-parent');select.replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent='Not specified (one parent)';select.append(blank);
  if(relative&&isChild){for(const p of members)if(p.id!==relative.id&&p.id!==editingId&&p.generation===relative.generation){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;select.append(option);}
    const spouses=members.filter(p=>(p.relativeTo===relative.id&&p.connection==='spouse')||(relative.relativeTo===p.id&&relative.connection==='spouse'));
    select.value=preferred!==undefined?preferred:!editingId&&spouses.length===1?spouses[0].id:'';
  }updateRelationPreview();
}
function openForm(id=null){
  demo=false;render();editingId=id;const person=members.find(p=>p.id===id),head=members.find(p=>!p.relativeTo);$('member-form').reset();$('form-error').textContent='';
  const isHead=person?!person.relativeTo:!members.length;
  $('member-title').textContent=person?'Edit family member':isHead?'Add the head of family':'Add a family member';$('form-intro').textContent=isHead?'Every relationship will be shown relative to this person.':'Give this person a place in your family story.';$('save-member').textContent=person?'Save changes':isHead?'Create family tree':'Add member';$('connection-fields').hidden=isHead;
  const select=$('relative-to');select.replaceChildren();
  // Exclude the edited person's subtree; connecting into it would create a cycle.
  const excluded=new Set(id?[id]:[]);let changed=true;while(changed){changed=false;for(const p of members)if(excluded.has(p.relativeTo)&&!excluded.has(p.id)){excluded.add(p.id);changed=true;}}
  for(const p of members)if(!excluded.has(p.id)){const option=document.createElement('option');option.value=p.id;option.textContent=`${p.name}${p.relativeTo?'':' · Head of family'}`;select.append(option);}
  if(person){for(const key of ['name','age','gender','place','doorNumber','occupation','notes'])$('member-form').elements[key].value=person[key]??'';if(person.relativeTo){select.value=person.relativeTo;$('connection').value=person.connection;}}
  else if(head){select.value=head.id;$('person-place').value=head.place;$('person-door').value=head.doorNumber;}
  updateParentOptions(person?.secondParent||undefined);showDialog('member-dialog');$('person-name').focus();
}
$('relative-to').addEventListener('change',()=>updateParentOptions());$('connection').addEventListener('change',()=>updateParentOptions());$('second-parent').addEventListener('change',updateRelationPreview);
$('add-member').addEventListener('click',()=>openForm());$('add-head').addEventListener('click',()=>openForm());
$('member-form').addEventListener('submit',async e=>{
  e.preventDefault();const input=Object.fromEntries(new FormData(e.target)),isHead=$('connection-fields').hidden;input.revision=revision;if(isHead){input.relativeTo=null;input.connection=null;}if(isHead||input.connection!=='child')input.secondParent=null;
  $('save-member').disabled=true;$('form-error').textContent='';
  try{const result=await api(editingId?`/api/members/${editingId}`:'/api/members',editingId?'PATCH':'POST',input);updateFamily(result);$('member-dialog').close();announce(`${input.name} ${editingId?'has been updated':'has been added to your family tree'}.`);}
  catch(error){$('form-error').textContent=error.message;if(error.status===409)try{updateFamily(await api('/api/family'));}catch{}}
  finally{$('save-member').disabled=false;}
});
function showDetails(id){
  const p=current().find(p=>p.id===id);if(!p)return;selectedId=id;const head=current().find(p=>!p.relativeTo),relative=current().find(r=>r.id===p.relativeTo);
  $('details-avatar').textContent=initials(p.name);$('details-name').textContent=p.name;$('details-relation').textContent=p.relationship;$('details-reference').textContent=p.relativeTo?`Relationship to ${head.name}, head of family`:'The reference point for your family tree';
  $('details-age').textContent=p.age==null?'Not provided':`${p.age} ${p.age===1?'year':'years'}`;$('details-occupation').textContent=p.occupation||'Not provided';$('details-place').textContent=p.place;$('details-door').textContent=p.doorNumber;$('details-notes').textContent=p.notes||'';$('notes-section').hidden=!p.notes;
  $('details-connection').textContent=relative?`${p.name} is a ${p.connection} of ${relative.name}.\nPath from head: ${head.name} → ${p.path.map(step=>`${step.name} (${step.relationship.toLowerCase()})`).join(' → ')}`:`${p.name} is the head of this family.`;
  const family=parentFamilies(current()).find(f=>f.children.includes(id));if(family)$('details-connection').textContent+=`\nParents: ${family.parents.map(parentId=>current().find(m=>m.id===parentId).name).join(' and ')}.`;
  $('detail-actions').hidden=demo;$('details-error').textContent='';showDialog('details-dialog');
}
$('edit-member').addEventListener('click',()=>{$('details-dialog').close();openForm(selectedId);});
$('delete-member').addEventListener('click',()=>{const person=members.find(p=>p.id===selectedId);if(members.some(p=>p.relativeTo===selectedId||p.secondParent===selectedId)){$('details-error').textContent='This member connects other people. Edit those people to reconnect them, or remove them first.';return;}$('confirm-text').textContent=`Remove ${person.name} and their details from your family tree? This cannot be undone.`;showDialog('confirm-dialog');});
$('cancel-remove').addEventListener('click',()=>$('confirm-dialog').close());
$('confirm-remove').addEventListener('click',async()=>{const person=members.find(p=>p.id===selectedId);$('confirm-remove').disabled=true;try{updateFamily(await api(`/api/members/${selectedId}`,'DELETE',{revision}));$('confirm-dialog').close();$('details-dialog').close();announce(`${person.name} has been removed.`);}catch(error){$('confirm-dialog').close();$('details-error').textContent=error.message;if(error.status===409)try{updateFamily(await api('/api/family'));}catch{}}finally{$('confirm-remove').disabled=false;}});
$('show-demo').addEventListener('click',()=>{demo=true;render();});$('close-demo').addEventListener('click',()=>{demo=false;render();});
$('export').addEventListener('click',async()=>{try{const result=await api('/api/export'),url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='family-tree.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){announce(error.message,true);}});
$('help').addEventListener('click',()=>showDialog('help-dialog'));
$('logout').addEventListener('click',async()=>{try{await api('/api/logout','POST',{});location.assign('/');}catch(error){announce(error.message,true);}});
try{const session=await api('/api/session');if(!session.authenticated){location.assign('/');}else{csrf=session.csrf;$('account-name').textContent=session.user.name;$('account-avatar').textContent=initials(session.user.name);updateFamily(await api('/api/family'));}}
catch(error){announce(`Could not load your family: ${error.message}`,true);$('add-member').disabled=true;$('add-head').disabled=true;}
