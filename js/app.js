// ── APP STATE ─────────────────────────────────────────────────────────
let patches=[],slot=-1,reading=false;
const $=id=>document.getElementById(id);
const [BC,BR,BB,BRS,FRS,PB,PT2,PL,ES,EC,DOT,BADGE,STATUS]=
  ['bc','br','bb','brs','frs','pb','pt','pl','es','ec','dot','badge','status'].map($);

function st(m,c='s-info'){STATUS.textContent=m;STATUS.className=c;}
function sp(c,t){PB.style.width=t?Math.round(c/t*100)+'%':'0%';PT2.textContent=t?`${c}/${t}`:''; }

// ── CONNECT ───────────────────────────────────────────────────────────
BC.onclick=async()=>{
  if(dev){
    L.info(`Desconectando ${dev.name}...`);
    disconnect();
    return;
  }
  L.op('Conectando ao pedal...','Buscando dispositivo Zoom via Web MIDI');
  st('conectando...','s-info');BC.disabled=true;
  try{
    const d=await connect();
    onConnected(d);
  } catch(e){
    L.error('Falha na conexão', e.message);
    st(e.message,'s-err');
  } finally{BC.disabled=false;}
};

function onConnected(d){
  DOT.classList.remove('off');
  const pedalBadge=d.hasPedal?'<span style="font-family:var(--mono);font-size:.55rem;background:rgba(124,58,237,.2);color:var(--accent2);padding:1px 5px;border-radius:10px;margin-left:6px">EXP PEDAL</span>':'';
  BADGE.innerHTML=`${esc(d.name)} · fw ${esc(d.fw)}${pedalBadge}`;
  BC.textContent='DISCONNECT';
  BC.style.cssText='background:transparent;color:var(--red);border-color:rgba(239,68,68,.4)';
  patches=new Array(d.presets).fill(null);

  // Dispositivos ZxN (G1 FOUR, G3n, G5n, B1 FOUR) usam protocolo diferente — somente leitura de backup
  if(d._zxnWarning){
    BR.disabled=true;BB.disabled=false;BRS.disabled=true;
    st(`${d.name} conectado · protocolo ZxN (somente backup/restauração)`,'s-warn');
    ES.innerHTML=`<div class="ei">⬡</div><p>${esc(d.name.toUpperCase())} CONECTADO</p>`
      +`<p style="font-size:.65rem;color:var(--amber)">Este dispositivo usa o protocolo ZxN — incompatível com READ/WRITE direto nesta versão.<br>Você pode importar/restaurar backups .json gerados pelo ToneLib.</p>`;
    return;
  }

  BR.disabled=BB.disabled=BRS.disabled=false;
  st(`conectado · ${d.presets} patches`,'s-ok');
  ES.innerHTML=`<div class="ei">⬡</div><p>${esc(d.name.toUpperCase())} CONECTADO</p><p style="font-size:.65rem;opacity:.5">clique em READ ALL para carregar os patches</p>`;
  addDeviceToolbarButtons(d);
}

on('dc',()=>{
  DOT.classList.add('off');BADGE.innerHTML='no device';
  BC.textContent='CONNECT';BC.style.cssText='';
  BR.disabled=BB.disabled=BRS.disabled=true;
  patches=[];slot=-1;PL.innerHTML='';
  ES.innerHTML='<div class="ei">⬡</div><p>DISPOSITIVO DESCONECTADO</p>';
  ES.style.display='flex';EC.style.display='none';
  st('desconectado','s-warn');sp(0,0);
  // Remover botões extras da toolbar
  document.getElementById('btn-tuner')?.remove();
  document.getElementById('btn-tap')?.remove();
  document.getElementById('btn-pedal')?.remove();
  document.getElementById('toolbar-sep2')?.remove();
  // limpar modal de tuner se aberto
  document.getElementById('tuner-modal')?.remove();
  document.getElementById('tap-modal')?.remove();
  document.getElementById('pedal-modal')?.remove();
});

function addDeviceToolbarButtons(d){
  // Remover anteriores
  ['btn-tuner','btn-tap','btn-pedal','toolbar-sep2'].forEach(id=>document.getElementById(id)?.remove());
  const toolbar=document.querySelector('.toolbar');
  const debug=document.getElementById('bd');

  // Separador
  const sep=document.createElement('span');
  sep.id='toolbar-sep2';sep.style.cssText='width:1px;height:20px;background:var(--border2);margin:0 2px;flex-shrink:0';
  toolbar.insertBefore(sep,debug);

  // Tuner
  const btnTuner=document.createElement('button');
  btnTuner.className='btn';btnTuner.id='btn-tuner';
  btnTuner.textContent='TUNER';
  btnTuner.style.cssText='color:var(--green);border-color:rgba(16,185,129,.3)';
  btnTuner.title='Ativar/desativar afinador do pedal';
  btnTuner.onclick=()=>showTuner();
  toolbar.insertBefore(btnTuner,debug);

  // Tap Tempo
  const btnTap=document.createElement('button');
  btnTap.className='btn';btnTap.id='btn-tap';
  btnTap.textContent='TAP';
  btnTap.style.cssText='color:var(--amber);border-color:rgba(245,158,11,.3)';
  btnTap.title='Tap Tempo (clique no ritmo)';
  btnTap.onclick=()=>showTapTempo();
  toolbar.insertBefore(btnTap,debug);

  // Pedal de expressão (só para devices com pedal)
  if(d.hasPedal){
    const btnPedal=document.createElement('button');
    btnPedal.className='btn';btnPedal.id='btn-pedal';
    btnPedal.textContent='EXP';
    btnPedal.style.cssText='color:var(--accent2);border-color:rgba(124,58,237,.3)';
    btnPedal.title='Configurar pedal de expressão';
    btnPedal.onclick=()=>{ if(slot>=0&&patches[slot]) showPedalAssign(patches[slot]); else st('Abra um patch para configurar o pedal','s-warn'); };
    toolbar.insertBefore(btnPedal,debug);
  }
}

// ── READ ALL ──────────────────────────────────────────────────────────
BR.onclick=async()=>{
  if(!dev||reading)return;
  reading=true;BR.disabled=true;
  $('dbg').style.display='block';
  st('lendo patches...','s-info');sp(0,dev.presets);
  let errors=0;
  L.op(`READ ALL: lendo ${dev.presets} patches de ${dev.name}...`);
  try{
    for(let s=0;s<dev.presets;s++){
      let r=null,p=null;
      for(let attempt=0;attempt<2;attempt++){
        try{
          r=await readPatch(s);
          p=parsePatch(r,dev.id);
          if(p)break;
        }catch(e){
          L.warn(`Patch ${s+1} tentativa ${attempt+1} falhou`, e.message);
          if(attempt===0)await sleep(200);
        }
      }
      if(p){
        p.slot=s;
        p.effects.forEach(fx=>{if(!fx.isEmpty)fx.paramValues=readParamValues(fx);});
        const fxNames=p.effects.filter(f=>!f.isEmpty).map(f=>f.name).join(', ')||'(vazio)';
        L.patch(`Patch ${String(s+1).padStart(2,'0')} lido: "${p.name||'(sem nome)'}"`, fxNames);
        patches[s]=p;
        renderItem(s,p);
      } else {
        errors++;
        L.error(`Patch ${s+1} falhou após 2 tentativas — slot ignorado`);
      }
      sp(s+1,dev.presets);
      await sleep(60);
    }
    const n=patches.filter(Boolean).length;
    const errMsg=errors?` · ${errors} falhas`:'';
    L.ok(`READ ALL concluído: ${n}/${dev.presets} patches carregados${errMsg}`);
    st(`${n}/${dev.presets} patches carregados${errMsg}`,n>0?'s-ok':'s-warn');
    Storage.savePatches(patches,dev).catch(()=>{});
  }catch(e){
    L.error('READ ALL interrompido', e.message);
    st(e.message,'s-err');
  }
  finally{reading=false;BR.disabled=false;}
};

// ── BACKUP ────────────────────────────────────────────────────────────
BB.onclick=async()=>{
  if(!dev)return;
  const n=patches.filter(Boolean).length;
  L.op(`BACKUP: exportando ${n} patches de ${dev.name}...`);
  try{
    Storage.exportToFile(patches,dev);
    await Storage.createBackup(patches,dev,`Manual · ${dev.name||'G1on'} · ${new Date().toLocaleString('pt-BR')}`);
    L.ok(`Backup criado: ${n} patches de ${dev.name}`);
    st('backup salvo','s-ok');
    renderBackupBadge();
  }catch(e){
    L.error('Backup falhou', e.message);
    st('erro no backup','s-err');
  }
};

// ── RESTORE ───────────────────────────────────────────────────────────
BRS.onclick=()=>FRS.click();
FRS.onchange=async e=>{
  const f=e.target.files[0];if(!f)return;FRS.value='';
  let bk;
  try{bk=await Storage.importFromFile(f);}
  catch(err){st(err.message,'s-err');return;}
  if(!bk.patches){
    L.error('RESTORE falhou: formato de backup inválido', JSON.stringify(Object.keys(bk)));
    st('formato inválido','s-err');
    return;
  }
  const bid=bk.device?.id||bk.device?.deviceId;
  if(dev&&bid&&bid!==dev.id){
    L.warn(`RESTORE: backup é para ${bk.device?.name} (ID=${bid}), mas conectado: ${dev.name} (ID=${dev.id})`);
    st(`backup para ${bk.device?.name}, conectado: ${dev.name}`,'s-err');
    return;
  }
  L.op(`RESTORE: restaurando ${bk.patches.filter(Boolean).length} patches...`, `origem: ${bk.device?.name||'desconhecido'}`);
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
    el.draggable=true;
    el.onclick=()=>openEditor(s);
    // Drag-and-drop para reordenar patches (swap entre slots)
    el.ondragstart=e=>{e.dataTransfer.setData('text/plain',String(s));el.classList.add('dragging');};
    el.ondragend=()=>el.classList.remove('dragging');
    el.ondragover=e=>{e.preventDefault();el.classList.add('drag-over');};
    el.ondragleave=()=>el.classList.remove('drag-over');
    el.ondrop=e=>{
      e.preventDefault();el.classList.remove('drag-over');
      const from=parseInt(e.dataTransfer.getData('text/plain'));
      const to=parseInt(el.dataset.s);
      if(from!==to)swapPatches(from,to);
    };
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

// Swap de dois patches na lista + escrita no pedal
async function swapPatches(a,b){
  if(!patches[a]||!patches[b]){st('Patch não carregado','s-warn');return;}
  [patches[a],patches[b]]=[patches[b],patches[a]];
  patches[a].slot=a;patches[b].slot=b;
  renderItem(a,patches[a]);renderItem(b,patches[b]);
  if(slot===a)openEditor(a);else if(slot===b)openEditor(b);
  if(!dev){Storage.scheduleAutoSave(patches,dev);return;}
  L.op(`SWAP: trocando slot ${a+1} ↔ slot ${b+1}`, `"${patches[a].name}" ↔ "${patches[b].name}"`);
  st(`trocando patches ${a+1}↔${b+1}...`,'s-info');
  try{
    await writePatch(a,patches[a]);
    await writePatch(b,patches[b]);
    L.ok(`Swap concluído: slot ${a+1} ↔ slot ${b+1}`);
    st(`patches ${a+1}↔${b+1} trocados`,'s-ok');
    Storage.scheduleAutoSave(patches,dev);
  }catch(e){st(e.message,'s-err');}
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
    if(!dev){L.error('WRITE falhou: não conectado');st('não conectado','s-err');return;}
    const prevName=p.name;
    p.name=$('ni').value.slice(0,10);
    if(prevName!==p.name) L.op(`Nome do patch ${s+1} alterado`,`"${prevName}" → "${p.name}"`);
    L.op(`WRITE: enviando patch ${s+1} "${p.name}" para o pedal...`);
    try{
      await writePatch(s,p);
      st(`patch ${s+1} escrito`,'s-ok');
      renderItem(s,p);
      Storage.scheduleAutoSave(patches,dev);
    }catch(e){
      L.error(`WRITE patch ${s+1} falhou`, e.message);
      st(e.message,'s-err');
    }
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
    L.op(`Efeito ${fx.en?'LIGADO':'DESLIGADO'}: slot ${idx+1} ${fx.name}`, `patch ${slot+1} "${p.name}"`);
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
    let _sliderLogTimer=null;
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
      // Log debounced (não logar cada pixel do slider)
      clearTimeout(_sliderLogTimer);
      _sliderLogTimer=setTimeout(()=>{
        L.debug(`Param editado: ${p.effects[fi].name}.${pm?.n||'P'+pi} = ${dv} (raw=${raw})`, `slot ${fi+1} · patch ${slot+1}`);
      }, 400);
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
  if(!dflt){
    L.error(`insertEffect: "${name}" não encontrado no FX_DFLT`, `slot ${si+1} de "${p.name}"`);
    st('Efeito não encontrado no banco de dados','s-err');
    return;
  }
  L.op(`Inserindo efeito: ${name}`, `slot ${si+1} · patch "${p.name}"`);
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

// ── DEBUG (MIDI RAW PANEL - legado) ────────────────────────────────────
const DBG=$('dbg'),DL=$('dl');
// log() bridge: redireciona para o console L.* e também para o painel MIDI raw se aberto
function log(tag,msg,color){
  // Redirecionar para console global
  if(tag==='←rx'||tag==='→tx') {
    if(tag==='←rx') L.midiRx(tag, String(msg));
    else             L.midiTx(tag, String(msg));
  } else if(tag==='err'||tag==='error') L.error(String(msg));
  else if(tag==='warn')                  L.warn(String(msg));
  else                                   L.debug(`[${tag}] ${String(msg)}`);
  // Painel MIDI raw (legado) — só se aberto
  if(DBG.style.display!=='block') return;
  const r=document.createElement('div');r.className='dr';
  r.innerHTML=`<span style="color:${color||'var(--accent3)'}">${tag} </span>${esc(String(msg))}`;
  DL.appendChild(r);DL.scrollTop=DL.scrollHeight;
}
function hex(d){return Array.from(d).map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' ');}

$('bd').onclick=()=>{
  const open=DBG.style.display==='block';
  DBG.style.display=open?'none':'block';
  if(!open){DL.innerHTML='';L.info('Painel MIDI raw aberto');}
};
$('dc').onclick=()=>DBG.style.display='none';
$('ds').onclick=async()=>{
  L.op('Enviando Identity Request a todas as portas MIDI...');
  if(!acc)try{acc=await navigator.requestMIDIAccess({sysex:true});}catch(e){L.error('requestMIDIAccess falhou',e.message);return;}
  const ins=[...acc.inputs.values()],outs=[...acc.outputs.values()];
  ins.forEach(i=>{L.info(`Porta IN: ${i.name}`,`state=${i.state}`);i.onmidimessage=e=>L.midiRx('←RX',hex(new Uint8Array(e.data)));});
  outs.forEach(o=>{
    L.info(`Porta OUT: ${o.name}`,`state=${o.state}`);
    try{const m=idReq();o.send(m);L.midiTx('→TX Identity Request',hex(m));}
    catch(e){L.error(`Falha ao enviar para ${o.name}`,e.message);}
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

// ── EXPORT / IMPORT / SHARE ───────────────────────────────────────────
// EXPORT: salva o patch atual (slot aberto) como arquivo JSON
const BEXP=$('bexp'),BIMP=$('bimp'),FIMP=$('fimp'),BSHARE=$('bshare');

if(BEXP) BEXP.onclick=()=>{
  if(slot<0||!patches[slot]){st('Abra um patch para exportar','s-warn');return;}
  const p=patches[slot];
  const data=JSON.stringify({version:3,device:dev,patch:p},null,2);
  const a=document.createElement('a');
  a.href='data:application/json;charset=utf-8,'+encodeURIComponent(data);
  a.download=`${String(slot+1).padStart(2,'0')}_${(p.name||'patch').replace(/[^a-zA-Z0-9_-]/g,'_')}.json`;
  a.click();
  st(`patch ${slot+1} exportado`,'s-ok');
};

// IMPORT: carrega um patch JSON no slot atual (ou escolhe slot)
if(BIMP) BIMP.onclick=()=>FIMP.click();
if(FIMP) FIMP.onchange=async e=>{
  const f=e.target.files[0];if(!f)return;FIMP.value='';
  let data;
  try{data=JSON.parse(await f.text());}
  catch{st('JSON inválido','s-err');return;}
  // Aceita formato {patch:...} (export individual) ou {patches:[...]} (backup completo)
  const p=data.patch||(data.patches&&data.patches.find(Boolean));
  if(!p||!p.effects){st('Formato de patch inválido','s-err');return;}
  const target=slot>=0?slot:0;
  if(!confirm(`Importar "${p.name||'(sem nome)'}" para o slot ${target+1}?`))return;
  p.slot=target;
  if(!p.effects.every(fx=>fx.paramValues))
    p.effects.forEach(fx=>{if(!fx.isEmpty)fx.paramValues=readParamValues(fx);});
  patches[target]=p;
  renderItem(target,p);
  openEditor(target);
  st(`patch importado → slot ${target+1}`,'s-ok');
  Storage.scheduleAutoSave(patches,dev);
};

// SHARE: gera link com patch codificado no hash da URL
if(BSHARE) BSHARE.onclick=()=>{
  if(slot<0||!patches[slot]){st('Abra um patch para compartilhar','s-warn');return;}
  const p=patches[slot];
  const payload=btoa(JSON.stringify({v:3,p}));
  const url=location.href.split('#')[0]+'#share='+payload;
  navigator.clipboard.writeText(url).then(()=>{
    st('Link copiado para a área de transferência','s-ok');
  }).catch(()=>{
    prompt('Copie o link:',url);
  });
};

// Ao carregar: verificar se há patch compartilhado no hash
(()=>{
  const hash=location.hash;
  if(!hash.startsWith('#share='))return;
  try{
    const data=JSON.parse(atob(hash.slice(7)));
    const p=data.p;if(!p||!p.effects)return;
    // Mostrar modal com opção de importar
    const modal=document.createElement('div');
    modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:2000;display:flex;align-items:center;justify-content:center';
    modal.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--r2);padding:24px;max-width:380px;text-align:center">
      <div style="font-family:var(--mono);font-size:.75rem;color:var(--accent);margin-bottom:12px">◈ PATCH COMPARTILHADO</div>
      <div style="font-size:1rem;font-weight:600;margin-bottom:6px">${esc(p.name||'(sem nome)')}</div>
      <div style="font-size:.7rem;color:var(--text3);margin-bottom:18px">${p.effects.filter(f=>!f.isEmpty).length} efeitos</div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button id="sh-imp" style="font-family:var(--mono);font-size:.72rem;padding:7px 16px;background:var(--accent);color:#fff;border:none;border-radius:var(--r);cursor:pointer">IMPORTAR</button>
        <button id="sh-cancel" style="font-family:var(--mono);font-size:.72rem;padding:7px 16px;background:transparent;color:var(--text3);border:1px solid var(--border2);border-radius:var(--r);cursor:pointer">IGNORAR</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#sh-imp').onclick=()=>{
      const target=slot>=0?slot:0;
      p.slot=target;
      if(!p.effects.every(fx=>fx.paramValues))
        p.effects.forEach(fx=>{if(!fx.isEmpty)fx.paramValues=readParamValues(fx);});
      patches[target]=p;
      renderItem(target,p);
      openEditor(target);
      st(`patch compartilhado importado → slot ${target+1}`,'s-ok');
      modal.remove();
      history.replaceState(null,'',location.pathname);
    };
    modal.querySelector('#sh-cancel').onclick=()=>{modal.remove();history.replaceState(null,'',location.pathname);};
  }catch(e){console.warn('share parse error',e);}
})();

// ── TUNER UI ─────────────────────────────────────────────────────────
const NOTE_NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function showTuner(){
  document.getElementById('tuner-modal')?.remove();
  const modal=document.createElement('div');
  modal.id='tuner-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1500;display:flex;align-items:center;justify-content:center';

  const box=document.createElement('div');
  box.style.cssText='background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r2);padding:28px 36px;min-width:320px;text-align:center;position:relative';

  box.innerHTML=`
    <div style="font-family:var(--mono);font-size:.65rem;color:var(--text3);letter-spacing:2px;margin-bottom:20px">◈ AFINADOR</div>
    <div id="tn-note" style="font-family:var(--mono);font-size:3.5rem;font-weight:700;color:var(--green);line-height:1;margin-bottom:8px">--</div>
    <div id="tn-cents" style="font-family:var(--mono);font-size:.85rem;color:var(--text2);margin-bottom:20px">± 0 cents</div>
    <div id="tn-bar-wrap" style="width:240px;margin:0 auto 24px;position:relative;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden">
      <div id="tn-bar" style="position:absolute;top:0;width:4px;height:100%;background:var(--green);border-radius:2px;left:50%;transform:translateX(-50%);transition:left .08s"></div>
      <div style="position:absolute;top:0;left:50%;width:2px;height:100%;background:var(--border2)"></div>
    </div>
    <button id="tn-close" style="font-family:var(--mono);font-size:.72rem;padding:7px 20px;background:transparent;color:var(--red);border:1px solid rgba(239,68,68,.3);border-radius:var(--r);cursor:pointer">FECHAR</button>
  `;

  modal.appendChild(box);
  document.body.appendChild(modal);

  // Ligar tuner via engine
  tunerOn().catch(e=>st(e.message,'s-err'));
  const btnT=document.getElementById('btn-tuner');
  if(btnT) btnT.style.background='rgba(16,185,129,.15)';

  // Receber dados do tuner via sistema de eventos do engine
  const tunerHandler=({note,cents})=>{
    const noteName=NOTE_NAMES[note%12];
    const inTune=Math.abs(cents)<=2;
    const color=inTune?'var(--green)':Math.abs(cents)<10?'var(--amber)':'var(--red)';
    const noteEl=document.getElementById('tn-note');
    const centsEl=document.getElementById('tn-cents');
    const bar=document.getElementById('tn-bar');
    if(noteEl){noteEl.textContent=noteName;noteEl.style.color=color;}
    if(centsEl){centsEl.textContent=(cents>=0?'+':'')+cents+' cents';centsEl.style.color=color;}
    if(bar){
      const pct=50+Math.max(-50,Math.min(50,cents));
      bar.style.left=pct+'%';
      bar.style.background=color;
    }
  };
  on('tuner',tunerHandler);

  const close=()=>{
    // Remover listener de tuner
    const idx=(evs['tuner']||[]).indexOf(tunerHandler);
    if(idx>=0)evs['tuner'].splice(idx,1);
    tunerOff().catch(()=>{});
    const btn=document.getElementById('btn-tuner');
    if(btn)btn.style.background='';
    modal.remove();
  };
  modal.onclick=e=>{if(e.target===modal)close();};
  document.getElementById('tn-close').onclick=close;
}

// ── TAP TEMPO UI ─────────────────────────────────────────────────────
function showTapTempo(){
  document.getElementById('tap-modal')?.remove();
  const modal=document.createElement('div');
  modal.id='tap-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1500;display:flex;align-items:center;justify-content:center';

  const box=document.createElement('div');
  box.style.cssText='background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r2);padding:28px 36px;min-width:300px;text-align:center';

  box.innerHTML=`
    <div style="font-family:var(--mono);font-size:.65rem;color:var(--text3);letter-spacing:2px;margin-bottom:20px">◈ TAP TEMPO</div>
    <div id="tap-bpm" style="font-family:var(--mono);font-size:3rem;font-weight:700;color:var(--amber);margin-bottom:6px">--</div>
    <div style="font-family:var(--mono);font-size:.65rem;color:var(--text3);margin-bottom:20px">BPM</div>
    <button id="tap-btn" style="width:140px;height:140px;border-radius:50%;background:rgba(245,158,11,.08);border:2px solid rgba(245,158,11,.3);color:var(--amber);font-family:var(--mono);font-size:.85rem;cursor:pointer;transition:all .1s;outline:none">TAP</button>
    <div style="margin-top:16px;display:flex;align-items:center;justify-content:center;gap:10px">
      <span style="font-family:var(--mono);font-size:.65rem;color:var(--text3)">BPM manual:</span>
      <input id="tap-input" type="number" min="40" max="250" style="width:70px;background:var(--surface);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:.8rem;padding:4px 8px;border-radius:var(--r);text-align:center" placeholder="40-250"/>
      <button id="tap-set" style="font-family:var(--mono);font-size:.65rem;padding:4px 10px;background:transparent;color:var(--amber);border:1px solid rgba(245,158,11,.3);border-radius:var(--r);cursor:pointer">SET</button>
    </div>
    <div style="margin-top:12px;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap">
      <span style="font-family:var(--mono);font-size:.6rem;color:var(--text3)">Divisão:</span>
      ${['1♩','1/2♩','1/4♩','2♩','3♩'].map((d,i)=>
        `<button class="tap-div" data-div="${[1,0.5,0.25,2,3][i]}" style="font-family:var(--mono);font-size:.6rem;padding:3px 8px;background:transparent;color:var(--text2);border:1px solid var(--border2);border-radius:var(--r);cursor:pointer">${d}</button>`
      ).join('')}
    </div>
    <div style="margin-top:16px;display:flex;gap:10px;justify-content:center">
      <button id="tap-send" style="font-family:var(--mono);font-size:.72rem;padding:7px 16px;background:var(--amber);color:#000;border:none;border-radius:var(--r);cursor:pointer;font-weight:700">ENVIAR</button>
      <button id="tap-close" style="font-family:var(--mono);font-size:.72rem;padding:7px 16px;background:transparent;color:var(--text3);border:1px solid var(--border2);border-radius:var(--r);cursor:pointer">FECHAR</button>
    </div>
  `;

  modal.appendChild(box);
  document.body.appendChild(modal);

  let taps=[],currentBpm=null;
  const bpmEl=document.getElementById('tap-bpm');

  document.getElementById('tap-btn').onclick=function(){
    const now=Date.now();
    taps.push(now);
    if(taps.length>8)taps=taps.slice(-8);
    this.style.background='rgba(245,158,11,.25)';
    setTimeout(()=>this.style.background='rgba(245,158,11,.08)',120);
    if(taps.length>=2){
      const intervals=[];
      for(let i=1;i<taps.length;i++)intervals.push(taps[i]-taps[i-1]);
      const avg=intervals.reduce((a,b)=>a+b,0)/intervals.length;
      currentBpm=Math.round(60000/avg);
      bpmEl.textContent=currentBpm;
    }
  };

  document.getElementById('tap-set').onclick=()=>{
    const v=parseInt(document.getElementById('tap-input').value);
    if(v>=40&&v<=250){currentBpm=v;bpmEl.textContent=v;}
    else st('BPM deve ser entre 40 e 250','s-warn');
  };

  document.getElementById('tap-send').onclick=async()=>{
    if(!currentBpm){st('Toque TAP ou defina o BPM primeiro','s-warn');return;}
    const effectiveBpm = Math.round(currentBpm * divFactor);
    // 1. Enviar BPM ao relógio interno do pedal (para efeitos com param Sync)
    if(dev) setTempo(effectiveBpm).catch(()=>{});
    // 2. Injetar BPM calculado nos parâmetros de tempo/rate do patch atual
    if(slot>=0&&patches[slot]){
      const injected=injectBpmToParams(patches[slot],effectiveBpm);
      if(injected.length>0){
        openEditor(slot); // re-renderizar com novos valores
        st(`BPM ${effectiveBpm} → pedal + injetado em: ${injected.join(', ')}`, 's-ok');
      } else if(dev){
        st(`BPM ${effectiveBpm} enviado ao pedal`, 's-ok');
      } else {
        st('Nenhum param de tempo no patch atual. Abra um patch primeiro.','s-warn');
      }
    } else if(dev){
      setTempo(currentBpm).catch(()=>{});
      st(`BPM ${currentBpm} enviado ao pedal`,'s-ok');
    }
  };

  // Seletor de divisão rítmica — multiplicar/dividir o BPM
  let divFactor = 1;
  box.querySelectorAll('.tap-div').forEach(btn => {
    btn.onclick = () => {
      box.querySelectorAll('.tap-div').forEach(b => b.style.background='transparent');
      btn.style.background = 'rgba(245,158,11,.2)';
      divFactor = parseFloat(btn.dataset.div);
      if (currentBpm) bpmEl.textContent = Math.round(currentBpm * divFactor);
    };
  });

  // Ajustar exibição de BPM quando divisão muda
  const origTapClick = document.getElementById('tap-btn').onclick;
  document.getElementById('tap-btn').onclick = function() {
    const now = Date.now();
    taps.push(now);
    if (taps.length > 8) taps = taps.slice(-8);
    this.style.background = 'rgba(245,158,11,.25)';
    setTimeout(() => this.style.background = 'rgba(245,158,11,.08)', 120);
    if (taps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i-1]);
      const avg = intervals.reduce((a,b) => a+b, 0) / intervals.length;
      currentBpm = Math.round(60000 / avg);
      bpmEl.textContent = Math.round(currentBpm * divFactor);
    }
  };

  const close=()=>modal.remove();
  modal.onclick=e=>{if(e.target===modal)close();};
  document.getElementById('tap-close').onclick=close;
}

// ── PEDAL DE EXPRESSÃO UI ────────────────────────────────────────────
function showPedalAssign(p){
  document.getElementById('pedal-modal')?.remove();
  // Listar parâmetros que têm flag p=true
  const assignable=[];
  p.effects.forEach((fx,fi)=>{
    if(fx.isEmpty)return;
    const db=fxInfo(fx.name);if(!db)return;
    db.params.forEach((pm,pi)=>{
      if(pm.p) assignable.push({fx,fi,pm,pi,name:`Slot ${fi+1}: ${fx.name} › ${pm.n}`});
    });
  });

  const modal=document.createElement('div');
  modal.id='pedal-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1500;display:flex;align-items:center;justify-content:center';

  const box=document.createElement('div');
  box.style.cssText='background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r2);padding:24px;width:400px;max-height:80vh;display:flex;flex-direction:column';

  if(!assignable.length){
    box.innerHTML=`<div style="font-family:var(--mono);font-size:.75rem;color:var(--text3);text-align:center;padding:20px">
      Nenhum parâmetro do patch atual é assignável ao pedal de expressão.<br><br>
      <span style="font-size:.6rem;opacity:.7">Parâmetros assignáveis são marcados com P nos cards de efeito.</span>
    </div>
    <button id="ped-close" style="align-self:center;margin-top:12px;font-family:var(--mono);font-size:.72rem;padding:6px 16px;background:transparent;color:var(--text3);border:1px solid var(--border2);border-radius:var(--r);cursor:pointer">FECHAR</button>`;
    modal.appendChild(box);document.body.appendChild(modal);
    modal.onclick=e=>{if(e.target===modal)modal.remove();};
    box.querySelector('#ped-close').onclick=()=>modal.remove();
    return;
  }

  box.innerHTML=`
    <div style="font-family:var(--mono);font-size:.65rem;color:var(--accent2);letter-spacing:2px;margin-bottom:16px">◈ PEDAL DE EXPRESSÃO · ${esc(p.name||'patch')}</div>
    <div style="font-size:.72rem;color:var(--text2);margin-bottom:16px">Selecione o parâmetro e defina os valores mínimo (heel) e máximo (toe):</div>
    <select id="ped-sel" style="background:var(--surface);border:1px solid var(--border2);color:var(--text);font-family:var(--sans);font-size:.8rem;padding:6px 10px;border-radius:var(--r);margin-bottom:14px">
      ${assignable.map((a,i)=>`<option value="${i}">${esc(a.name)}</option>`).join('')}
    </select>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      <div>
        <div style="font-family:var(--mono);font-size:.6rem;color:var(--text3);margin-bottom:4px">MÍN (heel) 0-127</div>
        <input id="ped-min" type="number" min="0" max="127" value="0" style="width:100%;background:var(--surface);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:.8rem;padding:6px 8px;border-radius:var(--r)"/>
      </div>
      <div>
        <div style="font-family:var(--mono);font-size:.6rem;color:var(--text3);margin-bottom:4px">MÁX (toe) 0-127</div>
        <input id="ped-max" type="number" min="0" max="127" value="127" style="width:100%;background:var(--surface);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:.8rem;padding:6px 8px;border-radius:var(--r)"/>
      </div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button id="ped-apply" style="font-family:var(--mono);font-size:.72rem;padding:7px 16px;background:var(--accent2);color:#fff;border:none;border-radius:var(--r);cursor:pointer">APLICAR</button>
      <button id="ped-close" style="font-family:var(--mono);font-size:.72rem;padding:7px 16px;background:transparent;color:var(--text3);border:1px solid var(--border2);border-radius:var(--r);cursor:pointer">FECHAR</button>
    </div>
  `;

  modal.appendChild(box);document.body.appendChild(modal);
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
  box.querySelector('#ped-close').onclick=()=>modal.remove();
  box.querySelector('#ped-apply').onclick=async()=>{
    const idx=parseInt(box.querySelector('#ped-sel').value);
    const a=assignable[idx];
    const mn=parseInt(box.querySelector('#ped-min').value)||0;
    const mx=parseInt(box.querySelector('#ped-max').value)||127;
    try{
      await setPedalAssign(a.fi,a.pi,mn,mx);
      st(`Pedal: ${a.name} [${mn}–${mx}]`,'s-ok');
      modal.remove();
    }catch(e){st(e.message,'s-err');}
  };
}

// ── INJEÇÃO DE BPM NOS PARÂMETROS ────────────────────────────────────
// Dois tipos de parâmetros tempo-sincronizáveis (flag t:true no FX_DB):
//
// TIPO A — Parâmetro de TEMPO em ms (n contém "Time", max > 100)
//   Ex: Delay.Time (1-4000ms), StereoDly.TimeL (1-2000ms), TapeEcho.Time (1-2000ms)
//   Fórmula: ms = 60000 / bpm  (tempo de uma semínima)
//   Divisões rítmicas comuns: x1(1♩), x1/2(♪), x1/4, x2(♩.♩), x3/4
//   → Injeta o valor em ms diretamente no param, convertido para raw via displayToRaw
//
// TIPO B — Parâmetro de RATE (velocidade, Hz interno, 0-50 ou 0-100)
//   Ex: Tremolo.Rate (0-50), Phaser.Rate (1-50), Flanger.Rate (0-50)
//   Fórmula: o pedal usa rate interno proporcional ao bpm
//   Rate interno ≈ bpm/60 × fator_de_escala
//   Para range 0-50: rate = round(bpm / 6)  (empiricamente: BPM=120→rate=20)
//   Para range 0-100: rate = round(bpm / 3)
//
// TIPO C — Parâmetro "Sync" (figura rítmica, OFF/♩/♩x2...)
//   Ex: StompDly.Sync, CarbonDly.Sync
//   Esses são tratados pelo relógio interno (setTempo via SysEx 0x60) — não precisam de injeção

function injectBpmToParams(p, bpm) {
  const injected = [];
  const msPerBeat = Math.round(60000 / bpm); // ms por semínima

  p.effects.forEach((fx, fi) => {
    if (fx.isEmpty) return;
    const db = fxInfo(fx.name);
    if (!db) return;

    db.params.forEach((pm, pi) => {
      if (!pm.t) return; // só parâmetros marcados com t:true

      const pname = pm.n.toLowerCase();
      const pmMax = pm.max !== undefined ? pm.max : 127;
      const pmMin = pm.min !== undefined ? pm.min : 0;

      let newDisplay = null;

      // TIPO A: parâmetro de tempo em ms
      // Detectar por nome (time, delay) OU por range > 200ms
      const isTimeMs = (pname.includes('time') || pname.includes('delay') && !pname.includes('hid'))
                       && pmMax > 200;

      // TIPO C: parâmetro Sync (figura rítmica 0=OFF, 1-15=♩/♩x2...)
      // Não injetar — é controlado pelo SysEx 0x60
      const isSync = pname === 'sync';

      if (isSync) return; // deixar o setTempo() cuidar

      if (isTimeMs) {
        // Clamp ao range do efeito
        newDisplay = Math.max(pmMin, Math.min(pmMax, msPerBeat));
      } else {
        // TIPO B: parâmetro de rate/speed em escala interna
        // Heurística: normalizar BPM (40-250) para o range do parâmetro
        // BPM 120 → ~meio do range; proporcional
        const rangeMid = (pmMax - pmMin) / 2 + pmMin;
        const bpmNorm = (bpm - 40) / (250 - 40); // 0..1
        newDisplay = Math.round(pmMin + bpmNorm * (pmMax - pmMin));
        newDisplay = Math.max(pmMin, Math.min(pmMax, newDisplay));
      }

      if (newDisplay === null) return;

      // Converter para raw e injetar
      const newRaw = displayToRaw(newDisplay, pm);
      if (!fx.paramValues) fx.paramValues = readParamValues(fx);
      fx.paramValues[pi] = newRaw;

      // Sincronizar fx.params[] e raw payload
      if (fx.params) fx.params[6 + pi] = newRaw;
      if (p.raw) {
        const u = zoomUnpack(p.raw);
        const ui = fi * 23 + 6 + pi;
        const g = Math.floor(ui / 8), pos = ui % 8, mPos = g * 8;
        if (pos === 0) u[mPos] = (u[mPos] & 0x80) | (newRaw & 0x7F);
        else u[mPos + pos] = (u[mPos + pos] & 0x80) | (newRaw & 0x7F);
        p.raw = zoomPack(u);
      }

      injected.push(`${fx.name}.${pm.n}=${newDisplay}`);
    });
  });

  if(injected.length>0) L.op(`BPM ${bpm} injetado em ${injected.length} parâmetro(s)`, injected.join(' | '));
  else L.debug(`BPM ${bpm}: nenhum parâmetro de tempo encontrado no patch atual`);
  Storage.scheduleAutoSave(patches, dev);
  return injected;
}
