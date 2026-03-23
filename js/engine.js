// G1on Editor · Motor MIDI/Zoom (codec, protocolo) v4

// ── CODEC ZOOM 7-IN-8 ─────────────────────────────────────────────────
function zoomUnpack(pl){
  const out=[];
  for(let i=0;i<pl.length;i+=8){
    const msb=pl[i];
    out.push(msb&0x7F);
    for(let j=1;j<8&&i+j<pl.length;j++)
      out.push(pl[i+j]|(((msb>>(j-1))&1)<<7));
  }
  return out;
}

function zoomPack(u){
  const out=new Array(u.length).fill(0);
  for(let g=0;g<u.length;g+=8){
    let msb=u[g]&0x7F;
    for(let j=1;j<8&&g+j<u.length;j++){
      msb|=((u[g+j]>>7)&1)<<(j-1);
      out[g+j]=u[g+j]&0x7F;
    }
    out[g]=msb;
  }
  return out;
}

// ── DECODE DE PATCH ───────────────────────────────────────────────────
// Stride=23: cada slot de efeito ocupa 23 bytes no array unpacked
// [0]=b0  [1]=b1(bit7=enable,bits6-0=b1m)  [2]=b2  [3]=b3  [4]=b4  [5]=b5
// [6..22]=parâmetros (17 bytes)
// Nome: bytes [115..124]
function decodePatch(pl,slot){
  const u=zoomUnpack(pl);
  const fx=[];
  for(let i=0;i<5;i++){
    const s=i*23;
    const b0=u[s],b1=u[s+1],b3=u[s+3],b4=u[s+4],b5=u[s+5];
    const b1m=b1&0x7F;
    const en=(b1&0x80)!==0;
    const isEmpty=(b0===0&&b3===0)||(b0===1&&b1m===0&&b3===0);
    const params=Array.from(u.slice(s,s+23));
    const info=isEmpty?{n:'Empty',c:null}:gfx(b0,b1,b3,b4,b5);
    fx.push({b0,b1,b1m,b3,b4,b5,isEmpty,en,params,name:info.n,cat:info.c});
  }
  const nameBytes=u.slice(115,125);
  const name=String.fromCharCode(...nameBytes.map(b=>b&0x7F).filter(b=>b!==0)).trimEnd();
  return{slot,name,effects:fx,raw:Array.from(pl)};
}

// ── ENCODE DE PATCH ───────────────────────────────────────────────────
function encodePatch(p){
  if(!p.raw||p.raw.length<110) return null;
  const raw=p.raw.slice();
  const u=zoomUnpack(raw);

  const nm=(p.name||'').padEnd(10,' ').slice(0,10);
  for(let i=0;i<4;i++) u[115+i]=nm.charCodeAt(i)&0x7F;
  u[119]=0x00;
  for(let i=4;i<9;i++) u[115+i+1]=nm.charCodeAt(i)&0x7F;
  u[125]=0x20;

  for(let s=0;s<5;s++){
    const fx=p.effects[s];
    if(!fx||fx.isEmpty) continue;
    const ui=s*23+1;
    const g=Math.floor(ui/8), bit=(ui%8)-1, mPos=g*8;
    if(fx.en) u[mPos]|=(1<<bit);
    else       u[mPos]&=~(1<<bit);
  }

  for(let s=0;s<5;s++){
    const fx=p.effects[s];
    if(!fx||fx.isEmpty) continue;
    const db=fxInfo(fx.name);
    if(!db) continue;
    db.params.forEach((pm,pi)=>{
      if(fx.paramValues&&fx.paramValues[pi]!==undefined){
        const v=fx.paramValues[pi]&0x7F;
        const ui=s*23+6+pi;
        const g=Math.floor(ui/8), pos=ui%8, mPos=g*8;
        if(pos===0) u[mPos]=(u[mPos]&0x80)|(v&0x7F);
        else        u[mPos+pos]=(u[mPos+pos]&0x80)|(v&0x7F);
      }
    });
  }

  return zoomPack(u);
}

function readParamValues(fx){
  const db=fxInfo(fx.name);
  if(!db) return [];
  return db.params.map((_,i)=>{
    const raw=fx.params[6+i];
    return raw!==undefined?(raw&0x7F):0;
  });
}

function rawToDisplay(raw,pm){
  const mx=pm.max!==undefined?pm.max:127;
  const mn=pm.min!==undefined?pm.min:0;
  if(mn>=0 && mx<=127) return Math.min(mx,Math.max(mn,raw));
  return Math.round(raw/127*(mx-mn))+mn;
}

function displayToRaw(v,pm){
  const mx=pm.max!==undefined?pm.max:127;
  const mn=pm.min!==undefined?pm.min:0;
  if(mn>=0 && mx<=127) return Math.min(127,Math.max(0,v));
  return Math.min(127,Math.max(0,Math.round((v-mn)/(mx-mn)*127)));
}

// ── SYSEX HELPERS ─────────────────────────────────────────────────────
function sx(did,pl){return new Uint8Array([0xF0,ZOOM_MFR,0x00,did,...pl,0xF7]);}
function idReq(){return new Uint8Array([0xF0,0x7E,0x00,0x06,0x01,0xF7]);}
function pc(s){return new Uint8Array([0xC0,s&0x7F]);}

function parseId(d){
  if(d.length<11||d[0]!==0xF0||d[1]!==0x7E||d[3]!==0x06||d[4]!==0x02)return null;
  if(d[5]!==ZOOM_MFR)return null;
  return{id:d[6],fw:String.fromCharCode(d[9],d[10],d[11],d[12])};
}

function parsePatch(data,devId){
  const d=Array.from(data);
  if(d[4]!==0x28)return null;
  const pl=d.slice(6,-1);
  if(pl.length<110)return null;
  return decodePatch(pl,d[5]);
}

// ── MIDI STATE ────────────────────────────────────────────────────────
let acc=null,mIn=null,mOut=null,dev=null,pend=null;
let _tunerActive=false;
const evs={};
function on(e,f){(evs[e]=evs[e]||[]).push(f);}
function em(e,d){(evs[e]||[]).forEach(f=>f(d));}

function mkWait(ms=3000){
  return new Promise((res,rej)=>{
    if(pend){pend.rej(new Error('superseded'));}
    const t=setTimeout(()=>{pend=null;rej(new Error('Timeout: pedal não respondeu'));},ms);
    pend={res,rej,t};
  });
}

function onMidiMsg(e){
  const d=new Uint8Array(e.data);
  L.midiRx('←RX', hex(d));

  // Tuner: F0 52 00 [devid] 57 [note] [cents] F7
  if(d.length>=8&&d[0]===0xF0&&d[1]===ZOOM_MFR&&d[4]===0x57){
    const note=d[5]&0x0F;
    const cents=d[6]-64; // -64..+63, centro=0
    em('tuner',{note,cents});
    return; // não resolve pend — é stream contínuo
  }

  // Tempo reply: F0 52 00 [devid] 62 [lo] [hi] F7
  if(d.length>=8&&d[0]===0xF0&&d[1]===ZOOM_MFR&&d[4]===0x62){
    const bpm=(d[5]&0x7F)|((d[6]&0x7F)<<7);
    em('tempo',{bpm});
    // também resolve pend se houver (requestTempo)
    if(pend){clearTimeout(pend.t);pend.res(d);pend=null;}
    return;
  }

  // Resolver await pendente para qualquer outra mensagem
  if(pend){clearTimeout(pend.t);pend.res(d);pend=null;}

  // Patch update (push do pedal)
  if(d[0]===0xF0&&d[1]===ZOOM_MFR&&d[4]===0x28){
    const p=parsePatch(d,dev?.id);if(p)em('pu',p);
  }
}

async function connect(){
  L.op('Iniciando conexão MIDI...', 'Solicitando requestMIDIAccess({sysex:true})');
  if(!navigator.requestMIDIAccess)throw new Error('Web MIDI não suportado. Use Chrome ou Edge.');
  try{acc=await navigator.requestMIDIAccess({sysex:true});}
  catch{throw new Error('Acesso MIDI negado. Permita quando solicitado.');}
  const ins=[...acc.inputs.values()],outs=[...acc.outputs.values()];
  if(!ins.length||!outs.length)throw new Error('Nenhuma porta MIDI encontrada. Conecte o pedal via USB.');
  st('escaneando...','s-info');
  const f=await probe(ins,outs);
  if(!f)throw new Error('Nenhum dispositivo Zoom encontrado. Conecte via USB, ligue o pedal.');
  mIn=f.i;mOut=f.o;mIn.onmidimessage=onMidiMsg;
  const id=f.id;
  const d=DEVS[id.id]||{key:'unknown',name:`Zoom 0x${id.id.toString(16).toUpperCase()}`,fxSlots:5,presets:50,protocol:'unknown'};
  dev={...d,id:id.id,fw:id.fw};
  L.ok(`Dispositivo identificado: ${dev.name}`, `ID=0x${id.id.toString(16).toUpperCase()} FW=${id.fw} protocol=${dev.protocol||'1on'} presets=${dev.presets}`);
  if(dev._zxnWarning) L.warn(`Protocolo ZxN detectado em ${dev.name}`, 'READ/WRITE direto não suportado nesta versão. Use backup/restauração.');
  if(dev.protocol==='zxn') dev._zxnWarning=true;
  acc.onstatechange=e=>{
    if((e.port===mIn||e.port===mOut)&&e.port.state==='disconnected')disconnect();
  };
  return dev;
}

async function probe(ins,outs){
  for(const o of outs){const r=await probeOut(o,ins);if(r)return r;}
  return null;
}

async function probeOut(o,ins){
  return new Promise(res=>{
    const orig=ins.map(i=>i.onmidimessage);
    const done=r=>{ins.forEach((i,x)=>{i.onmidimessage=orig[x];});clearTimeout(t);res(r);};
    const t=setTimeout(()=>done(null),1200);
    ins.forEach(i=>{
      i.onmidimessage=e=>{
        const d=new Uint8Array(e.data);
        L.midiRx('←RX', hex(d));
        if(d.length>=6&&d[0]===0xF0&&d[1]===0x7E&&d[3]===0x06&&d[4]===0x02&&d[5]===ZOOM_MFR)
          done({i,o,id:parseId(d)});
      };
    });
    try{const m=idReq();L.midiTx('→TX', hex(m));o.send(m);}
    catch{done(null);}
  });
}

function disconnect(){
  L.info('Dispositivo desconectado', dev ? dev.name : '(desconhecido)');
  if(_tunerActive){_tunerActive=false;} // tuner off ao desconectar
  if(mIn)mIn.onmidimessage=null;
  mIn=mOut=dev=null;
  em('dc');
}

function sendRaw(msg){
  if(!mOut)return;
  L.midiTx('→TX', hex(msg));
  mOut.send(msg);
}

function sendAwait(msg,ms=2000){
  const p=mkWait(ms);
  sendRaw(msg);
  return p;
}

// ── PROTOCOL HELPERS ─────────────────────────────────────────────────
// ParameterEditEnable (0x50): entra no modo de edição
// ParameterEditDisable (0x51): OBRIGATÓRIO após read/write — libera o pedal
function paramEditEnable()  { sendRaw(sx(dev.id,[0x50])); }
function paramEditDisable() { sendRaw(sx(dev.id,[0x51])); }

function isCommitAck(d){
  return d.length>=6&&d[0]===0xF0&&d[1]===ZOOM_MFR&&d[4]===0x28;
}

// ── READ PATCH ────────────────────────────────────────────────────────
// 1. PC → 2. EditEnable(0x50) → 3. RequestPatch(0x29) → 4. ← BulkDump(0x28) → 5. EditDisable(0x51)
async function readPatch(slot){
  L.op(`Lendo patch slot ${slot+1}...`, `PC(${slot}) → EditEnable(0x50) → RequestPatch(0x29)`);
  sendRaw(pc(slot));
  await sleep(60);
  paramEditEnable();
  L.midiTx('→TX EditEnable(0x50)', hex(sx(dev.id,[0x50])));
  await sleep(80);
  let resp;
  try {
    resp = await sendAwait(sx(dev.id,[0x29]),2000);
  } catch(e) {
    L.error(`readPatch slot ${slot+1} falhou`, e.message);
    paramEditDisable();
    throw e;
  }
  await sleep(40);
  paramEditDisable();
  L.midiTx('→TX EditDisable(0x51)', hex(sx(dev.id,[0x51])));
  await sleep(40);
  return resp;
}

// ── WRITE PATCH ───────────────────────────────────────────────────────
// 1. PC → 2. EditEnable(0x50) → 3. BulkDump(0x28) → 4. ← ACK → 5. EditDisable(0x51)
async function writePatch(slot,p){
  const encoded=encodePatch(p);
  if(!encoded){st('Payload inválido','s-err');return false;}
  const msg=new Uint8Array([0xF0,ZOOM_MFR,0x00,dev.id,0x28,slot,...encoded,0xF7]);
  sendRaw(pc(slot));
  await sleep(60);
  paramEditEnable();
  await sleep(80);
  const ack=await sendAwait(msg,2000);
  if(!isCommitAck(ack)) L.warn('writePatch: ACK inesperado — pedal pode não ter confirmado a escrita');
  await sleep(40);
  paramEditDisable();
  await sleep(40);
  return true;
}

// ── TUNER ─────────────────────────────────────────────────────────────
// Liga/desliga: SysEx F0 52 00 [devid] 56 [01=on|00=off] F7
// Resposta contínua: F0 52 00 [devid] 57 [note 0-11] [cents 0-127, 64=zero] F7
// Enquanto tuner está ativo o pedal NÃO processa patch edits — desligar antes de read/write
function isTunerActive(){return _tunerActive;}

async function tunerOn(){
  if(!dev||_tunerActive) return;
  _tunerActive=true;
  sendRaw(sx(dev.id,[0x56,0x01]));
  L.ok('Tuner LIGADO');
}

async function tunerOff(){
  if(!dev||!_tunerActive) return;
  _tunerActive=false;
  sendRaw(sx(dev.id,[0x56,0x00]));
  L.info('Tuner DESLIGADO');
  await sleep(80); // dar tempo ao pedal para sair do modo tuner
}

// ── TAP TEMPO ─────────────────────────────────────────────────────────
// Enviar BPM: F0 52 00 [devid] 60 [bpm_lo] [bpm_hi] F7  (range 40-250)
// Pedir BPM:  F0 52 00 [devid] 61 F7  → resposta 0x62 [lo] [hi]
async function setTempo(bpm){
  if(!dev) return;
  const b=Math.max(40,Math.min(250,Math.round(bpm)));
  sendRaw(sx(dev.id,[0x60,b&0x7F,(b>>7)&0x7F]));
  L.op(`Tempo enviado ao pedal: BPM ${b}`);
}

async function requestTempo(){
  if(!dev) return null;
  try{
    const r=await sendAwait(sx(dev.id,[0x61]),1000);
    if(!r||r[4]!==0x62) return null;
    return (r[5]&0x7F)|((r[6]&0x7F)<<7);
  }catch{return null;}
}

// ── PEDAL DE EXPRESSÃO ────────────────────────────────────────────────
// Assign: F0 52 00 [devid] 64 [fxSlot] [paramIdx] [minRaw] [maxRaw] F7
// Clear:  mesmo com minRaw=maxRaw=0x00
// Só disponível em G1Xon, G1Xon-K, G1X FOUR, B1Xon (dev.hasPedal=true)
function setPedalAssign(fxSlot,paramIdx,minRaw,maxRaw){
  if(!dev||!dev.hasPedal) return;
  sendRaw(sx(dev.id,[0x64,fxSlot&0x7F,paramIdx&0x7F,minRaw&0x7F,maxRaw&0x7F]));
  L.op(`Pedal assign: slot=${fxSlot} param=${paramIdx} min=${minRaw} max=${maxRaw}`);
}

function clearPedalAssign(fxSlot,paramIdx){
  setPedalAssign(fxSlot,paramIdx,0,0);
}

// ── UTILS ─────────────────────────────────────────────────────────────
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function hex(d){return Array.from(d).map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' ');}
