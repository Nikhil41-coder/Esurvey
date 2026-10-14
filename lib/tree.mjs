// Primary connections form a rooted tree. Explicit second-parent edges form a
// pedigree DAG; spouse links may form social cycles, but ancestry may not.
export const inverse = { child: 'parent', parent: 'child', spouse: 'spouse', sibling: 'sibling' };
export function validateTree(members) {
  if (members.length > 500) throw new Error('A family can contain up to 500 members.');
  if (!members.length) return;
  const ids = new Set(members.map(p => p.id));
  if (ids.size !== members.length) throw new Error('Member IDs must be unique.');
  if (members.filter(p => !p.relativeTo).length !== 1) throw new Error('A family needs exactly one head.');
  const byId = new Map(members.map(p => [p.id, p]));
  for (const p of members) {
    if (!p.relativeTo) continue;
    if (!ids.has(p.relativeTo) || !inverse[p.connection]) throw new Error('Choose an existing relative and a valid connection.');
    const seen = new Set([p.id]);
    let current = p;
    while (current.relativeTo) {
      if (seen.has(current.relativeTo)) throw new Error('This connection would create a cycle. Choose another relative.');
      seen.add(current.relativeTo);
      current = byId.get(current.relativeTo);
    }
  }
  const primaryGraph = adjacency(members, false), head = members.find(p => !p.relativeTo);
  const generation = new Map([[head.id, 0]]), queue = [head.id];
  for (let i = 0; i < queue.length; i++) for (const edge of primaryGraph.get(queue[i])) if (!generation.has(edge.id)) {
    generation.set(edge.id, generation.get(queue[i]) + (edge.kind === 'child' ? 1 : edge.kind === 'parent' ? -1 : 0)); queue.push(edge.id);
  }
  for (const p of members) if (p.secondParent) {
    if (p.connection !== 'child' || !p.relativeTo) throw new Error('A second parent can only be selected for a child connection.');
    if (!ids.has(p.secondParent) || p.secondParent === p.id || p.secondParent === p.relativeTo) throw new Error('Choose a different existing person as the second parent.');
    if (generation.get(p.secondParent) !== generation.get(p.relativeTo)) throw new Error('Both parents must belong to the same generation.');
  }
  const descendants = new Map(members.map(p => [p.id, []]));
  for (const family of parentFamilies(members)) for (const parent of family.parents) for (const child of family.children) descendants.get(parent).push(child);
  const visiting = new Set(), visited = new Set();
  function visit(id) { if (visiting.has(id)) throw new Error('This parent connection would create an ancestry cycle.'); if (visited.has(id)) return; visiting.add(id); for (const child of descendants.get(id)) visit(child); visiting.delete(id); visited.add(id); }
  for (const p of members) visit(p.id);
}
export function adjacency(members, includeSecondParents = true) {
  const graph = new Map(members.map(p => [p.id, []]));
  for (const p of members) if (p.relativeTo) {
    graph.get(p.relativeTo).push({ id: p.id, kind: p.connection });
    graph.get(p.id).push({ id: p.relativeTo, kind: inverse[p.connection] });
  }
  if (includeSecondParents) for (const p of members) if (p.secondParent) {
    graph.get(p.secondParent).push({ id: p.id, kind: 'child' });
    graph.get(p.id).push({ id: p.secondParent, kind: 'parent' });
  }
  for (const edges of graph.values()) edges.sort((a, b) => Number(a.kind === 'spouse') - Number(b.kind === 'spouse'));
  return graph;
}
// Group confirmed parent links by parent set. These shared junctions connect
// children to both recorded parents without inferring parenthood from marriage.
export function parentFamilies(members) {
  const parentsByChild = new Map(members.map(p => [p.id, new Set()]));
  for (const p of members) {
    if (p.relativeTo && p.connection === 'child') parentsByChild.get(p.id).add(p.relativeTo);
    if (p.relativeTo && p.connection === 'parent') parentsByChild.get(p.relativeTo)?.add(p.id);
    if (p.secondParent) parentsByChild.get(p.id).add(p.secondParent);
  }
  const groups = new Map();
  for (const [child, parentSet] of parentsByChild) if (parentSet.size) {
    const parents = [...parentSet].sort(), key = JSON.stringify(parents);
    if (!groups.has(key)) groups.set(key, { parents, children: [] });
    groups.get(key).children.push(child);
  }
  return [...groups.values()];
}
function word(kind, gender) {
  const words = { child: ['Son', 'Daughter', 'Child'], parent: ['Father', 'Mother', 'Parent'], sibling: ['Brother', 'Sister', 'Sibling'], spouse: ['Husband', 'Wife', 'Spouse'] };
  return words[kind][gender === 'male' ? 0 : gender === 'female' ? 1 : 2];
}
function sex(gender, male, female, neutral) { return gender === 'male' ? male : gender === 'female' ? female : neutral; }
export function kinship(path, byId) {
  if (!path.length) return 'Head of family';
  const gender = byId.get(path.at(-1).id).gender;
  if (path.length === 1) return word(path[0].kind, gender);
  const kinds = path.map(e => e.kind);
  if (kinds.every(k => k === 'child') || kinds.every(k => k === 'parent')) {
    const ancestor = kinds[0] === 'parent';
    const base = ancestor ? sex(gender, 'father', 'mother', 'parent') : sex(gender, 'son', 'daughter', 'child');
    return `${'Great-'.repeat(kinds.length - 2)}Grand${base}`.replace(/^Grand/, 'Grand');
  }
  const key = kinds.join(',');
  const common = {
    'parent,child': sex(gender, 'Brother', 'Sister', 'Sibling'),
    'sibling,child': sex(gender, 'Nephew', 'Niece', 'Nibling'),
    'parent,sibling': sex(gender, 'Uncle', 'Aunt', 'Parent’s sibling'),
    'sibling,parent': word('parent', gender),
    'child,spouse': sex(gender, 'Son-in-law', 'Daughter-in-law', 'Child’s spouse'),
    'spouse,parent': sex(gender, 'Father-in-law', 'Mother-in-law', 'Parent-in-law'),
    'parent,spouse': sex(gender, 'Stepfather', 'Stepmother', 'Stepparent'),
    'spouse,child': sex(gender, 'Stepson', 'Stepdaughter', 'Stepchild'),
    'sibling,spouse': sex(gender, 'Brother-in-law', 'Sister-in-law', 'Sibling-in-law'),
    'spouse,sibling': sex(gender, 'Brother-in-law', 'Sister-in-law', 'Sibling-in-law'),
    'parent,sibling,child': 'First cousin',
    'parent,parent,child': sex(gender, 'Uncle', 'Aunt', 'Parent’s sibling'),
    'parent,child,child': sex(gender, 'Nephew', 'Niece', 'Nibling'),
    'parent,parent,child,child': 'First cousin'
  };
  if (common[key]) return common[key];
  // U^a D^b paths give cousin degree and removal without guessing complex
  // remarriage/step relationships. Unrecognized paths retain explicit labels.
  const blood = kinds.flatMap(k => k === 'sibling' ? ['parent', 'child'] : [k]);
  const down = blood.indexOf('child');
  if (down > 0 && blood.slice(0, down).every(k => k === 'parent') && blood.slice(down).every(k => k === 'child')) {
    const up = down, below = blood.length - down;
    if (up > 1 && below > 1) {
      const degree = Math.min(up, below) - 1, removed = Math.abs(up - below);
      const ordinal = degree === 1 ? 'First' : degree === 2 ? 'Second' : degree === 3 ? 'Third' : `${degree}th`;
      return `${ordinal} cousin${removed ? ` · ${removed} generation${removed === 1 ? '' : 's'} removed` : ''}`;
    }
  }
  return path.map((e, i) => word(e.kind, byId.get(e.id).gender) + (i < path.length - 1 ? '’s' : '')).join(' ');
}
export function annotate(members) {
  validateTree(members);
  if (!members.length) return [];
  const head = members.find(p => !p.relativeTo), graph = adjacency(members), byId = new Map(members.map(p => [p.id, p]));
  const paths = new Map([[head.id, []]]), generations = new Map([[head.id, 0]]), queue = [head.id];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const edge of graph.get(id)) if (!paths.has(edge.id)) {
      paths.set(edge.id, [...paths.get(id), edge]);
      generations.set(edge.id, generations.get(id) + (edge.kind === 'child' ? 1 : edge.kind === 'parent' ? -1 : 0));
      queue.push(edge.id);
    }
  }
  return members.map(p => ({ ...p, relationship: kinship(paths.get(p.id), byId), generation: generations.get(p.id), path: paths.get(p.id).map(e => ({ name: byId.get(e.id).name, relationship: word(e.kind, byId.get(e.id).gender) })) }));
}
