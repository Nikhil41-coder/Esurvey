import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { once } from 'node:events';
import { createApplication } from '../server.mjs';
const password='TestingOnly-Strong-42';
async function start(database=':memory:') {const app=createApplication({database,secure:false});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');app.origin=`http://127.0.0.1:${app.server.address().port}`;return app;}
async function stop(app){app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.db.close();}
function client(app){let cookie='',csrf='';return{get cookie(){return cookie;},get csrf(){return csrf;},async call(path,method='GET',body,extra={}){const response=await fetch(app.origin+path,{method,redirect:'manual',headers:{'Content-Type':'application/json',Origin:app.origin,...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});const type=response.headers.get('content-type');const data=type?.includes('json')?await response.json():await response.text();const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];if(data.csrf)csrf=data.csrf;return{status:response.status,data,headers:response.headers};}};}
const person=(name,relativeTo=null,connection=null,gender='male')=>({name,age:30,occupation:'Engineer',place:'Springfield',doorNumber:'5',notes:'A test record',gender,relativeTo,connection});
test('real authentication, private records, validation, CSRF, editing, export, and logout',async t=>{
  const app=await start();t.after(()=>stop(app));const a=client(app),b=client(app),anonymous=client(app);
  assert.equal((await anonymous.call('/api/family')).status,401);assert.equal((await anonymous.call('/app')).status,302);
  assert.equal((await a.call('/api/register','POST',{name:'Alice',email:'alice@example.test',password:'short'})).status,400);
  const registered=await a.call('/api/register','POST',{name:'Alice',email:'alice@example.test',password});assert.equal(registered.status,200);assert.match(registered.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.equal((await a.call('/app')).status,200);
  assert.equal((await anonymous.call('/api/login','POST',{email:'alice@example.test',password:'incorrect-password'})).status,401);
  assert.equal((await anonymous.call('/api/login','POST',{email:'absent@example.test',password})).status,401);
  await b.call('/api/register','POST',{name:'Bob',email:'bob@example.test',password});
  assert.deepEqual((await b.call('/api/family')).data.members,[]);
  const missingCsrf=await a.call('/api/members','POST',{...person('Robert'),revision:0},{'X-CSRF-Token':''});assert.equal(missingCsrf.status,403);
  assert.equal((await a.call('/api/members','POST',{...person('Robert'),revision:0},{Origin:'https://other.example'})).status,403);
  const root=await a.call('/api/members','POST',{...person('Robert'),revision:0});assert.equal(root.status,201);const head=root.data.members[0].id;
  assert.equal((await a.call('/api/members','POST',{...person('Missing place',head,'child'),place:'',revision:1})).status,400);
  assert.equal((await a.call('/api/members','POST',{...person('Invalid age',head,'child'),age:-1,revision:1})).status,400);
  const added=await a.call('/api/members','POST',{...person('John Doe',head,'child'),revision:1});assert.equal(added.status,201);const john=added.data.members.find(p=>p.name==='John Doe');assert.equal(john.relationship,'Son');assert.equal(john.age,30);assert.equal(john.occupation,'Engineer');assert.equal(john.place,'Springfield');assert.equal(john.doorNumber,'5');
  assert.deepEqual((await b.call('/api/family')).data.members,[]);
  assert.equal((await b.call(`/api/members/${john.id}`,'PATCH',{...person('Stolen'),revision:0})).status,404);
  assert.equal((await b.call(`/api/members/${john.id}`,'DELETE',{revision:0})).status,404);
  assert.equal((await a.call('/api/members','POST',{...person('Stale',head,'child'),revision:1})).status,409);
  const grand=await a.call('/api/members','POST',{...person('Oliver',john.id,'child'),revision:2});assert.equal(grand.data.members.at(-1).relationship,'Grandson');const oliver=grand.data.members.at(-1).id;
  assert.equal((await a.call(`/api/members/${john.id}`,'DELETE',{revision:3})).status,409);
  assert.equal((await a.call(`/api/members/${john.id}`,'PATCH',{...person('John Doe',oliver,'child'),revision:3})).status,400);
  assert.equal((await a.call(`/api/members/${head}`,'PATCH',{...person('Robert',john.id,'parent'),revision:3})).status,400);
  const edit=await a.call(`/api/members/${john.id}`,'PATCH',{...person('John Doe',head,'child'),occupation:'Architect',revision:3});assert.equal(edit.status,200);assert.equal(edit.data.members.find(p=>p.id===john.id).occupation,'Architect');
  const exported=await a.call('/api/export');assert.equal(exported.status,200);assert.equal(exported.data.members.length,3);assert.match(exported.headers.get('content-disposition'),/attachment/);
  assert.equal((await a.call(`/api/members/${oliver}`,'DELETE',{revision:4})).status,200);
  const previousCookie=a.cookie;assert.equal((await a.call('/api/logout','POST',{})).status,200);assert.equal((await a.call('/api/family')).status,401);
  assert.equal((await anonymous.call('/api/family','GET',undefined,{Cookie:previousCookie})).status,401);
  const login=await a.call('/api/login','POST',{email:'alice@example.test',password});assert.equal(login.status,200);assert.equal((await a.call('/api/family')).data.members.length,2);
  const stored=app.db.prepare('SELECT password_hash,salt FROM users WHERE email=?').get('alice@example.test');assert.notEqual(stored.password_hash,password);assert.equal(stored.salt.length,32);
});
test('family records and session survive a server restart on the same database',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'e-survey-test-')),filename=join(dir,'family.sqlite');let app;
  try{app=await start(filename);const user=client(app);await user.call('/api/register','POST',{name:'Persistent',email:'persistent@example.test',password});await user.call('/api/members','POST',{...person('Saved head'),revision:0});const cookie=user.cookie;await stop(app);app=await start(filename);const reconnected=client(app);const result=await reconnected.call('/api/family','GET',undefined,{Cookie:cookie});assert.equal(result.status,200);assert.equal(result.data.members[0].name,'Saved head');}
  finally{if(app?.server.listening)await stop(app);const target=resolve(dir);if(dirname(target)===resolve(tmpdir())&&basename(target).startsWith('e-survey-test-'))rmSync(target,{recursive:true,force:true});}
});
test('authentication attempt limit is enforced without blocking the server',async t=>{
  const app=await start();t.after(()=>stop(app));const user=client(app);for(let i=0;i<15;i++)assert.equal((await user.call('/api/login','POST',{email:'unknown@example.test',password})).status,401);assert.equal((await user.call('/api/login','POST',{email:'unknown@example.test',password})).status,429);assert.equal((await user.call('/api/session')).status,200);
});
test('second parents persist, correct head-relative labels, and cannot be removed while linked',async t=>{
  const app=await start();t.after(()=>stop(app));const user=client(app);await user.call('/api/register','POST',{name:'Parent test',email:'parents@example.test',password});
  const root=await user.call('/api/members','POST',{...person('Head'),revision:0}),head=root.data.members[0].id;
  const spouse=await user.call('/api/members','POST',{...person('Wife',head,'spouse','female'),revision:1}),wife=spouse.data.members[1].id;
  const child=await user.call('/api/members','POST',{...person('Son',wife,'child'),secondParent:head,revision:2});assert.equal(child.status,201);const son=child.data.members[2];assert.equal(son.relationship,'Son');assert.equal(son.secondParent,head);
  const loaded=await user.call('/api/family');assert.equal(loaded.data.members[2].secondParent,head);
  assert.equal((await user.call(`/api/members/${head}`,'DELETE',{revision:3})).status,409);
  assert.equal((await user.call(`/api/members/${son.id}`,'PATCH',{...person('Son',wife,'child'),secondParent:'not-a-family-member',revision:3})).status,400);
  assert.equal((await user.call(`/api/members/${son.id}`,'PATCH',{...person('Son',wife,'child'),secondParent:son.id,revision:3})).status,400);
  const cleared=await user.call(`/api/members/${son.id}`,'PATCH',{...person('Son',wife,'child'),secondParent:null,revision:3});assert.equal(cleared.status,200);assert.equal(cleared.data.members[2].secondParent,null);assert.equal(cleared.data.members[2].relationship,'Stepson');
});
