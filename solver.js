// ConstraintLab solver core: declarative music constraint solver.
// Input: constraints (key, mode, voices, rules). Output: progression + SATB voicing + proof log.
// Deterministic: same seed + same constraints => same piece.
"use strict";

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}

const NOTE_NAMES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const SCALES={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,11]}; // minor = harmonic minor (raised 7th): true leading tone, major V, dim vii
// Roman numeral degree -> {offset from tonic (scale degree 0-6), quality}
const TRIADS={
  major:[{r:"I",m:0},{r:"ii",m:1},{r:"iii",m:1},{r:"IV",m:0},{r:"V",m:0},{r:"vi",m:1},{r:"vii°",m:2}],
  minor:[{r:"i",m:1},{r:"ii°",m:2},{r:"III",m:0},{r:"iv",m:1},{r:"V",m:0},{r:"VI",m:0},{r:"vii°",m:2}]
};
const FUNC={major:["T","S","T","S","D","T","D"],minor:["T","S","T","S","D","S","D"]}; // T/S/D function per degree

function scaleNotes(tonic,mode){const pc=NOTE_NAMES.indexOf(tonic);return SCALES[mode].map(s=>(pc+s)%12);}
// Build triad pitch classes for scale degree d (0-6): root, third, fifth from scale
function triadPCs(scale,d){return [scale[d%7],scale[(d+2)%7],scale[(d+4)%7]];}

const RANGES={S:[60,81],A:[55,76],T:[48,69],B:[36,60]}; // MIDI ranges (inclusive)
const ORDER=["S","A","T","B"];

function solve(opts){
  const {tonic="A",mode="minor",chordsPerPhrase=8,seed=1,rules={},cadence="authentic"}=opts||{};
  const R=Object.assign({noParallelFifths:true,noParallelOctaves:true,noVoiceCrossing:true,maxLeap:7,resolveLeadingTone:true,endOnTonic:true,dominantBeforeTonic:true,noChordRepeat3:true},rules);
  const rand=mulberry32(seed);
  const scale=scaleNotes(tonic,mode);
  const leadingTonePC=scale[6];
  const tonicPC=scale[0];
  const proof=[];
  const log=(stage,name,pass,detail)=>proof.push({stage,name,pass:!!pass,detail:detail||""});

  // ---- Stage 1: chord progression search (backtracking over chord slots) ----
  const n=chordsPerPhrase;
  const degrees=[0,1,2,3,4,5,6];
  const func=FUNC[mode];
  const domDegrees=degrees.filter(d=>func[d]==="D");

  function progressionOk(seq,idx){
    // local constraints check when assigning seq[idx]
    const d=seq[idx];
    if(idx===0&&d!==0) return false;                       // starts on tonic
    if(cadence==="authentic"&&idx===n-1&&d!==0) return false;          // ends on tonic
    if(cadence==="half"&&idx===n-1&&func[d]!=="D") return false;       // ends on dominant
    if(R.dominantBeforeTonic&&cadence==="authentic"&&idx===n-2&&func[d]!=="D") return false; // penultimate dominant function
    if(R.noChordRepeat3&&idx>=2&&seq[idx-1]===d&&seq[idx-2]===d) return false;
    if(idx>=2&&func[seq[idx-1]]===func[d]&&func[seq[idx-2]]===func[d]&&func[d]!=="T") return false; // max 2 same non-tonic function
    if(idx>=1&&func[seq[idx-1]]==="D"&&func[d]==="S") return false;  // no dominant->subdominant regression
    return true;
  }
  const progressions=[];const MAX_PROG=40;
  function btProg(idx,seq){
    if(progressions.length>=MAX_PROG) return true;
    if(idx===n){progressions.push(seq.slice());return progressions.length>=MAX_PROG;}
    const cand=degrees.slice();
    // deterministic shuffled order from seed
    for(let i=cand.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));const t=cand[i];cand[i]=cand[j];cand[j]=t;}
    for(const d of cand){
      seq[idx]=d;
      if(progressionOk(seq,idx)&&btProg(idx+1,seq)) return true;
    }
    seq[idx]=undefined;
    return false;
  }
  btProg(0,[]);
  if(!progressions.length) return {ok:false,error:"no progression satisfies constraints",proof};
  let progression=progressions[0];
  log("progression","starts on tonic",progression[0]===0,TRIADS[mode][progression[0]].r);
  if(cadence==="authentic"){
    log("progression","ends on tonic",progression[n-1]===0,TRIADS[mode][progression[n-1]].r);
    if(R.dominantBeforeTonic) log("progression","dominant-function chord (V or vii\u00b0) before final tonic",func[progression[n-2]]==="D",TRIADS[mode][progression[n-2]].r+" -> "+TRIADS[mode][progression[n-1]].r);
    else proof.push({stage:"progression",name:"dominant-function chord (V or vii\u00b0) before final tonic",pass:true,off:true,detail:"switched off - not enforced"});
  }else{
    log("progression","ends on a dominant-function chord (V or vii\u00b0)",func[progression[n-1]]==="D",TRIADS[mode][progression[n-1]].r);
  }
  log("progression","no 3x chord repeat",true,"checked during search");

  // ---- Stage 2: SATB voice leading (backtracking per chord, min-movement tie-break) ----
  // Candidate voicings for a chord: choose 4 MIDI notes (one per voice, chord tones, ranges, S>=A>=T>=B)
  function voicingsFor(d){
    const pcs=triadPCs(scale,d);
    const out=[];
    // enumerate: B from low, double the root usually (4 voices, 3 pcs -> double one)
    const opts=ORDER.map(v=>{const [lo,hi]=RANGES[v];const arr=[];for(let m=lo;m<=hi;m++){if(pcs.includes(m%12))arr.push(m);}return arr;});
    for(const s of opts[0])for(const a of opts[1])for(const t of opts[2])for(const b of opts[3]){
      if(!(s>=a&&a>=t&&t>=b)) continue;
      if(R.noVoiceCrossing&&!(s>=a&&a>=t&&t>=b)) continue;
      if(s-a>12||a-t>12) continue; // spacing: max octave between upper voices
      const set=new Set([s%12,a%12,t%12,b%12]);
      if(set.size<3) continue; // must contain full triad
      if(b%12!==pcs[0]) continue; // root in bass (root position only, v1)
      out.push([s,a,t,b]);
      if(out.length>=4000) return out; // cap enumeration
    }
    return out;
  }
  function interval(a,b){return Math.abs(a-b)%12;}
  function parallels(v1,v2,iv){
    // v1,v2: two voices' notes in chord1 and chord2 (arrays aligned per voice)
    for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
      const i1=Math.abs(v1[i]-v1[j])%12, i2=Math.abs(v2[i]-v2[j])%12;
      const moved=(v1[i]!==v2[i])&&(v1[j]!==v2[j]);
      if(moved&&i1===iv&&i2===iv&&Math.sign(v2[i]-v1[i])===Math.sign(v2[j]-v1[j])) return true; // parallel (similar motion into same perfect interval)
    }
    return false;
  }
  let voicing=null;const voicingChecks={parallel5:0,parallel8:0,leap:0,lt:0};
  const sopTarget=opts.sopranoTarget||null;
  let btVoice=function(ci,prev,chosen){
    if(ci===n){voicing=chosen.slice();return true;}
    const d=progression[ci];
    let cands=voicingsFor(d);
    {
      // deterministic ordering: soprano-contour match first, then min movement
      cands=cands.map(c=>{
        let cost=c.reduce((s,note,i)=>s+(prev?Math.abs(note-prev[i]):0),0);
        if(sopTarget&&sopTarget[ci]!=null) cost+=3*Math.abs(c[0]-sopTarget[ci]); // weight contour
        else if(!prev) cost+=2*Math.abs(c[0]-67); // opening: start soprano near G4
        return {c,cost};
      }).sort((x,y)=>x.cost-y.cost||x.c.join(",").localeCompare(y.c.join(","))).map(o=>o.c);
    }
    for(const c of cands){
      if(prev){
        if(R.maxLeap){let bad=false;for(let i=0;i<3;i++){if(Math.abs(c[i]-prev[i])>R.maxLeap){bad=true;voicingChecks.leap++;break;}}if(bad)continue;}
        if(R.noParallelFifths&&parallels(prev,c,7)){voicingChecks.parallel5++;continue;}
        if(R.noParallelOctaves&&parallels(prev,c,0)){voicingChecks.parallel8++;continue;}
        if(R.resolveLeadingTone){ // soprano LT must resolve up to tonic unless next chord keeps LT
          const nextPCs=triadPCs(scale,progression[ci]);
          if(prev[0]%12===leadingTonePC&&!nextPCs.includes(leadingTonePC)&&c[0]%12!==tonicPC){voicingChecks.lt++;continue;}
        }
      }
      chosen[ci]=c;
      if(btVoice(ci+1,c,chosen))return true;
    }
    chosen[ci]=undefined;
    return false;
  }
  for(const prog of progressions){
    progression=prog;
    voicing=null;
    if(btVoice(0,null,[])) break;
  }
  if(!voicing) return {ok:false,error:"no voicing satisfies rules for any candidate progression",progression,proof,voicingChecks};
  const off=(stage,name)=>proof.push({stage,name,pass:true,off:true,detail:"switched off - not enforced"});
  if(R.noParallelFifths) log("voice-leading","no parallel fifths",true,voicingChecks.parallel5+" candidates rejected"); else off("voice-leading","no parallel fifths");
  if(R.noParallelOctaves) log("voice-leading","no parallel octaves",true,voicingChecks.parallel8+" candidates rejected"); else off("voice-leading","no parallel octaves");
  if(R.maxLeap) log("voice-leading","max leap <= "+R.maxLeap+" semitones (upper voices)",true,voicingChecks.leap+" candidates rejected"); else off("voice-leading","max upper-voice leap");
  if(R.resolveLeadingTone) log("voice-leading","leading tone resolves to tonic (soprano)",true,voicingChecks.lt+" candidates rejected"); else off("voice-leading","leading tone resolves to tonic (soprano)");
  log("voice-leading","all voices in range",voicing.every(v=>v.every((m,i)=>m>=RANGES[ORDER[i]][0]&&m<=RANGES[ORDER[i]][1])),"S"+RANGES.S+" A"+RANGES.A+" T"+RANGES.T+" B"+RANGES.B);
  log("voice-leading","root in bass, complete triads",true,"checked during enumeration");

  return {ok:true,tonic,mode,seed,rules:R,progression:progression.map(d=>TRIADS[mode][d].r),degrees:progression,voicing,proof};
}

function archTarget(n,lo,hi){ // arch contour: rise to climax ~60-70% through, fall to start
  const out=[];const peak=Math.floor(n*0.62);
  for(let i=0;i<n;i++){const t=i<=peak? i/peak : 1-(i-peak)/(n-1-peak);out.push(Math.round(lo+(hi-lo)*t));}
  return out;
}
function seamViolations(v1,v2,maxLeap){
  const out=[];
  for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
    const i1=Math.abs(v1[i]-v1[j])%12,i2=Math.abs(v2[i]-v2[j])%12;
    if(v1[i]!==v2[i]&&v1[j]!==v2[j]&&i1===7&&i2===7&&Math.sign(v2[i]-v1[i])===Math.sign(v2[j]-v1[j])) out.push("parallel fifth "+i+"/"+j);
    if(v1[i]!==v2[i]&&v1[j]!==v2[j]&&i1===0&&i2===0&&Math.sign(v2[i]-v1[i])===Math.sign(v2[j]-v1[j])) out.push("parallel octave "+i+"/"+j);
  }
  for(let i=0;i<3;i++) if(Math.abs(v2[i]-v1[i])>maxLeap) out.push("upper leap "+i);
  return out;
}
function compose(opts){
  const o=opts||{};const seed=o.seed||1;const n=o.chordsPerPhrase||8;
  const mk=(sd,cad,lo,hi)=>solve({tonic:o.tonic,mode:o.mode,chordsPerPhrase:n,seed:sd,rules:o.rules,cadence:cad,sopranoTarget:archTarget(n,lo,hi)});
  const R=Object.assign({noParallelFifths:true,noParallelOctaves:true,noVoiceCrossing:true,maxLeap:7,resolveLeadingTone:true,endOnTonic:true,dominantBeforeTonic:true,noChordRepeat3:true},o.rules||{});
  const maxLeap=R.maxLeap;
  const tonicPC=scaleNotes(o.tonic||"A",o.mode||"minor")[0];
  const ltPC=(tonicPC+11)%12;
  // seam check honoring the SAME toggles as the within-phrase rules
  function seamCheck(v1,v2){
    const out=[];
    if(R.noParallelFifths||R.noParallelOctaves){
      for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
        const i1=Math.abs(v1[i]-v1[j])%12,i2=Math.abs(v2[i]-v2[j])%12;
        const moved=v1[i]!==v2[i]&&v1[j]!==v2[j];
        if(moved&&i1===i2&&Math.sign(v2[i]-v1[i])===Math.sign(v2[j]-v1[j])){
          if(R.noParallelFifths&&i1===7) out.push("parallel fifth "+i+"/"+j);
          if(R.noParallelOctaves&&i1===0) out.push("parallel octave "+i+"/"+j);
        }
      }
    }
    if(R.maxLeap) for(let i=0;i<3;i++) if(Math.abs(v2[i]-v1[i])>R.maxLeap) out.push("upper leap "+i);
    return out;
  }
  let A=null,B=null,bSeed=null;
  for(let a=0;a<6&&!B;a++){
    const candA=mk(seed+a*1000,"authentic",64,72);
    if(!candA.ok) continue;
    if(seamCheck(candA.voicing[n-1],candA.voicing[0]).length) continue; // A->A repeat seam must obey the switched-on rules
    for(let k=0;k<80;k++){
      const cand=mk(seed+1+a*1000+k*100,"half",65,74);
      if(!cand.ok) continue;
      const viol=[...seamCheck(candA.voicing[n-1],cand.voicing[0]),...seamCheck(cand.voicing[n-1],candA.voicing[0])];
      if(R.resolveLeadingTone&&cand.voicing[n-1][0]%12===ltPC&&candA.voicing[0][0]%12!==tonicPC) viol.push("soprano LT unresolved at B->A seam");
      if(!viol.length){A=candA;B=cand;bSeed=seed+1+a*1000+k*100;break;}
    }
  }
  if(!A) return {ok:false,error:"A phrase failed for all candidate seeds"};
  if(!B) return {ok:false,error:"no (A,B) phrase pair satisfies seam constraints (leaps/parallels/LT) in candidate space",A};
  const piece={ok:true,seed,bSeed,structure:"AABA",phrases:["A","A","B","A"],
    degrees:[...A.degrees,...A.degrees,...B.degrees,...A.degrees],
    progression:[...A.progression,...A.progression,...B.progression,...A.progression],
    voicing:[...A.voicing,...A.voicing,...B.voicing,...A.voicing],
    cadences:{A:"tonic-end",B:"dominant-function-end"},
    proof:[{stage:"structure",name:"AABA form",pass:true,detail:(!o.rules||o.rules.dominantBeforeTonic!==false)?"A phrases end on tonic, each preceded by a dominant-function chord (V or vii deg); B ends on a dominant-function chord (V or vii deg); 4x8 chords = 16 bars at 2 chords/bar":"A phrases end on tonic; B ends on a dominant-function chord (V or vii deg); 4x8 chords = 16 bars at 2 chords/bar (penultimate dominant-function rule switched off)"},{stage:"structure",name:"phrase seams obey the voice-leading rules",pass:true,detail:(()=>{const b=[];const w=[];if(R.noParallelFifths)w.push("fifths");if(R.noParallelOctaves)w.push("octaves");if(w.length)b.push("no parallel "+w.join("/"));if(R.maxLeap)b.push("upper-voice leap limit");let d=b.length?b.join(" and ")+" enforced across the A-A, A-B and B-A seams":"no seam rules switched on";if(R.resolveLeadingTone)d+=(b.length?"; ":"")+"soprano leading tone must resolve across the B-A seam";return d;})()},...A.proof.map(p=>Object.assign({phrase:"A"},p)),...B.proof.map(p=>Object.assign({phrase:"B"},p))]};
  return piece;
}
if(typeof module!=="undefined") module.exports={solve,compose,scaleNotes,triadPCs,archTarget,seamViolations};
if(typeof window!=="undefined") window.ConstraintLab={solve,compose,scaleNotes,triadPCs,archTarget,seamViolations};
