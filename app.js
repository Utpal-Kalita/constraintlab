// ConstraintLab UI: constraint inputs -> compose() -> piano roll + proof panel + playback.
"use strict";
const $=id=>document.getElementById(id);
let current=null, playing=null;

const ROMAN_NUMERAL_NAMES={};
function readRules(){
  return {
    noParallelFifths:$("r-par5").checked,
    noParallelOctaves:$("r-par8").checked,
    noVoiceCrossing:$("r-cross").checked,
    resolveLeadingTone:$("r-lt").checked,
    endOnTonic:$("r-tonic").checked,
    dominantBeforeTonic:$("r-tonic").checked,
    maxLeap:parseInt($("r-leap").value,10)
  };
}
function readState(){
  return {key:$("key").value, mode:$("mode").value, seed:Math.max(1,parseInt($("seed").value,10)||1),
          tempo:Math.min(160,Math.max(40,parseInt($("tempo").value,10)||72)), rules:readRules()};
}
function applyState(s){
  $("key").value=s.key; $("mode").value=s.mode; $("seed").value=s.seed; $("tempo").value=s.tempo;
  $("r-par5").checked=!!s.rules.noParallelFifths; $("r-par8").checked=!!s.rules.noParallelOctaves;
  $("r-cross").checked=!!s.rules.noVoiceCrossing; $("r-lt").checked=!!s.rules.resolveLeadingTone;
  $("r-tonic").checked=!!s.rules.endOnTonic; $("r-leap").value=String(s.rules.maxLeap||7);
}
function encodeState(s){ return btoa(JSON.stringify(s)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function decodeState(str){ try{ return JSON.parse(atob(str.replace(/-/g,"+").replace(/_/g,"/"))); }catch(e){ return null; } }

// NOTE_NAMES comes from solver.js (loaded first)
function noteName(m){ return NOTE_NAMES[m%12]+(Math.floor(m/12)-1); }

function drawRoll(piece,playhead){
  const cv=$("roll"),ctx=cv.getContext("2d");
  const W=cv.width,H=cv.height;
  ctx.fillStyle="#0e1420";ctx.fillRect(0,0,W,H);
  const all=piece.voicing.flat();
  const lo=Math.min(...all)-2, hi=Math.max(...all)+2;
  const cols=piece.voicing.length;
  const cw=W/cols;
  const yOf=m=>H-((m-lo)/(hi-lo))*(H-20)-10;
  // grid: bar lines every 2 chords, phrase lines every 8
  ctx.strokeStyle="#223048";
  for(let i=0;i<=cols;i++){ctx.beginPath();ctx.moveTo(i*cw,0);ctx.lineTo(i*cw,H);ctx.lineWidth=i%8===0?2:(i%2===0?1:0.4);ctx.stroke();}
  const colors=["#ffd166","#06d6a0","#8ecae6","#e07a5f"]; // S A T B
  const names=["S","A","T","B"];
  piece.voicing.forEach((chord,ci)=>{
    chord.forEach((m,v)=>{
      ctx.fillStyle=colors[v];
      const h=6;
      ctx.globalAlpha=playhead===ci?1:0.85;
      ctx.fillRect(ci*cw+2,yOf(m)-h/2,cw-4,h);
      ctx.globalAlpha=1;
    });
  });
  // roman numerals
  ctx.fillStyle="#cbd5e1";ctx.font="11px system-ui";ctx.textAlign="center";
  piece.progression.forEach((r,i)=>ctx.fillText(r,i*cw+cw/2,H-4));
  if(playhead!=null){ctx.fillStyle="rgba(255,255,255,0.12)";ctx.fillRect(playhead*cw,0,cw,H);}
  // legend
  ctx.textAlign="left";ctx.font="10px system-ui";
  names.forEach((n,i)=>{ctx.fillStyle=colors[i];ctx.fillText(n,8+i*22,12);});
}
function drawStructure(piece){
  const el=$("structure");el.innerHTML="";
  const labels=["A","A","B","A"];
  labels.forEach((lab,pi)=>{
    const span=document.createElement("span");
    span.className="phrase phrase-"+lab;
    const rom=piece.progression.slice(pi*8,pi*8+8).join(" - ");
    span.textContent=lab+": "+rom;
    el.appendChild(span);
  });
  const cad=document.createElement("p");
  cad.className="hint";
  cad.textContent="Cadences: the A phrases end on the tonic (authentic cadence); the B phrase ends on a dominant-function chord (V or vii deg), which leads back to A.";
  el.appendChild(cad);
}
function renderProof(piece){
  const ul=$("proof-list");ul.innerHTML="";
  piece.proof.forEach(p=>{
    const li=document.createElement("li");
    li.className=p.off?"off":(p.pass?"pass":"fail");
    const where=p.phrase?("phrase "+p.phrase+" - "):"";
    li.textContent=(p.off?"OFF  ":(p.pass?"PASS  ":"FAIL  "))+where+p.stage+" / "+p.name+(p.detail?"  ("+p.detail+")":"");
    ul.appendChild(li);
  });
}
function showFailure(msg){
  $("result-panel").hidden=false; $("proof-panel").hidden=true;
  $("piece-view").hidden=true;
  const f=$("failure");f.hidden=false;
  f.textContent="No piece satisfies those constraints. The solver searched and honestly found nothing - loosen a rule (for example allow an octave leap) or change the seed. Detail: "+msg;
}
function composeNow(){
  stopPlayback();
  const s=readState();
  const piece=window.ConstraintLab.compose({tonic:s.key,mode:s.mode,seed:s.seed,rules:s.rules});
  if(!piece.ok){ showFailure(piece.error||"unsatisfiable"); return; }
  current={piece,state:s};
  $("failure").hidden=true; $("result-panel").hidden=false; $("proof-panel").hidden=false; $("piece-view").hidden=false;
  drawStructure(piece); drawRoll(piece,null); renderProof(piece);
  $("play").textContent="Play";
}
function stopPlayback(){ if(playing){playing.stop();playing=null;$("play").textContent="Play";drawRoll(current?current.piece:null,null);} }
function boot(){
  const hash=location.hash.slice(1);
  if(hash){const s=decodeState(hash);if(s)applyState(s);}
  $("compose").addEventListener("click",composeNow);
  $("randomize").addEventListener("click",()=>{$("seed").value=1+Math.floor(Math.random()*99998);composeNow();});
  $("share").addEventListener("click",()=>{
    const url=location.origin+location.pathname+"#"+encodeState(readState());
    (navigator.clipboard?navigator.clipboard.writeText(url):Promise.reject()).catch(()=>{prompt("Copy this link:",url);});
    $("share").textContent="Link copied";setTimeout(()=>$("share").textContent="Copy share link",1500);
  });
  $("play").addEventListener("click",()=>{
    if(playing){stopPlayback();return;}
    if(!current)return;
    $("play").textContent="Stop";
    playing=window.ConstraintAudio.play(current.piece,current.state.tempo,(ci)=>drawRoll(current.piece,ci));
    setTimeout(()=>{if(playing){stopPlayback();}},(current.piece.voicing.length*2*(60/current.state.tempo)+0.5)*1000);
  });
  $("export").addEventListener("click",async ()=>{
    if(!current)return;
    $("export").textContent="Rendering...";$("export").disabled=true;
    try{
      const blob=await window.ConstraintAudio.exportWav(current.piece,current.state.tempo);
      const a=document.createElement("a");
      a.href=URL.createObjectURL(blob);
      a.download="constraintlab-"+current.state.key+current.state.mode+"-seed"+current.state.seed+".wav";
      a.click();URL.revokeObjectURL(a.href);
    }finally{$("export").textContent="Export WAV";$("export").disabled=false;}
  });
  // auto-compose if arriving from a share link
  if(hash&&decodeState(hash)) composeNow();
}
document.addEventListener("DOMContentLoaded",boot);
