// G1on Editor · Storage v2
// Salvamento local com redundância: IndexedDB (primário) + localStorage (fallback)
// API exposta em window.Storage
'use strict';
const Storage=(()=>{
  const DB_NAME='g1on_editor',DB_VER=2;
  const S_PATCHES='patches',S_BACKUPS='backups';
  const LS_P='g1on_patches_v1',LS_BM='g1on_backups_meta_v1';
  const MAX_BKP=20, AS_MS=2000;
  let _db=null,_timer=null,_dirty=false,_onDirty=null;

  // ── IndexedDB ───────────────────────────────────────────────────────
  function _open(){
    return new Promise((res,rej)=>{
      if(_db){res(_db);return;}
      const r=indexedDB.open(DB_NAME,DB_VER);
      r.onupgradeneeded=e=>{
        const db=e.target.result;
        if(!db.objectStoreNames.contains(S_PATCHES))
          db.createObjectStore(S_PATCHES,{keyPath:'key'});
        if(!db.objectStoreNames.contains(S_BACKUPS)){
          const s=db.createObjectStore(S_BACKUPS,{keyPath:'id',autoIncrement:true});
          s.createIndex('ts','ts');
        }
      };
      r.onsuccess=e=>{_db=e.target.result;res(_db);};
      r.onerror=e=>rej(e.target.error);
    });
  }
  const _op=fn=>new Promise((res,rej)=>{const r=fn();r.onsuccess=()=>res(r.result);r.onerror=e=>rej(e.target.error);});
  const _tx=(s,m)=>_open().then(db=>db.transaction(s,m).objectStore(s));
  const _get=(s,k)=>_tx(s,'readonly').then(os=>_op(()=>os.get(k)));
  const _put=(s,v)=>_tx(s,'readwrite').then(os=>_op(()=>os.put(v)));
  const _del=(s,k)=>_tx(s,'readwrite').then(os=>_op(()=>os.delete(k)));
  const _all=(s)=>_tx(s,'readonly').then(os=>_op(()=>os.getAll()));
  const _clr=(s)=>_tx(s,'readwrite').then(os=>_op(()=>os.clear()));

  // ── Serialização ─────────────────────────────────────────────────
  function _ser(p){
    if(!p)return null;
    return{slot:p.slot,name:p.name,raw:p.raw,
      effects:(p.effects||[]).map(fx=>({
        name:fx.name,cat:fx.cat,isEmpty:fx.isEmpty,en:fx.en,
        b0:fx.b0,b1:fx.b1,b3:fx.b3,paramValues:fx.paramValues||[]
      }))};
  }
  function _payload(patches,dev){
    return{key:'current',version:1,ts:Date.now(),
      device:dev||null,patches:(patches||[]).map(_ser)};
  }

  // ── Save / Load ─────────────────────────────────────────────────
  async function savePatches(patches,dev){
    const d=_payload(patches,dev);
    const[r1,r2]=await Promise.allSettled([
      _put(S_PATCHES,d),
      Promise.resolve(localStorage.setItem(LS_P,JSON.stringify(d)))
    ]);
    _setDirty(false);
    return{idb:r1.status==='fulfilled',ls:r2.status==='fulfilled'};
  }

  async function loadPatches(){
    try{const r=await _get(S_PATCHES,'current');if(r?.patches)return r;}
    catch(e){console.warn('[Storage] IDB falhou:',e);}
    try{
      const raw=localStorage.getItem(LS_P);
      if(raw){const d=JSON.parse(raw);_put(S_PATCHES,d).catch(()=>{});return d;}
    }catch(e){console.warn('[Storage] LS falhou:',e);}
    return null;
  }

  // ── Backups ─────────────────────────────────────────────────────
  async function createBackup(patches,dev,label){
    const b={version:1,ts:Date.now(),
      label:label||new Date().toLocaleString('pt-BR'),
      device:dev||null,patches:(patches||[]).map(_ser)};
    const id=await _put(S_BACKUPS,b);
    b.id=id;
    const meta=_getMeta();
    meta.unshift({id,ts:b.ts,label:b.label,device:b.device?.name||''});
    if(meta.length>MAX_BKP)meta.splice(MAX_BKP);
    localStorage.setItem(LS_BM,JSON.stringify(meta));
    _prune().catch(()=>{});
    return b;
  }

  async function listBackups(){
    try{const a=await _all(S_BACKUPS);return a.sort((a,b)=>b.ts-a.ts);}
    catch{return _getMeta();}
  }

  async function loadBackup(id){return _get(S_BACKUPS,+id);}

  async function deleteBackup(id){
    await _del(S_BACKUPS,+id);
    const m=_getMeta().filter(x=>x.id!==+id);
    localStorage.setItem(LS_BM,JSON.stringify(m));
  }

  function _getMeta(){
    try{return JSON.parse(localStorage.getItem(LS_BM)||'[]');}catch{return[];}
  }

  async function _prune(){
    const a=await _all(S_BACKUPS);
    if(a.length<=MAX_BKP)return;
    const old=a.sort((a,b)=>a.ts-b.ts).slice(0,a.length-MAX_BKP);
    await Promise.all(old.map(b=>_del(S_BACKUPS,b.id)));
  }

  // ── Export / Import arquivo ──────────────────────────────────────
  function exportToFile(patches,dev,label){
    const d={version:1,format:'g1on-editor',timestamp:new Date().toISOString(),
      label:label||'',device:dev||null,patches:(patches||[]).map(_ser)};
    const blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=Object.assign(document.createElement('a'),{
      href:url,
      download:`${(dev?.name||'G1on').replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.json`
    });
    document.body.appendChild(a);a.click();
    setTimeout(()=>{URL.revokeObjectURL(url);document.body.removeChild(a);},1000);
  }

  function importFromFile(file){
    return new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=e=>{
        try{
          const d=JSON.parse(e.target.result);
          if(!d.patches){rej(new Error('Formato inválido: campo patches ausente'));return;}
          res(d);
        }catch(err){rej(new Error('JSON inválido: '+err.message));}
      };
      r.onerror=()=>rej(new Error('Erro ao ler arquivo'));
      r.readAsText(file);
    });
  }

  // ── Auto-save ────────────────────────────────────────────────────
  function scheduleAutoSave(patches,dev){
    _setDirty(true);
    clearTimeout(_timer);
    _timer=setTimeout(()=>{
      savePatches(patches,dev)
        .then(()=>console.log('[Storage] auto-save ok'))
        .catch(e=>console.warn('[Storage] auto-save falhou:',e));
    },AS_MS);
  }

  function cancelAutoSave(){clearTimeout(_timer);}

  // ── Dirty flag ───────────────────────────────────────────────────
  function _setDirty(v){_dirty=v;if(_onDirty)_onDirty(_dirty);}
  function isDirty(){return _dirty;}
  function onDirtyChange(cb){_onDirty=cb;}

  // ── Health check ─────────────────────────────────────────────────
  async function storageHealth(){
    const h={idb:false,ls:false,backupCount:0};
    try{await _open();h.idb=true;}catch{}
    try{h.ls=!!localStorage.getItem(LS_P);}catch{}
    try{h.backupCount=(await _all(S_BACKUPS)).length;}catch{}
    return h;
  }

  async function clearAll(){
    await Promise.allSettled([_clr(S_PATCHES),_clr(S_BACKUPS),
      Promise.resolve(localStorage.removeItem(LS_P)),
      Promise.resolve(localStorage.removeItem(LS_BM))]);
    _setDirty(false);
  }

  return{
    savePatches,loadPatches,
    createBackup,listBackups,loadBackup,deleteBackup,
    exportToFile,importFromFile,
    scheduleAutoSave,cancelAutoSave,
    isDirty,onDirtyChange,
    storageHealth,clearAll
  };
})();

window.Storage=Storage;
