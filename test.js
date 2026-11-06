/*
 * ConstraintLab solver tests. Run: node test.js
 * Independent verification: every fact below is derived from the raw MIDI
 * pitches in the output, with a locally re-implemented checker - not from
 * the solver's own proof log.
 */
const CL = require('./solver.js');
let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.log('FAIL ' + name); }
}

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const SCALES = { major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,11] };
function scaleNotes(tonic, mode){ const pc = NOTE_NAMES.indexOf(tonic); return SCALES[mode].map(s => (pc+s)%12); }
const FUNC = { major:["T","S","T","S","D","T","D"], minor:["T","S","T","S","D","S","D"] };
const RANGES = { S:[60,81], A:[55,76], T:[48,69], B:[36,60] };
const ORDER = ["S","A","T","B"];

// parallel motion of any voice pair into the same perfect interval (fifth=7, octave=0)
function parallelBetween(v1, v2, iv) {
  for (let i=0;i<4;i++) for (let j=i+1;j<4;j++) {
    const i1=Math.abs(v1[i]-v1[j])%12, i2=Math.abs(v2[i]-v2[j])%12;
    const moved = v1[i]!==v2[i] && v1[j]!==v2[j];
    if (moved && i1===iv && i2===iv && Math.sign(v2[i]-v1[i])===Math.sign(v2[j]-v1[j])) return true;
  }
  return false;
}
function triadPCs(scale, d){ return [scale[d%7], scale[(d+2)%7], scale[(d+4)%7]]; }

// Independent whole-piece audit from raw pitches. Returns list of violated rule names.
function audit(piece, rules) {
  const R = Object.assign({noParallelFifths:true,noParallelOctaves:true,maxLeap:7,resolveLeadingTone:true,dominantBeforeTonic:true}, rules||{});
  const out = [];
  const n = piece.degrees.length/4;
  const scale = scaleNotes(piece.tonic, piece.mode);
  const tonicPC = scale[0], ltPC = scale[6];
  const func = FUNC[piece.mode];
  const V = piece.voicing, D = piece.degrees;
  // structure: AABA, A phrases identical
  for (let i=0;i<n;i++) {
    if (JSON.stringify(V[i])!==JSON.stringify(V[n+i]) || JSON.stringify(V[i])!==JSON.stringify(V[3*n+i])) out.push('A-repeat-mismatch@'+i);
  }
  if (JSON.stringify(V.slice(0,n))===JSON.stringify(V.slice(2*n,3*n))) out.push('B-identical-to-A');
  // cadences: A ends tonic, B ends dominant-function; penultimate dominant when rule on
  for (const a of [0,1,3]) {
    if (D[a*n+n-1]!==0) out.push('A'+a+'-not-tonic-end');
    if (R.dominantBeforeTonic && func[D[a*n+n-2]]!=="D") out.push('A'+a+'-no-penultimate-dominant');
  }
  if (func[D[2*n+n-1]]!=="D") out.push('B-not-dominant-end');
  // every adjacent pair including the three seams (n-1->n, 2n-1->2n, 3n-1->3n)
  for (let i=0;i<V.length-1;i++) {
    const atSeam = (i+1)%n===0;
    const tag = atSeam ? 'seam@'+i : 'within@'+i;
    if (R.noParallelFifths && parallelBetween(V[i],V[i+1],7)) out.push('P5-'+tag);
    if (R.noParallelOctaves && parallelBetween(V[i],V[i+1],0)) out.push('P8-'+tag);
    if (R.maxLeap) for (let v=0;v<3;v++) if (Math.abs(V[i+1][v]-V[i][v])>R.maxLeap) out.push('leap'+v+'-'+tag);
    // leading tone: soprano LT must resolve to tonic unless the next chord keeps the LT
    if (R.resolveLeadingTone) {
      const nextPCs = triadPCs(scale, D[i+1]);
      if (V[i][0]%12===ltPC && !nextPCs.includes(ltPC) && V[i+1][0]%12!==tonicPC) out.push('LT-'+tag);
    }
  }
  // ranges, root in bass, complete triads
  for (let i=0;i<V.length;i++) {
    for (let v=0;v<4;v++) {
      const [lo,hi] = RANGES[ORDER[v]];
      if (V[i][v]<lo || V[i][v]>hi) out.push('range'+ORDER[v]+'@'+i);
    }
    const pcs = triadPCs(scale, D[i]);
    if (V[i][3]%12!==pcs[0]) out.push('bass-not-root@'+i);
    const set = new Set(V[i].map(m=>m%12));
    for (const pc of pcs) if (!set.has(pc)) out.push('incomplete-triad@'+i);
  }
  return out;
}

// 1. determinism
{
  const a = CL.compose({seed:7}), b = CL.compose({seed:7});
  check('determinism: same seed+constraints = identical piece', JSON.stringify(a)===JSON.stringify(b));
}

// 2. default rules, 40-seed sweep with full independent audit
{
  let okCount = 0;
  for (let s=1;s<=40;s++) {
    const r = CL.compose({seed:s});
    if (!r.ok) { check('default seed '+s+' composes', false); continue; }
    okCount++;
    const v = audit(r);
    check('default seed '+s+' audit clean', v.length===0);
    if (v.length) console.log('  seed '+s+' violations: '+v.slice(0,5).join(', '));
  }
  console.log('default rules: '+okCount+'/40 seeds composed and audited');
}

// 3. each rule toggled off: success rate must not drop below default (relaxation
//    only widens the space), switched-on rules still verified from raw pitches,
//    and the seam summary must name only the switched-on rules.
for (const [label, rules, expectOff] of [
  ['fifths-off', {noParallelFifths:false}, 'fifths'],
  ['octaves-off', {noParallelOctaves:false}, 'octaves'],
  ['both-off', {noParallelFifths:false,noParallelOctaves:false}, 'fifths+octaves'],
]) {
  let okCount = 0;
  for (let s=1;s<=12;s++) {
    const r = CL.compose({seed:s, rules});
    if (!r.ok) continue;
    okCount++;
    const v = audit(r, rules);
    check(label+' seed '+s+' audit clean (switched-on rules hold)', v.length===0);
    if (v.length) console.log('  '+label+' seed '+s+' violations: '+v.slice(0,5).join(', '));
  }
  console.log(label+': '+okCount+'/12 composed');
  check(label+' composes on all 12 sampled seeds (sampled regression check: relaxation widens the feasible space; bounded search success is verified on these seeds, not proven for all seeds)', okCount>=12);
  const r = CL.compose({seed:7, rules});
  const sp = r.proof.find(p=>p.name.includes('seam'));
  if (expectOff==='fifths') check(label+' seam summary names octaves, not fifths', /octaves/.test(sp.detail) && !/fifths/.test(sp.detail));
  if (expectOff==='octaves') check(label+' seam summary names fifths, not octaves', /fifths/.test(sp.detail) && !/octaves/.test(sp.detail));
  if (expectOff==='fifths+octaves') check(label+' seam summary names neither', !/fifths/.test(sp.detail) && !/octaves/.test(sp.detail));
}

// 4. dominantBeforeTonic off: wording conditional, audit honors it
{
  const r = CL.compose({seed:7, rules:{dominantBeforeTonic:false}});
  check('dom-off composes', r.ok);
  if (r.ok) {
    const f = r.proof.find(p=>p.name==='AABA form');
    check('dom-off wording says switched off', /switched off/.test(f.detail));
    const v = audit(r, {dominantBeforeTonic:false});
    check('dom-off audit clean', v.length===0);
  }
}

// 5. extreme constraint honored: maxLeap=1 (upper voices nearly frozen) - if a piece
//    is returned, it must genuinely satisfy the tight limit, seams included.
{
  const r = CL.compose({seed:7, rules:{maxLeap:1}});
  check('maxLeap=1 composes or fails honestly', r.ok || (typeof r.error==='string' && r.error.length>0));
  if (r.ok) {
    const v = audit(r, {maxLeap:1});
    check('maxLeap=1 audit clean', v.length===0);
    if (v.length) console.log('  maxLeap=1 violations: '+v.slice(0,5).join(', '));
  }
}

console.log('\nRESULT: '+passed+' passed, '+failed+' failed');
process.exit(failed ? 1 : 0);
