// ConstraintLab audio: Web Audio playback + WAV export of a composed SATB piece.
"use strict";
let audioCtx=null;
function ensureCtx(){ if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)(); return audioCtx; }
function midiHz(m){ return 440*Math.pow(2,(m-69)/12); }

function voiceTimbre(idx){ // per-voice: [type, gain, filterHz]
  return [["triangle",0.30,3200],["triangle",0.24,2600],["sine",0.26,2200],["sine",0.34,1800]][idx];
}
function scheduleChord(ctx,out,chord,t,dur){
  chord.forEach((m,i)=>{
    const [type,g,freq]=voiceTimbre(i);
    const osc=ctx.createOscillator(); osc.type=type; osc.frequency.value=midiHz(m);
    const lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=freq;
    const gNode=ctx.createGain();
    const a=Math.min(0.08,dur*0.2), r=Math.min(0.15,dur*0.3);
    gNode.gain.setValueAtTime(0.0001,t);
    gNode.gain.linearRampToValueAtTime(g,t+a);
    gNode.gain.setValueAtTime(g,t+Math.max(a,dur-r));
    gNode.gain.linearRampToValueAtTime(0.0001,t+dur);
    osc.connect(lp); lp.connect(gNode); gNode.connect(out);
    osc.start(t); osc.stop(t+dur+0.05);
  });
}
// Play in real time. piece: compose() result. bpm, chordsPerBar=2.
function play(piece,bpm,onChord){
  const ctx=ensureCtx();
  const master=ctx.createGain(); master.gain.value=0.8; master.connect(ctx.destination);
  const chordDur=(60/bpm)*2; // 2 beats per chord
  const t0=ctx.currentTime+0.08;
  piece.voicing.forEach((chord,i)=>scheduleChord(ctx,master,chord,t0+i*chordDur,chordDur*0.96));
  let timers=[];
  if(onChord) piece.voicing.forEach((_,i)=>timers.push(setTimeout(()=>onChord(i),(i*chordDur+0.08)*1000)));
  return {stop(){ timers.forEach(clearTimeout); const c=ctx; audioCtx=null; c.close(); }, duration:piece.voicing.length*chordDur+0.2};
}
// WAV export via OfflineAudioContext (pattern verified in BeatBloom).
async function exportWav(piece,bpm){
  const chordDur=(60/bpm)*2;
  const seconds=piece.voicing.length*chordDur+0.4;
  const sr=44100;
  const off=new OfflineAudioContext(2,Math.ceil(seconds*sr),sr);
  const master=off.createGain(); master.gain.value=0.8; master.connect(off.destination);
  piece.voicing.forEach((chord,i)=>scheduleChord(off,master,chord,i*chordDur,chordDur*0.96));
  const rendered=await off.startRendering();
  return bufferToWav(rendered);
}
function bufferToWav(buffer){
  const numCh=2, sr=buffer.sampleRate, len=buffer.length*numCh*2+44;
  const buf=new ArrayBuffer(len), view=new DataView(buf);
  const wstr=(o,s)=>{for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i));};
  wstr(0,"RIFF"); view.setUint32(4,len-8,true); wstr(8,"WAVE"); wstr(12,"fmt ");
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,numCh,true);
  view.setUint32(24,sr,true); view.setUint32(28,sr*numCh*2,true); view.setUint16(32,numCh*2,true); view.setUint16(34,16,true);
  wstr(36,"data"); view.setUint32(40,len-44,true);
  const L=buffer.getChannelData(0), R=buffer.numberOfChannels>1?buffer.getChannelData(1):L;
  let o=44;
  for(let i=0;i<buffer.length;i++){
    let l=Math.max(-1,Math.min(1,L[i])), r=Math.max(-1,Math.min(1,R[i]));
    view.setInt16(o,l<0?l*0x8000:l*0x7FFF,true); o+=2;
    view.setInt16(o,r<0?r*0x8000:r*0x7FFF,true); o+=2;
  }
  return new Blob([buf],{type:"audio/wav"});
}
if(typeof window!=="undefined") window.ConstraintAudio={play,exportWav};
