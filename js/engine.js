// G1on Editor · Motor MIDI/Zoom (codec, protocolo)
// Motor intacto — nao modificar

// ── CODEC ZOOM 7-IN-8 ─────────────────────────────────────────────────
// O protocolo Zoom empacota bits7 em um byte MSB por grupo de 8
// Grupo de 8 bytes raw → 8 bytes unpacked (bits7 reconstituídos do MSB)
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

// Re-empacota array unpacked (127 bytes) → array raw (127 bytes SysEx-safe)
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
// Layout do slot [0..22]:
//   [0]=b0  [1]=b1(bit7=enable,bits6-0=b1m)  [2]=b2  [3]=b3  [4]=b4  [5]=b5
//   [6..22]=parâmetros (17 bytes)
// Nome do patch: bytes [115..124] no array unpacked de 127 bytes
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
  // Nome: bytes 115–124, bit7 mascarado, trim
  const nameBytes=u.slice(115,125);
  const name=String.fromCharCode(...nameBytes.map(b=>b&0x7F).filter(b=>b!==0)).trimEnd();
  return{slot,name,effects:fx,raw:Array.from(pl)};
}

// ── ENCODE DE PATCH (raw → SysEx write) ──────────────────────────────
// Reconstrói o payload raw a partir do estado atual do patch
// Respeitando: enable bits, parâmetros, nome
function encodePatch(p){
  if(!p.raw||p.raw.length<110) return null;
  const raw=p.raw.slice();
  // Re-unpack para trabalhar nos bytes
  const u=zoomUnpack(raw);

  // Atualizar nome (bytes 115–124, formato Zoom: 4+null+5)
  const nm=(p.name||'').padEnd(10,' ').slice(0,10);
  for(let i=0;i<4;i++) u[115+i]=nm.charCodeAt(i)&0x7F;
  u[119]=0x00;
  for(let i=4;i<9;i++) u[115+i+1]=nm.charCodeAt(i)&0x7F;
  u[125]=0x20;

  // Atualizar enable de cada slot (bit7 do byte [s*23+1])
  for(let s=0;s<5;s++){
    const fx=p.effects[s];
    if(!fx||fx.isEmpty) continue;
    const ui=s*23+1; // índice unpacked do byte de enable
    const g=Math.floor(ui/8), bit=(ui%8)-1, mPos=g*8;
    if(fx.en) u[mPos]|=(1<<bit);
    else       u[mPos]&=~(1<<bit);
  }

  // Atualizar parâmetros de cada slot
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
        if(pos===0){
          u[mPos]=(u[mPos]&0x80)|(v&0x7F);
        } else {
          u[mPos+pos]=(u[mPos+pos]&0x80)|(v&0x7F);
        }
      }
    });
  }

  return zoomPack(u);
}

// Lê os paramValues de um efeito a partir do array unpacked do slot
function readParamValues(fx){
  const db=fxInfo(fx.name);
  if(!db) return [];
  return db.params.map((_,i)=>{
    const raw=fx.params[6+i];
    return raw!==undefined?(raw&0x7F):0;
  });
}

// Converte valor raw (0–127) para escala real do param
// Converte raw do hardware (0–127) → valor na escala real do param
// Regra: se mn>=0 E mx<=127, o raw já É o valor (mapeamento 1:1)
//        caso contrário (min<0, ou max>127), mapear proporcionalmente
function rawToDisplay(raw,pm){
  const mx=pm.max!==undefined?pm.max:127;
  const mn=pm.min!==undefined?pm.min:0;
  if(mn>=0 && mx<=127) return Math.min(mx,Math.max(mn,raw));
  // Mapeamento proporcional: raw 0..127 → mn..mx
  return Math.round(raw/127*(mx-mn))+mn;
}

// Converte valor na escala real → raw (0–127) para o protocolo
function displayToRaw(v,pm){
  const mx=pm.max!==undefined?pm.max:127;
  const mn=pm.min!==undefined?pm.min:0;
  if(mn>=0 && mx<=127) return Math.min(127,Math.max(0,v));
  // Mapeamento proporcional inverso
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
  log('←rx',hex(d),'var(--accent3)');
  if(pend){clearTimeout(pend.t);pend.res(d);pend=null;}
  if(d[0]===0xF0&&d[1]===ZOOM_MFR&&d[4]===0x28){
    const p=parsePatch(d,dev?.id);if(p)em('pu',p);
  }
}

async function connect(){
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
  const d=DEVS[id.id]||{key:'unknown',name:`Zoom 0x${id.id.toString(16).toUpperCase()}`,fxSlots:5,presets:50};
  dev={...d,id:id.id,fw:id.fw};
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
        log('←rx',hex(d),'var(--accent3)');
        if(d.length>=6&&d[0]===0xF0&&d[1]===0x7E&&d[3]===0x06&&d[4]===0x02&&d[5]===ZOOM_MFR)
          done({i,o,id:parseId(d)});
      };
    });
    try{const m=idReq();log('→tx',hex(m),'var(--accent2)');o.send(m);}
    catch{done(null);}
  });
}

function disconnect(){if(mIn)mIn.onmidimessage=null;mIn=mOut=dev=null;em('dc');}

function sendRaw(msg){
  if(!mOut)return;
  log('→tx',hex(msg),'var(--accent2)');
  mOut.send(msg);
}

function sendAwait(msg,ms=2000){
  const p=mkWait(ms);
  sendRaw(msg);
  return p;
}

// Sequência correta de leitura conforme spec Zoom MIDI:
// 1. Program Change (selecionar slot)  2. ParameterEditEnable (0x50)
// 3. Request Patch (0x29)  4. ← resposta com 0x28 + dados
async function readPatch(slot){
  sendRaw(pc(slot));
  await sleep(60);
  sendRaw(sx(dev.id,[0x50])); // ParameterEditEnable
  await sleep(80);
  return sendAwait(sx(dev.id,[0x29]),2000);
}

// Sequência de escrita:
// 1. Program Change  2. ParameterEditEnable  3. Send Patch (0x28)
async function writePatch(slot,p){
  const encoded=encodePatch(p);
  if(!encoded){st('Payload inválido','s-err');return false;}
  const msg=new Uint8Array([0xF0,ZOOM_MFR,0x00,dev.id,0x28,slot,...encoded,0xF7]);
  sendRaw(pc(slot));
  await sleep(60);
  sendRaw(sx(dev.id,[0x50]));
  await sleep(80);
  await sendAwait(msg,2000);
  return true;
}