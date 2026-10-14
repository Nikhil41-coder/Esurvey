import test from 'node:test';
import assert from 'node:assert/strict';
import { annotate, validateTree, parentFamilies } from '../lib/tree.mjs';
const p=(id,relativeTo=null,connection=null,gender='male')=>({id,name:id,relativeTo,connection,gender});
test('head-referenced labels and generation levels across standard family branches',()=>{
  const family=annotate([p('Head'),p('Mother','Head','parent','female'),p('Father','Head','parent'),p('John','Head','child'),p('Emily','Head','child','female'),p('Oliver','John','child'),p('Ava','John','spouse','female'),p('Grandma','Mother','parent','female'),p('Aunt','Mother','sibling','female'),p('Cousin','Aunt','child'),p('Sister','Head','sibling','female'),p('Niece','Sister','child','female')]);
  const by=new Map(family.map(p=>[p.id,p]));
  for(const [id,relationship,generation] of [['Head','Head of family',0],['Mother','Mother',-1],['John','Son',1],['Emily','Daughter',1],['Oliver','Grandson',2],['Ava','Daughter-in-law',1],['Grandma','Grandmother',-2],['Aunt','Aunt',-1],['Cousin','First cousin',0],['Niece','Niece',1]]){assert.equal(by.get(id).relationship,relationship);assert.equal(by.get(id).generation,generation);}
});
test('neutral labels, deep generations, and explicit complex paths',()=>{
  const family=annotate([p('Head'),p('Child','Head','child','other'),p('Grandchild','Child','child','other'),p('Great','Grandchild','child','other'),p('Partner','Head','spouse','other'),p('PartnerSibling','Partner','sibling','other'),p('Complex','PartnerSibling','spouse','other')]);
  assert.equal(family[1].relationship,'Child');assert.equal(family[2].relationship,'Grandchild');assert.equal(family[3].relationship,'Great-Grandchild');assert.equal(family[5].relationship,'Sibling-in-law');assert.equal(family[6].relationship,'Spouse’s Sibling’s Spouse');
});
test('cousin degree and generation removal from ancestry paths',()=>{
  const members=[p('Head'),p('Parent','Head','parent'),p('Grandparent','Parent','parent'),p('Branch','Grandparent','child'),p('Cousin','Branch','child'),p('Removed','Cousin','child')];
  const result=annotate(members);assert.equal(result[4].relationship,'First cousin');assert.equal(result[5].relationship,'First cousin · 1 generation removed');
});
test('reject cycles, disconnected roots, missing relatives, duplicates, and invalid links',()=>{
  assert.throws(()=>validateTree([p('Head'),p('A','B','child'),p('B','A','child')]),/cycle/);
  assert.throws(()=>validateTree([p('Head'),p('Other')]),/one head/);
  assert.throws(()=>validateTree([p('Head'),p('A','unknown','child')]),/existing relative/);
  assert.throws(()=>validateTree([p('Head'),p('Head','Head','child')]),/unique/);
  assert.throws(()=>validateTree([p('Head'),p('A','Head','invalid')]),/valid connection/);
});
test('handles an empty tree and the bounded maximum of 500 members',()=>{
  assert.deepEqual(annotate([]),[]);const people=[p('Head')];for(let i=1;i<500;i++)people.push(p(String(i),i===1?'Head':String(i-1),'child'));
  const result=annotate(people);assert.equal(result.at(-1).generation,499);assert.throws(()=>validateTree([...people,p('extra','Head','child')]),/500/);
});
test('shared children connect to both parents, including children entered under the spouse',()=>{
  const members=[p('Head'),p('Wife','Head','spouse','female'),{...p('Son','Wife','child'),secondParent:'Head'},{...p('Daughter','Head','child','female'),secondParent:'Wife'}];
  const result=annotate(members);assert.equal(result[2].relationship,'Son');assert.equal(result[2].generation,1);assert.equal(result[3].relationship,'Daughter');
  assert.deepEqual(parentFamilies(members),[{parents:['Head','Wife'],children:['Son','Daughter']}]);
});
test('two explicitly entered parents share a junction above their child, including the head',()=>{
  assert.deepEqual(parentFamilies([p('Head'),p('Father','Head','parent'),p('Mother','Head','parent','female')]),[{parents:['Father','Mother'],children:['Head']}]);
});
test('marriage alone does not assign an additional parent or alter stepchild labels',()=>{
  const members=[p('Head'),p('Wife','Head','spouse','female'),p('Son','Head','child'),p('Stepchild','Wife','child')];
  const families=parentFamilies(members);assert.deepEqual(families,[{parents:['Head'],children:['Son']},{parents:['Wife'],children:['Stepchild']}]);assert.equal(annotate(members)[3].relationship,'Stepson');
});
test('reject missing, duplicate, self, wrong-generation, and non-child second-parent links',()=>{
  const members=[p('Head'),p('Wife','Head','spouse','female'),p('Son','Head','child')];
  for(const secondParent of ['missing','Head','Son'])assert.throws(()=>validateTree(members.map(p=>p.id==='Son'?{...p,secondParent}:p)),/different existing/);
  assert.throws(()=>validateTree([...members,{...p('Grandchild','Son','child'),secondParent:'Head'}]),/same generation/);
  assert.throws(()=>validateTree(members.map(p=>p.id==='Wife'?{...p,secondParent:'Son'}:p)),/child connection/);
});
