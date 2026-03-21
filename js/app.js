// ── APP STATE ─────────────────────────────────────────────────────────
let patches=[],slot=-1,reading=false;
const $=id=>document.getElementById(id);
const [BC,BR,BB,BRS,FRS,PB,PT2,PL,ES,EC,DOT,BADGE,STATUS]=
  ['bc','br','bb','brs','frs','pb','pt','pl','es','ec','dot','badge','status'].map($);

function st(m,c='s-info'){STATUS.textContent=m;STATUS.className=c;}
function sp(c,t){PB.style.width=t?Math.round(c/t*100)+'%':'0%';PT2.textContent=t?`${c}/${t}`:''; }

// ── CONNECT ───────────────────────────────────────────────────────────
BC.onclick=async()=>{
  if(dev){disconnect();return;}
  st('conectando...','s-info');BC.disabled=true;
  try{const d=await connect();onConnected(d);}
  catch(e){st(e.message,'s-err');}
  finally{BC.disabled=false;}
};

function onConnected(d){
  DOT.classList.remove('off');
  BADGE.textContent=`${d.name} · fw ${d.fw}`;
  BC.textContent='DISCONNECT';
  BC.style.cssText='background:transparent;color:var(--red);border-color:rgba(239,68,68,.4)';
  BR.disabled=BB.disabled=BRS.disabled=false;
  patches=new Array(d.presets).fill(null);
  st(`conectado · ${d.presets} patches`,'s-ok');
  ES.innerHTML=`<div class="ei">⬡</div><p>${d.name.toUpperCase()} CONECTADO</p><p style="font-size:.65rem;opacity:.5">clique em READ ALL para carregar os patches</p>`;
}

on('dc',()=>{
  DOT.classList.add('off');BADGE.textContent='no device';
  BC.textContent='CONNECT';BC.style.cssText='';
  BR.disabled=BB.disabled=BRS.disabled=true;
  patches=[];slot=-1;PL.innerHTML='';
  ES.innerHTML='<div class="ei">⬡</div><p>DISPOSITIVO DESCONECTADO</p>';
  ES.style.display='flex';EC.style.display='none';
  st('desconectado','s-warn');sp(0,0);
});

// ── READ ALL ──────────────────────────────────────────────────────────
BR.onclick=async()=>{
  if(!dev||reading)return;
  reading=true;BR.disabled=true;
  $('dbg').style.display='block';
  st('lendo patches...','s-info');sp(0,dev.presets);
  try{
    for(let s=0;s<dev.presets;s++){
      const r=await readPatch(s);
      const p=parsePatch(r,dev.id);
      if(p){
        p.slot=s;
        // Inicializar paramValues a partir do raw
        p.effects.forEach(fx=>{
          if(!fx.isEmpty) fx.paramValues=readParamValues(fx);
        });
        patches[s]=p;
        renderItem(s,p);
      }
      sp(s+1,dev.presets);
      await sleep(80);
    }
    const n=patches.filter(Boolean).length;
    st(`${n}/${dev.presets} patches carregados`,n>0?'s-ok':'s-warn');
    Storage.savePatches(patches,dev).catch(()=>{});
  }catch(e){st(e.message,'s-err');}
  finally{reading=false;BR.disabled=false;}
};

// ── BACKUP ────────────────────────────────────────────────────────────
BB.onclick=async()=>{
  if(!dev)return;
  Storage.exportToFile(patches,dev);
  await Storage.createBackup(patches,dev,`Manual · ${dev.name||'G1on'} · ${new Date().toLocaleString('pt-BR')}`);
  st('backup salvo','s-ok');
  renderBackupBadge();
};

// ── RESTORE ───────────────────────────────────────────────────────────
BRS.onclick=()=>FRS.click();
FRS.onchange=async e=>{
  const f=e.target.files[0];if(!f)return;FRS.value='';
  let bk;
  try{bk=await Storage.importFromFile(f);}
  catch(err){st(err.message,'s-err');return;}
  if(!bk.patches){st('formato inválido','s-err');return;}
  const bid=bk.device?.id||bk.device?.deviceId;
  if(dev&&bid&&bid!==dev.id){st(`backup para ${bk.device?.name}, conectado: ${dev.name}`,'s-err');return;}
  if(!confirm(`Restaurar ${bk.patches.filter(Boolean).length} patches?`))return;
  st('restaurando...','s-info');
  for(let s=0;s<bk.patches.length;s++){
    const p=bk.patches[s];if(!p)continue;
    try{
      if(dev)await writePatch(s,p);
      patches[s]=p;renderItem(s,p);
    }catch(e){st(e.message,'s-err');return;}
    sp(s+1,bk.patches.length);await sleep(80);
  }
  Storage.savePatches(patches,dev).catch(()=>{});
  st('restauração concluída','s-ok');
};

// ── SIDEBAR: PATCH LIST ───────────────────────────────────────────────
function renderItem(s,p){
  let el=PL.querySelector(`[data-s="${s}"]`);
  if(!el){
    el=document.createElement('div');el.className='pi';el.dataset.s=s;
    el.onclick=()=>openEditor(s);
    let ins=false;
    for(const it of PL.querySelectorAll('.pi')){
      if(+it.dataset.s>s){PL.insertBefore(el,it);ins=true;break;}
    }
    if(!ins)PL.appendChild(el);
  }
  const n=p.effects.filter(f=>!f.isEmpty).length;
  const empty=!p.name||p.name.trim()===''||p.name.toLowerCase().includes('empty');
  el.innerHTML=`<span class="pn">${String(s+1).padStart(2,'0')}</span>`
    +`<span class="pm${empty?' e':''}">${esc(p.name||'empty')}</span>`
    +`<span class="pfx">${n}</span>`;
  if(s===slot)el.classList.add('active');
}

// ── EDITOR DE PATCH ───────────────────────────────────────────────────
function openEditor(s){
  const p=patches[s];if(!p)return;
  slot=s;
  PL.querySelectorAll('.pi').forEach(el=>el.classList.remove('active'));
  PL.querySelector(`[data-s="${s}"]`)?.classList.add('active');
  ES.style.display='none';EC.style.display='block';

  const activeCount=p.effects.filter(f=>!f.isEmpty&&f.en).length;
  EC.innerHTML=`
    <div class="et">
      <span class="en">${String(s+1).padStart(2,'0')}</span>
      <input class="ni" id="ni" type="text" maxlength="10" value="${esc(p.name)}" spellcheck="false"/>
      <button class="bw" id="bw">WRITE</button>
      <button class="bs" id="bse">SELECT</button>
      <button class="bs" id="bvol" style="color:var(--amber);border-color:rgba(245,158,11,.3)">VOL</button>
      <button class="bs" id="bclr" style="color:var(--red);border-color:rgba(239,68,68,.3)">CLR</button>
    </div>
    <div id="vol-row" style="display:none;align-items:center;gap:10px;margin-bottom:12px;padding:8px 12px;background:var(--bg3);border-radius:var(--r);border:1px solid var(--border)">
      <span style="font-family:var(--mono);font-size:.65rem;color:var(--amber)">VOLUME</span>
      <input type="range" id="vol-sl" min="0" max="150" value="100" style="flex:1;height:3px;accent-color:var(--amber)"/>
      <span id="vol-val" style="font-family:var(--mono);font-size:.65rem;color:var(--amber);min-width:24px">100</span>
    </div>
    <div class="fl">${activeCount} ATIVOS · FX CHAIN · ${p.effects.length} SLOTS</div>
    <div class="fc" id="fc"></div>`;

  const fc=$('fc');
  p.effects.forEach((fx,i)=>fc.appendChild(mkSlot(fx,i,p)));

  // WRITE
  $('bw').onclick=async()=>{
    if(!dev){st('não conectado','s-err');return;}
    p.name=$('ni').value.slice(0,10);
    try{
      await writePatch(s,p);
      st(`patch ${s+1} escrito`,'s-ok');
      renderItem(s,p);
      Storage.scheduleAutoSave(patches,dev);
    }catch(e){st(e.message,'s-err');}
  };

  // SELECT (program change)
  $('bse').onclick=async()=>{
    if(!dev){st('não conectado','s-err');return;}
    try{sendRaw(pc(s));st(`patch ${s+1} selecionado`,'s-info');}
    catch(e){st(e.message,'s-err');}
  };

  // VOLUME (ajusta o param Level do último efeito ativo)
  $('bvol').onclick=()=>{
    const row=$('vol-row');
    const showing=row.style.display==='flex';
    row.style.display=showing?'none':'flex';
    if(!showing){
      const v=getPatchVolume(p);
      if(v!==null){$('vol-sl').value=v;$('vol-val').textContent=v;}
      else st('Nenhum efeito ativo com parâmetro Level','s-warn');
    }
  };
  $('vol-sl').oninput=()=>{
    const v=parseInt($('vol-sl').value);
    $('vol-val').textContent=v;
    setPatchVolume(p,v);
    // Atualizar slider na chain se visível
    const info=getPatchVolumeInfo(p);
    if(info){
      const sl=document.querySelector(`[data-fi="${info.slotIdx}"][data-pi="${info.paramIdx}"]`);
      if(sl){sl.value=v;sl.nextElementSibling.textContent=v;}
    }
  };

  // CLR
  $('bclr').onclick=()=>{
    if(!confirm('Limpar patch? Todos os efeitos e o nome serão apagados.'))return;
    clearPatch(p);
    $('ni').value='';
    openEditor(s);
    st(`patch ${s+1} limpo`,'s-warn');
    Storage.scheduleAutoSave(patches,dev);
  };
}

// ── VOLUME HELPERS ────────────────────────────────────────────────────
function getPatchVolumeInfo(p){
  for(let i=4;i>=0;i--){
    const fx=p.effects[i];
    if(!fx||fx.isEmpty)continue;
    const db=fxInfo(fx.name);if(!db)continue;
    const li=db.params.findIndex(pm=>pm.n==='Level'||pm.n==='LEVEL');
    if(li<0)continue;
    return{slotIdx:i,paramIdx:li};
  }
  return null;
}
function getPatchVolume(p){
  const info=getPatchVolumeInfo(p);
  if(!info)return null;
  const fx=p.effects[info.slotIdx];
  return fx.paramValues?.[info.paramIdx]??null;
}
function setPatchVolume(p,vol){
  const info=getPatchVolumeInfo(p);
  if(!info)return;
  const fx=p.effects[info.slotIdx];
  if(!fx.paramValues)fx.paramValues=readParamValues(fx);
  fx.paramValues[info.paramIdx]=vol&0x7F;
}

// ── CONSTRUTOR DE SLOT ─────────────────────────────────────────────────
function mkSlot(fx,idx,p){
  const div=document.createElement('div');
  div.className=`fs ${fx.en&&!fx.isEmpty?'on':'off'}`;

  if(fx.isEmpty){
    div.style.cursor='pointer';
    div.title='Clique para adicionar um efeito';
    div.innerHTML='<div class="fh" style="opacity:.4"><span class="fn">+ Adicionar efeito</span></div>';
    div.onclick=()=>showPicker(p,idx,name=>{
      insertEffect(p,idx,name);
      openEditor(slot);
    });
    return div;
  }

  const db=fxInfo(fx.name);
  const desc=db?.desc||'';
  const catLabel=db?.cat||fx.cat||'';

  // Garantir paramValues inicializados
  if(!fx.paramValues) fx.paramValues=readParamValues(fx);

  // Construir linhas de parâmetro
  const rows=(db?.params||[]).map((pm,i)=>{
    const raw=fx.paramValues[i]??0;
    // Determinar limites reais
    const pmMin=pm.min??0;
    const pmMax=pm.max??127;
    const pmDflt=pm.dflt??Math.round((pmMax-pmMin)/2)+pmMin;
    // Valor na escala do display
    const dv=rawToDisplay(raw,pm);
    const flagP=pm.p?`<span class="ptag" title="Assignável ao pedal de expressão">P</span>`:'';
    const flagT=pm.t?`<span class="ptag t" title="Sincronizável com BPM / figura rítmica">♩</span>`:'';
    const tip=`${pm.d||''}  [${pm.r||`${pmMin}–${pmMax}`}]`;
    return `<div class="pr">
      <span class="pl2" title="${esc(tip)}">${esc(pm.n)}${flagP}${flagT}</span>
      <input type="range" class="ps"
        min="${pmMin}" max="${pmMax}" value="${dv}"
        data-fi="${idx}" data-pi="${i}"
        data-pmmin="${pmMin}" data-pmmax="${pmMax}"
        title="${esc(tip)}"/>
      <span class="pv">${dv}</span>
    </div>`;
  }).join('');

  const cbId=`cb${idx}`;
  div.innerHTML=`
    <div class="fh">
      <label class="tl" for="${cbId}">
        <input type="checkbox" id="${cbId}" ${fx.en?'checked':''}/>
        <span class="tt"></span>
        <span class="fn" title="${esc(desc)}">${esc(fx.name)}</span>
      </label>
      <div style="display:flex;align-items:center;gap:6px">
        ${catLabel?`<span class="fc2">${esc(catLabel)}</span>`:''}
        <span class="fx-remove" data-fi="${idx}" title="Remover efeito"
          style="cursor:pointer;font-size:.7rem;color:var(--text3);padding:2px 5px;border-radius:3px;border:1px solid rgba(255,255,255,.08)">✕</span>
      </div>
    </div>
    ${desc?`<div class="fdesc">${esc(desc)}</div>`:''}
    ${rows?`<div class="fp">${rows}</div>`:''}`;

  // Toggle enable
  div.querySelector(`#${cbId}`).onchange=e=>{
    fx.en=e.target.checked;
    p.effects[idx].en=fx.en;
    div.className=`fs ${fx.en?'on':'off'}`;
    // Atualizar bit de enable no raw
    if(p.raw){
      const u=zoomUnpack(p.raw);
      const ui=idx*23+1,g=Math.floor(ui/8),bit=(ui%8)-1,mPos=g*8;
      if(fx.en) u[mPos]|=(1<<bit); else u[mPos]&=~(1<<bit);
      p.raw=zoomPack(u);
    }
  };

  // Sliders: atualizar paramValues e raw ao mover
  div.querySelectorAll('.ps').forEach(sl=>{
    sl.oninput=()=>{
      const dv=parseInt(sl.value);
      sl.nextElementSibling.textContent=dv;
      const pi=parseInt(sl.dataset.pi);
      const fi=parseInt(sl.dataset.fi);
      const db2=fxInfo(p.effects[fi].name);
      const pm=db2?.params[pi];
      const raw=pm?displayToRaw(dv,pm):dv;
      if(!p.effects[fi].paramValues) p.effects[fi].paramValues=readParamValues(p.effects[fi]);
      p.effects[fi].paramValues[pi]=raw;
      // Sincronizar fx.params[] para que readParamValues() seja consistente
      if(p.effects[fi].params) p.effects[fi].params[6+pi]=raw;
      // Propagar ao raw payload
      if(p.raw){
        const u=zoomUnpack(p.raw);
        const ui=fi*23+6+pi,g=Math.floor(ui/8),pos=ui%8,mPos=g*8;
        if(pos===0) u[mPos]=(u[mPos]&0x80)|(raw&0x7F);
        else u[mPos+pos]=(u[mPos+pos]&0x80)|(raw&0x7F);
        p.raw=zoomPack(u);
      }
    };
  });

  // Remover efeito
  div.querySelector('.fx-remove')?.addEventListener('click',e=>{
    e.stopPropagation();
    removeEffect(p,parseInt(e.currentTarget.dataset.fi));
    openEditor(slot);
  });

  return div;
}

// ── INSERIR / REMOVER EFEITO ──────────────────────────────────────────
function insertEffect(p,si,name){
  const dflt=FX_DFLT[name];
  if(!dflt){st('Efeito não encontrado no banco de dados','s-err');return;}
  const u=zoomUnpack(p.raw||new Array(127).fill(0));
  const s=si*23;
  const slot23=[...dflt];
  slot23[1]|=0x80; // enable bit
  for(let i=0;i<23;i++) u[s+i]=slot23[i];
  p.raw=zoomPack(u);
  // Re-decodificar o slot
  const b0=u[s],b1=u[s+1],b3=u[s+3],b4=u[s+4],b5=u[s+5];
  const en=(b1&0x80)!==0,b1m=b1&0x7F;
  const info=gfx(b0,b1,b3,b4,b5);
  const fx={b0,b1,b1m,b3,b4,b5,isEmpty:false,en,params:slot23,name:info.n,cat:info.c};
  fx.paramValues=readParamValues(fx);
  p.effects[si]=fx;
}

function removeEffect(p,si){
  const u=zoomUnpack(p.raw||new Array(127).fill(0));
  const s=si*23;
  for(let i=0;i<23;i++) u[s+i]=0;
  p.raw=zoomPack(u);
  p.effects[si]={b0:0,b1:0,b1m:0,b3:0,isEmpty:true,en:false,params:new Array(23).fill(0),name:'Empty',cat:null,paramValues:[]};
}

function clearPatch(p){
  p.name='';
  const u=new Array(127).fill(0);
  const nm='          ';
  for(let i=0;i<4;i++) u[115+i]=nm.charCodeAt(i)&0x7F;
  u[119]=0x00;
  for(let i=4;i<9;i++) u[115+i+1]=nm.charCodeAt(i)&0x7F;
  p.raw=zoomPack(u);
  p.effects=Array.from({length:5},()=>({
    b0:0,b1:0,b1m:0,b3:0,isEmpty:true,en:false,
    params:new Array(23).fill(0),name:'Empty',cat:null,paramValues:[]
  }));
}

// ── MODAL DE SELEÇÃO DE EFEITO ────────────────────────────────────────
// Categorias em PT-BR na ordem do ToneLib
const CAT_ORDER=['Dinâmica','Filtro','Drive','Amplificador','Modulação','Delay','Reverb','SFX','EQ','Noise Reduction','Pedal'];

// Construir índice por categoria
const FX_BY_CAT={};
Object.entries(FX_DB).forEach(([name,info])=>{
  const cat=info.cat||'Outros';
  if(!FX_BY_CAT[cat])FX_BY_CAT[cat]=[];
  FX_BY_CAT[cat].push(name);
});
Object.values(FX_BY_CAT).forEach(arr=>arr.sort());

function showPicker(p,si,onSel){
  document.getElementById('fx-modal')?.remove();
  const modal=document.createElement('div');
  modal.id='fx-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1000;display:flex;align-items:center;justify-content:center';

  const box=document.createElement('div');
  box.style.cssText='background:var(--surface);border:1px solid var(--border2);border-radius:var(--r2);width:440px;max-height:72vh;display:flex;flex-direction:column;overflow:hidden';

  const hdr=document.createElement('div');
  hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border)';
  hdr.innerHTML=`<span style="font-family:var(--mono);font-size:.75rem;color:var(--accent)">ESCOLHER EFEITO · SLOT ${si+1}</span><span id="fx-close" style="cursor:pointer;color:var(--text3);font-size:1.2rem">✕</span>`;

  const srch=document.createElement('div');
  srch.style.cssText='padding:8px 12px;border-bottom:1px solid var(--border)';
  srch.innerHTML=`<input id="fx-q" type="text" placeholder="Buscar por nome, categoria ou descrição..." style="width:100%;background:var(--bg3);border:1px solid var(--border2);color:var(--text);font-family:var(--sans);font-size:.82rem;padding:6px 10px;border-radius:var(--r);outline:none"/>`;

  const list=document.createElement('div');
  list.style.cssText='overflow-y:auto;flex:1;padding:4px 0';

  function render(q){
    list.innerHTML='';
    const cats=Object.keys(FX_BY_CAT).sort((a,b)=>{
      const ia=CAT_ORDER.indexOf(a),ib=CAT_ORDER.indexOf(b);
      if(ia>=0&&ib>=0)return ia-ib;
      if(ia>=0)return-1;if(ib>=0)return 1;
      return a.localeCompare(b);
    });
    cats.forEach(cat=>{
      const names=(FX_BY_CAT[cat]||[]).filter(n=>
        !q||n.toLowerCase().includes(q)||cat.toLowerCase().includes(q)||
        (FX_DB[n]?.desc||'').toLowerCase().includes(q)
      );
      if(!names.length)return;
      const ch=document.createElement('div');
      ch.style.cssText='font-family:var(--mono);font-size:.58rem;color:var(--text3);letter-spacing:1.5px;padding:8px 16px 3px;text-transform:uppercase;border-top:1px solid var(--border);margin-top:2px';
      ch.textContent=cat;
      list.appendChild(ch);
      names.forEach(name=>{
        const db=FX_DB[name];
        const hasPedal=db?.params?.some(p=>p.p);
        const hasBB=db?.params?.some(p=>p.t);
        const nPrm=db?.params?.length||0;
        const it=document.createElement('div');
        it.style.cssText='padding:7px 16px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.03)';
        it.onmouseover=()=>it.style.background='rgba(255,255,255,.04)';
        it.onmouseout=()=>it.style.background='';
        it.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:.82rem;font-weight:500">${esc(name)}</span>
          <div style="display:flex;gap:3px;align-items:center">
            ${hasPedal?`<span style="font-family:var(--mono);font-size:.5rem;background:rgba(124,58,237,.2);color:var(--accent2);padding:1px 3px;border-radius:3px">P</span>`:''}
            ${hasBB?`<span style="font-family:var(--mono);font-size:.5rem;background:rgba(6,182,212,.15);color:var(--accent3);padding:1px 3px;border-radius:3px">♩</span>`:''}
            <span style="font-family:var(--mono);font-size:.52rem;color:var(--text3)">${nPrm}p</span>
          </div>
        </div>
        ${db?.desc?`<div style="font-size:.62rem;color:var(--text3);margin-top:2px">${esc(db.desc)}</div>`:''}`;
        it.onclick=()=>{onSel(name);modal.remove();};
        list.appendChild(it);
      });
    });
    if(!list.children.length)
      list.innerHTML='<div style="padding:20px;text-align:center;font-family:var(--mono);font-size:.72rem;color:var(--text3)">nenhum resultado</div>';
  }

  render('');
  box.appendChild(hdr);box.appendChild(srch);box.appendChild(list);
  modal.appendChild(box);document.body.appendChild(modal);
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
  hdr.querySelector('#fx-close').onclick=()=>modal.remove();
  const qi=srch.querySelector('#fx-q');
  qi.oninput=()=>render(qi.value.toLowerCase().trim());
  qi.focus();
}

// ── DEBUG ──────────────────────────────────────────────────────────────
const DBG=$('dbg'),DL=$('dl');
function log(tag,msg,color='var(--accent3)'){
  if(DBG.style.display!=='block')return;
  const r=document.createElement('div');r.className='dr';
  r.innerHTML=`<span style="color:${color}">${tag}</span>${esc(String(msg))}`;
  DL.appendChild(r);DL.scrollTop=DL.scrollHeight;
}
function hex(d){return Array.from(d).map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' ');}

$('bd').onclick=()=>{
  const open=DBG.style.display==='block';
  DBG.style.display=open?'none':'block';
  if(!open){DL.innerHTML='';log('info','debug aberto — todo tráfego MIDI será logado','var(--text2)');}
};
$('dc').onclick=()=>DBG.style.display='none';
$('ds').onclick=async()=>{
  log('info','enviando identity request...','var(--text2)');
  if(!acc)try{acc=await navigator.requestMIDIAccess({sysex:true});}catch(e){log('err',e.message,'var(--red)');return;}
  const ins=[...acc.inputs.values()],outs=[...acc.outputs.values()];
  ins.forEach(i=>{log('in ',`${i.name} [${i.state}]`,'var(--green)');i.onmidimessage=e=>log('←rx',hex(new Uint8Array(e.data)),'var(--accent3)');});
  outs.forEach(o=>{
    log('out',`${o.name} [${o.state}]`,'var(--amber)');
    try{const m=idReq();o.send(m);log('→tx',hex(m),'var(--accent2)');}
    catch(e){log('err',e.message,'var(--red)');}
  });
};

// ── UTILS ─────────────────────────────────────────────────────────────
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}


// ── INTEGRAÇÃO COM STORAGE ────────────────────────────────────────────
function renderBackupBadge(){
  Storage.listBackups().then(list=>{
    const b=document.getElementById('backup-count');
    if(b) b.textContent=list.length>0?String(list.length):'';
  }).catch(()=>{});
}

async function tryLoadSavedPatches(){
  const saved=await Storage.loadPatches().catch(()=>null);
  if(!saved?.patches) return false;
  saved.patches.forEach((p,i)=>{if(p){patches[i]=p;renderItem(i,p);}});
  const n=saved.patches.filter(Boolean).length;
  const ts=new Date(saved.ts).toLocaleString('pt-BR');
  st(`${n} patches carregados do armazenamento local · ${ts}`,'s-info');
  ES.style.display='none';EC.style.display='none';
  if(PL.children.length) PL.firstChild.click();
  return true;
}

// Indicador dirty (save-dot)
Storage.onDirtyChange(dirty=>{
  const dot=document.getElementById('save-dot');
  if(dot){dot.style.opacity=dirty?'1':'0';dot.title=dirty?'Alterações não salvas':'Tudo salvo';}
});

// Botão Backups
const BBKP=document.getElementById('bkp');
if(BBKP) BBKP.onclick=()=>showBackupsPanel();

// Painel de backups
function showBackupsPanel(){
  document.getElementById('bp-modal')?.remove();
  const modal=document.createElement('div');
  modal.id='bp-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1001;display:flex;align-items:center;justify-content:center';
  const box=document.createElement('div');
  box.style.cssText='background:var(--surface);border:1px solid var(--border2);border-radius:var(--r2);width:500px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden';
  const hdr=document.createElement('div');
  hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border)';
  hdr.innerHTML=`<span style="font-family:var(--mono);font-size:.8rem;color:var(--accent)">◈ BACKUPS LOCAIS</span><div style="display:flex;gap:10px;align-items:center"><span id="bp-new" style="cursor:pointer;font-family:var(--mono);font-size:.65rem;color:var(--green);border:1px solid rgba(16,185,129,.3);padding:3px 10px;border-radius:4px">+ NOVO</span><span id="bp-close" style="cursor:pointer;color:var(--text3);font-size:1.2rem">✕</span></div>`;
  const list=document.createElement('div');
  list.style.cssText='overflow-y:auto;flex:1;padding:8px 0';
  const renderList=async()=>{
    list.innerHTML='<div style="padding:16px;font-family:var(--mono);font-size:.65rem;color:var(--text3)">carregando...</div>';
    const bks=await Storage.listBackups().catch(()=>[]);
    if(!bks.length){list.innerHTML='<div style="padding:20px;text-align:center;font-family:var(--mono);font-size:.7rem;color:var(--text3)">Nenhum backup encontrado</div>';return;}
    list.innerHTML='';
    bks.forEach(b=>{
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid var(--border)';
      row.onmouseover=()=>row.style.background='rgba(255,255,255,.03)';
      row.onmouseout=()=>row.style.background='';
      const ts=new Date(b.ts).toLocaleString('pt-BR');
      const cnt=b.patches?.filter(Boolean).length??'?';
      row.innerHTML=`<div style="flex:1;min-width:0"><div style="font-size:.8rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.label||ts)}</div><div style="font-family:var(--mono);font-size:.6rem;color:var(--text3);margin-top:2px">${esc(ts)} · ${esc(String(b.device?.name||b.device||'?'))} · ${cnt}p</div></div><div style="display:flex;gap:6px;flex-shrink:0"><button class="bp-r" data-id="${b.id}" style="font-family:var(--mono);font-size:.6rem;padding:3px 8px;border-radius:4px;border:1px solid rgba(6,182,212,.3);color:var(--accent3);background:transparent;cursor:pointer">RESTAURAR</button><button class="bp-x" data-id="${b.id}" style="font-family:var(--mono);font-size:.6rem;padding:3px 8px;border-radius:4px;border:1px solid rgba(239,68,68,.2);color:var(--red);background:transparent;cursor:pointer">✕</button></div>`;
      list.appendChild(row);
    });
    list.querySelectorAll('.bp-r').forEach(btn=>{
      btn.onclick=async()=>{
        const bk=await Storage.loadBackup(btn.dataset.id);
        if(!bk){st('Backup não encontrado','s-err');return;}
        if(!confirm(`Restaurar "${bk.label}"? Patches na memória serão substituídos.`))return;
        modal.remove();
        bk.patches.forEach((p,i)=>{if(p){patches[i]=p;renderItem(i,p);}});
        Storage.savePatches(patches,dev).catch(()=>{});
        st(`Backup restaurado`,'s-ok');
        if(slot>=0)openEditor(slot);
      };
    });
    list.querySelectorAll('.bp-x').forEach(btn=>{
      btn.onclick=async()=>{
        if(!confirm('Apagar este backup?'))return;
        await Storage.deleteBackup(btn.dataset.id);
        renderList();renderBackupBadge();
      };
    });
  };
  box.appendChild(hdr);box.appendChild(list);modal.appendChild(box);document.body.appendChild(modal);
  renderList();
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
  hdr.querySelector('#bp-close').onclick=()=>modal.remove();
  hdr.querySelector('#bp-new').onclick=async()=>{
    const label=prompt('Nome do backup (opcional):')||undefined;
    await Storage.createBackup(patches,dev,label);
    renderList();renderBackupBadge();st('Backup criado','s-ok');
  };
}

// Inicialização
(async()=>{
  const health=await Storage.storageHealth().catch(()=>({idb:false,ls:false}));
  console.log('[Storage] health:',health);
  if(!dev){
    const loaded=await tryLoadSavedPatches().catch(()=>false);
    if(!loaded){
      ES.innerHTML='<div class="ei">⬡</div><p>CONNECT YOUR ZOOM PEDAL VIA USB</p><p style="font-size:.65rem;opacity:.5">chrome ou edge · permitir MIDI quando solicitado</p>';
      ES.style.display='flex';
    }
  }
  renderBackupBadge();
})();
