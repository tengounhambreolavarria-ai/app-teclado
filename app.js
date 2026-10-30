(function(){
const {useState,useRef,useEffect}=React;const html=htm.bind(React.createElement);
/* ============ MOTOR DE AUDIO ============ */
const AC=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});
const comp=AC.createDynamicsCompressor(),master=AC.createGain();master.gain.value=.8;comp.connect(master);master.connect(AC.destination);

function parseSF2(buf){
  const u8=new Uint8Array(buf),dv=new DataView(buf);
  const str=(o,n)=>{let s='';for(let i=0;i<n&&u8[o+i];i++)s+=String.fromCharCode(u8[o+i]);return s};
  let smpl=null;const c={};
  const walk=(o,e)=>{while(o+8<=e){const id=str(o,4),sz=dv.getUint32(o+4,true);
    if(id==='LIST'){const t=str(o+8,4);if(t==='sdta'||t==='pdta')walk(o+12,o+8+sz)}
    else if(id==='smpl')smpl=new Int16Array(buf,o+8,sz>>1);else c[id]=[o+8,sz];
    o+=8+sz+(sz&1)}};
  walk(12,buf.byteLength);
  if(!smpl||!c.phdr||!c.shdr)throw new Error('SF2 inválido');
  const rd=(k,sz,f)=>{const[o,l]=c[k],a=[];for(let i=0;i<l/sz;i++)a.push(f(o+i*sz));return a};
  const g=o=>({op:dv.getUint16(o,true),lo:u8[o+2],hi:u8[o+3],s:dv.getInt16(o+2,true),u:dv.getUint16(o+2,true)});
  const phdr=rd('phdr',38,o=>({name:str(o,20),preset:dv.getUint16(o+20,true),bank:dv.getUint16(o+22,true),bag:dv.getUint16(o+24,true)}));
  const pbag=rd('pbag',4,o=>dv.getUint16(o,true)),pgen=rd('pgen',4,g);
  const inst=rd('inst',22,o=>dv.getUint16(o+20,true)),ibag=rd('ibag',4,o=>dv.getUint16(o,true)),igen=rd('igen',4,g);
  const shdr=rd('shdr',46,o=>({s:dv.getUint32(o+20,true),e:dv.getUint32(o+24,true),ls:dv.getUint32(o+28,true),le:dv.getUint32(o+32,true),rate:dv.getUint32(o+36,true),pitch:u8[o+40],corr:dv.getInt8(o+41)}));
  const zones=(bag,gen,b0,b1)=>{const z=[];for(let j=b0;j<b1;j++){const o={};for(let k=bag[j];k<bag[j+1];k++)o[gen[k].op]=gen[k];z.push(o)}return z};
  const presets=[];
  for(let i=0;i<phdr.length-1;i++){
    const out=[];let pg={};
    zones(pbag,pgen,phdr[i].bag,phdr[i+1].bag).forEach((z,zi)=>{
      if(!z[41]){if(zi===0)pg=z;return}
      const ii=z[41].u;let ig={};
      zones(ibag,igen,inst[ii],inst[ii+1]).forEach((y,yi)=>{
        if(!y[53]){if(yi===0)ig=y;return}
        const G=n=>y[n]||ig[n]||{},P=n=>z[n]||pg[n]||{},sh=shdr[y[53].u];if(!sh)return;
        const kr=G(43),vr=G(44),pk=P(43),pv=P(44),ro=G(58).s;
        out.push({lo:Math.max(kr.lo??0,pk.lo??0),hi:Math.min(kr.hi??127,pk.hi??127),vlo:Math.max(vr.lo??0,pv.lo??0),vhi:Math.min(vr.hi??127,pv.hi??127),sh,
          root:ro!==undefined&&ro>=0?ro:sh.pitch,tune:(G(51).s||0)*100+(G(52).s||0)+sh.corr+(P(51).s||0)*100+(P(52).s||0),
          loop:((G(54).u||0)&1)===1,att:G(34).s??-12000,rel:G(38).s??-12000,atten:Math.min(G(48).s||0,900)});
      });
    });
    if(out.length)presets.push({name:`${String(phdr[i].bank).padStart(3,'0')}:${String(phdr[i].preset).padStart(3,'0')} ${phdr[i].name}`,zones:out,o:phdr[i].bank*1000+phdr[i].preset});
  }
  presets.sort((a,b)=>a.o-b.o);
  return{smpl,presets};
}
const bufOf=(sf,sh)=>sh._b||(sh._b=(()=>{const n=Math.max(sh.e-sh.s,1),b=AC.createBuffer(1,n,Math.max(sh.rate||44100,8000)),d=b.getChannelData(0);for(let i=0;i<n;i++)d[i]=sf.smpl[sh.s+i]/32768;return b})());
const warm=(sf,pi)=>setTimeout(()=>{try{sf.presets[pi].zones.forEach(z=>bufOf(sf,z.sh))}catch(e){}},0);

const voices={};
function noteOn(sf,pi,note,vel,key){
  const t=AC.currentTime,list=voices[key]=voices[key]||[];
  sf.presets[pi].zones.filter(z=>note>=z.lo&&note<=z.hi&&vel>=z.vlo&&vel<=z.vhi).forEach(z=>{
    const s=AC.createBufferSource(),g=AC.createGain();s.buffer=bufOf(sf,z.sh);
    s.playbackRate.value=2**(((note-z.root)*100+z.tune)/1200);
    if(z.loop){s.loop=true;s.loopStart=(z.sh.ls-z.sh.s)/s.buffer.sampleRate;s.loopEnd=(z.sh.le-z.sh.s)/s.buffer.sampleRate}
    const lvl=(vel/127)**2*10**(-z.atten/200),att=Math.min(2**(z.att/1200),2);
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(lvl,t+Math.max(att,.003));
    s.connect(g);g.connect(comp);s.start(t);s.onended=()=>g.disconnect();
    list.push({s,g,rel:Math.min(Math.max(2**(z.rel/1200),.06),3)});
  });
}
function noteOff(key){
  const t=AC.currentTime;(voices[key]||[]).forEach(v=>{try{v.g.gain.cancelScheduledValues(t);v.g.gain.setTargetAtTime(0,t,v.rel/4);v.s.stop(t+v.rel+.1)}catch(e){}});voices[key]=[];
}

const PAL=['#74ACDF','#F6B40E','#ef4444','#e879f9','#34d399','#fb923c','#a78bfa','#f472b6'];
const rid=()=>Math.random().toString(36).slice(2,8);
const mkS=()=>({id:'s'+rid(),label:'Sonido',sfName:'',pi:0});
const mkA=(n,i)=>({id:'a'+rid(),name:n,icon:i,img:'',sounds:[mkS()]});
const mkCfg=()=>[
 {id:'g1',name:'ROCK',icon:'🎸',color:'#74ACDF',artists:[mkA('Soda Stereo','🛸'),mkA('Charly García','🎹'),mkA('Spinetta','🌙'),mkA('Los Redondos','🔥')]},
 {id:'g2',name:'CUMBIA',icon:'🪗',color:'#F6B40E',artists:[mkA('Rodrigo','🏆'),mkA('Gilda','🌹'),mkA('Los Palmeras','🌴'),mkA('Amar Azul','💙')]},
 {id:'g3',name:'CUMBIA VILLERA',icon:'😎',color:'#ef4444',artists:[mkA('Pibes Chorros','🚨'),mkA('Damas Gratis','💃'),mkA('Yerba Brava','🧉'),mkA('Meta Guacha','🔥')]},
 {id:'g4',name:'REGGAETÓN',icon:'🔊',color:'#e879f9',artists:[mkA('Duki','🦅'),mkA('Bizarrap','🎧'),mkA('Tini','⭐'),mkA('Nicki Nicole','💜')]}];
const loadCfg=()=>{try{return JSON.parse(localStorage.getItem('keytar-cfg2'))||mkCfg()}catch(e){return mkCfg()}};
const LO=48,HI=72,WHITE=[0,2,4,5,7,9,11],NN=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function shrink(file,cb){const r=new FileReader();r.onload=()=>{const im=new Image();im.onload=()=>{const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d'),m=Math.min(im.width,im.height);x.drawImage(im,(im.width-m)/2,(im.height-m)/2,m,m,0,0,128,128);cb(c.toDataURL('image/jpeg',.8))};im.src=r.result};r.readAsDataURL(file)}
const Btn=({on,color,className='',...p})=>html`<button ...${p} style=${on?{background:color||'#74ACDF',color:'#04141a',boxShadow:`0 0 18px ${color||'#74ACDF'}88`}:{}} className=${`rounded-xl font-bold tracking-wide active:scale-95 transition ${on?'':'bg-zinc-800 text-zinc-200 border border-zinc-700'} ${className}`}/>`;

function Keyboard({active,split,splitAt,onDown,onUp,oct}){
  const held=useRef(new Set()),keys=[];let wi=0;const W=100/15;
  for(let n=LO;n<=HI;n++){const pc=n%12,white=WHITE.includes(pc);keys.push({n,pc,white,wi:white?wi:wi-1});if(white)wi++}
  const h=n=>({onPointerDown:e=>{e.preventDefault();held.current.add(n);onDown(n)},onPointerUp:()=>{if(held.current.delete(n))onUp(n)},onPointerLeave:()=>{if(held.current.delete(n))onUp(n)},onPointerCancel:()=>{if(held.current.delete(n))onUp(n)}});
  const tint=n=>split&&n<splitAt?'#F6B40E':'#74ACDF';
  return html`<div className="relative w-full h-full select-none rounded-xl overflow-hidden bg-black border border-zinc-700">
    ${keys.filter(k=>k.white).map(k=>html`<div key=${k.n} className="key absolute top-0 bottom-0 border-r border-zinc-400 flex items-end justify-center pb-2 text-[11px] font-bold"
      style=${{left:k.wi*W+'%',width:W+'%',background:active.has(k.n)?tint(k.n):'#f4f4f5',color:'#333',outline:k.n===splitAt&&split?'3px solid #ef4444':'none',outlineOffset:-3}} ...${h(k.n)}>${k.pc===0?'C'+(Math.floor(k.n/12)-1+oct):''}</div>`)}
    ${keys.filter(k=>!k.white).map(k=>html`<div key=${k.n} className="key absolute top-0 h-[62%] rounded-b-md z-10 border border-black"
      style=${{left:(k.wi*W+W*.65)+'%',width:W*.7+'%',background:active.has(k.n)?tint(k.n):'#18181b',outline:k.n===splitAt&&split?'3px solid #ef4444':'none'}} ...${h(k.n)}/>`)}
  </div>`;
}

const inp="w-full bg-zinc-800 rounded-lg p-3 border border-zinc-700";
function Editor({kind,item,sfs,onSave,onDel,onClose}){
  const [p,setP]=useState(item),f=useRef(null);
  const setS=(id,patch)=>setP(q=>({...q,sounds:q.sounds.map(s=>s.id===id?{...s,...patch}:s)}));
  return html`<div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3" onClick=${onClose}>
    <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto scroll-thin rounded-2xl p-4 space-y-3 border border-sky-300/30" style=${{background:'#0b1730'}} onClick=${e=>e.stopPropagation()}>
      <div className="title text-lg">${kind==='group'?'EDITAR GRUPO':'EDITAR ARTISTA'}</div>
      <input value=${p.name} onChange=${e=>setP({...p,name:e.target.value})} placeholder="Nombre" className=${inp}/>
      <div className="flex gap-2 items-center flex-wrap">
        <input value=${p.icon} onChange=${e=>setP({...p,icon:e.target.value})} placeholder="🙂" className="w-20 bg-zinc-800 rounded-lg p-3 text-2xl text-center border border-zinc-700"/>
        ${kind==='artist'&&html`<input ref=${f} type="file" accept="image/*" className="hidden" onChange=${e=>e.target.files[0]&&shrink(e.target.files[0],d=>setP(q=>({...q,img:d})))}/>
          <${Btn} className="px-3 py-3 text-sm" onClick=${()=>f.current.click()}>🖼 Foto / logo<//>
          ${p.img&&html`<img src=${p.img} className="w-12 h-12 rounded-lg object-cover"/>`}
          ${p.img&&html`<button className="text-red-400 text-sm" onClick=${()=>setP({...p,img:''})}>quitar</button>`}`}
      </div>
      ${kind==='group'&&html`<div className="flex gap-2 flex-wrap">${PAL.map(c=>html`<button key=${c} onClick=${()=>setP({...p,color:c})} className="w-11 h-11 rounded-full" style=${{background:c,outline:p.color===c?'3px solid #fff':'none',outlineOffset:2}}/>`)}</div>`}
      ${kind==='artist'&&html`<div className="space-y-2"><div className="text-xs tracking-widest text-sky-300">SONIDOS (SF2) DE ESTE ARTISTA</div>
        ${p.sounds.map(s=>{const sf=sfs.find(x=>x.name===s.sfName);return html`<div key=${s.id} className="rounded-xl border border-zinc-700 p-2 space-y-2">
          <div className="flex gap-2"><input value=${s.label} onChange=${e=>setS(s.id,{label:e.target.value})} placeholder="Nombre del sonido (ej. Piano, Lead)" className=${inp}/>
            <button className="px-3 text-red-400" onClick=${()=>setP(q=>({...q,sounds:q.sounds.filter(x=>x.id!==s.id)}))}>✕</button></div>
          <select value=${s.sfName} onChange=${e=>setS(s.id,{sfName:e.target.value,pi:0})} className=${inp}><option value="">— elegir SF2 cargado —</option>
            ${sfs.map(x=>html`<option key=${x.id} value=${x.name}>${x.name}</option>`)}${s.sfName&&!sf&&html`<option value=${s.sfName}>${s.sfName} (sin cargar)</option>`}</select>
          ${sf&&html`<select value=${s.pi} onChange=${e=>setS(s.id,{pi:+e.target.value})} className=${inp}>${sf.presets.map((x,i)=>html`<option key=${i} value=${i}>${x.name}</option>`)}</select>`}</div>`})}
        <${Btn} className="w-full py-2 text-sm" onClick=${()=>setP(q=>({...q,sounds:[...q.sounds,mkS()]}))}>＋ Agregar sonido<//></div>`}
      <div className="flex gap-2"><${Btn} className="flex-1 py-3 text-red-400" onClick=${onDel}>Borrar<//><${Btn} className="flex-1 py-3" onClick=${onClose}>Cancelar<//><${Btn} on=${true} className="flex-1 py-3" onClick=${()=>onSave(p)}>Guardar<//></div>
    </div></div>`;
}

/* ============ PERSISTENCIA (IndexedDB) ============ */
const DB=new Promise((res,rej)=>{const r=indexedDB.open('keytar-live',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
const tx=async(m,f)=>{const d=await DB;return new Promise((res,rej)=>{const t=d.transaction('kv',m),q=f(t.objectStore('kv'));t.oncomplete=()=>res(q.result);t.onerror=()=>rej(t.error)})};
const kvGet=k=>tx('readonly',s=>s.get(k)),kvSet=(k,v)=>tx('readwrite',s=>s.put(v,k)),kvDel=k=>tx('readwrite',s=>s.delete(k)),kvKeys=()=>tx('readonly',s=>s.getAllKeys());
const lockScreen=async()=>{try{if(navigator.wakeLock&&!lockScreen.l){lockScreen.l=await navigator.wakeLock.request('screen');lockScreen.l.addEventListener('release',()=>lockScreen.l=null)}}catch(e){}};

function Track({i}){
  const au=useRef(null),inp=useRef(null);
  const [name,setName]=useState(''),[pl,setPl]=useState(false),[loop,setLoop]=useState(false),[vol,setVol]=useState(.9);
  const A=()=>au.current||(au.current=Object.assign(new Audio(),{preload:'auto'}));
  const setBlob=(b,n)=>{const a=A();if(a.src)URL.revokeObjectURL(a.src);a.src=URL.createObjectURL(b);setName(n);setPl(false)};
  useEffect(()=>{const a=A();a.onended=()=>setPl(false);kvGet('mp3:'+i).then(r=>{if(r)setBlob(r.blob,r.name)}).catch(()=>{})},[]);
  useEffect(()=>{A().loop=loop},[loop]);
  const load=async f=>{if(!f)return;const n=f.name.replace(/\.[^.]+$/,'');setBlob(f,n);try{await kvSet('mp3:'+i,{name:n,blob:f})}catch(e){}};
  const toggle=()=>{const a=A();if(!a.src)return inp.current.click();if(a.paused){a.play();setPl(true)}else{a.pause();setPl(false)}};
  const stop=()=>{const a=A();a.pause();a.currentTime=0;setPl(false)};
  const clear=()=>{stop();const a=A();if(a.src){URL.revokeObjectURL(a.src);a.removeAttribute('src');a.load()}setName('');kvDel('mp3:'+i)};
  return html`<div className="glass rounded-xl p-1.5 space-y-1">
    <input ref=${inp} type="file" accept="audio/*,.mp3" className="hidden" onChange=${e=>{load(e.target.files[0]);e.target.value=''}}/>
    <button onClick=${()=>inp.current.click()} className="w-full truncate text-left text-xs text-zinc-300 px-1">${i+1} · ${name||'＋ Cargar MP3'}</button>
    <div className="grid grid-cols-4 gap-1">
      <${Btn} on=${pl} color="#34d399" className="h-12 text-lg" onClick=${toggle}>${pl?'❚❚':'▶'}<//>
      <${Btn} className="h-12 text-lg" onClick=${stop}>■<//>
      <${Btn} on=${loop} color="#a78bfa" className="h-12 text-base" onClick=${()=>setLoop(l=>!l)}>🔁<//>
      <${Btn} className="h-12 text-sm text-red-400" onClick=${clear}>✕<//>
    </div>
    <input type="range" min="0" max="1" step=".01" value=${vol} className="w-full accent-sky-400 h-3" onChange=${e=>{setVol(+e.target.value);A().volume=+e.target.value}}/>
  </div>`;
}

function App(){
  const [cfg,setCfg]=useState(mkCfg),[gid,setGid]=useState('g1'),[ready,setReady]=useState(false),[selA,setSelA]=useState(null);
  const [sfs,setSfs]=useState([]),[sounds,setSounds]=useState({lower:null,upper:null}),[lib,setLib]=useState(false);
  const [split,setSplit]=useState(false),[splitAt,setSplitAt]=useState(60),[setting,setSetting]=useState(false),[target,setTarget]=useState('upper');
  const [oct,setOct]=useState(0),[active,setActive]=useState(new Set()),[midi,setMidi]=useState({ok:null,ins:[]});
  const [edit,setEdit]=useState(false),[editing,setEditing]=useState(null),[toast,setToast]=useState(''),[busy,setBusy]=useState('');
  const S=useRef({}),sus=useRef({on:false,keys:new Set()}),fileIn=useRef(null);
  S.current={sfs,sounds,split,splitAt,oct,setting};
  const say=m=>{setToast(m);setTimeout(()=>setToast(''),2300)};
  const zone=split?target:'upper';
  const grp=cfg.find(g=>g.id===gid)||cfg[0],art=grp?.artists.find(a=>a.id===selA);

  /* Carga inicial desde IndexedDB */
  useEffect(()=>{(async()=>{
    try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}
    try{const c=await kvGet('cfg');if(c&&c.cfg){setCfg(c.cfg);setGid(c.gid||c.cfg[0]?.id)}}catch(e){}
    setReady(true);
    try{const keys=(await kvKeys()).filter(k=>String(k).startsWith('sf2:'));
      for(const k of keys){const r=await kvGet(k);if(!r)continue;setBusy('Cargando '+r.name+'…');
        try{const p=parseSF2(await r.blob.arrayBuffer());setSfs(a=>[...a,{id:r.name+Date.now(),name:r.name,...p}])}catch(e){}}
    }catch(e){}
    setBusy('');
  })()},[]);
  useEffect(()=>{if(ready)kvSet('cfg',{cfg,gid}).catch(()=>{})},[cfg,gid,ready]);

  const play=(raw,vel=100)=>{
    const s=S.current;if(AC.state!=='running')AC.resume();
    if(s.setting){setSplitAt(raw);setSetting(false);say('Punto de split: '+NN[raw%12]+(Math.floor(raw/12)-1));return}
    setActive(a=>new Set(a).add(raw));
    const snd=s.sounds[s.split&&raw<s.splitAt?'lower':'upper'],sf=snd&&s.sfs.find(f=>f.id===snd.sfId);
    if(sf)noteOn(sf,snd.pi,raw+s.oct*12,vel,raw);
  };
  const stop=raw=>{setActive(a=>{const n=new Set(a);n.delete(raw);return n});if(sus.current.on)sus.current.keys.add(raw);else noteOff(raw)};
  useEffect(()=>{
    if(!navigator.requestMIDIAccess){setMidi({ok:false,ins:[]});return}
    navigator.requestMIDIAccess().then(m=>{
      const bind=()=>{const ins=[...m.inputs.values()];ins.forEach(i=>i.onmidimessage=e=>{
        const[st,d1,d2]=e.data,c=st&0xf0;
        if(c===0x90&&d2>0)play(d1,d2);else if(c===0x80||c===0x90)stop(d1);
        else if(c===0xB0&&d1===64){sus.current.on=d2>=64;if(!sus.current.on){sus.current.keys.forEach(noteOff);sus.current.keys.clear()}}
        else if(c===0xB0&&d1===123){Object.keys(voices).forEach(noteOff);setActive(new Set())}
      });setMidi({ok:true,ins:ins.map(i=>i.name)})};
      bind();m.onstatechange=bind;
    }).catch(()=>setMidi({ok:false,ins:[]}));
  },[]);

  const loadSF=async files=>{
    for(const f of files){setBusy('Procesando '+f.name+'…');
      try{const p=parseSF2(await f.arrayBuffer());
        try{await kvSet('sf2:'+f.name,{name:f.name,blob:f})}catch(e){say('No se pudo guardar '+f.name)}
        setSfs(a=>[...a.filter(x=>x.name!==f.name),{id:f.name+Date.now(),name:f.name,...p}]);say('SF2 guardado: '+f.name)}
      catch(e){say('Error con '+f.name)}}
    setBusy('');
  };
  const delSF=sf=>{setSfs(a=>a.filter(x=>x.id!==sf.id));kvDel('sf2:'+sf.name)};
  const applySound=(g,a,s)=>{
    const sf=sfs.find(f=>f.name===s.sfName);
    if(!sf)return say(s.sfName?'Falta el SF2: '+s.sfName:'Sin SF2 asignado. Usá EDITAR');
    const pi=Math.min(s.pi,sf.presets.length-1);warm(sf,pi);
    setSounds(o=>({...o,[zone]:{sfId:sf.id,pi,artistId:a.id,soundId:s.id,title:`${g.name} › ${a.name} › ${s.label}`}}));
  };
  const pickArtist=(g,a)=>{
    if(AC.state!=='running')AC.resume();
    if(edit)return setEditing({kind:'artist',item:a});
    setSelA(a.id);const s=a.sounds[0];if(s)applySound(g,a,s);else say('Este artista no tiene sonidos');
  };
  const direct=(sf,pi,z)=>{warm(sf,pi);setSounds(s=>({...s,[z]:{sfId:sf.id,pi,artistId:null,soundId:null,title:sf.presets[pi].name.slice(8)}}))};
  const updG=fn=>setCfg(c=>c.map(fn));
  const saveItem=p=>{if(editing.kind==='group')updG(g=>g.id===p.id?{...g,name:p.name,icon:p.icon,color:p.color}:g);
    else updG(g=>({...g,artists:g.artists.map(a=>a.id===p.id?p:a)}));setEditing(null)};
  const delItem=()=>{const{kind,item}=editing;
    if(kind==='group'){setCfg(c=>c.filter(g=>g.id!==item.id));setGid(cfg.find(g=>g.id!==item.id)?.id)}
    else updG(g=>({...g,artists:g.artists.filter(a=>a.id!==item.id)}));setEditing(null)};
  const fs=()=>{const d=document;d.fullscreenElement?d.exitFullscreen():d.documentElement.requestFullscreen&&d.documentElement.requestFullscreen()};
  const Z=z=>z==='lower'?'#F6B40E':'#74ACDF';

  return html`<div className="h-[100dvh] flex flex-col gap-1.5 p-1.5 overflow-hidden">
    <input ref=${fileIn} type="file" accept=".sf2" multiple className="hidden" onChange=${e=>{loadSF([...e.target.files]);e.target.value=''}}/>
    <!-- BARRA SUPERIOR -->
    <div className="glass flex items-center gap-1.5 rounded-2xl p-1.5 shrink-0 overflow-x-auto scroll-thin">
      <div className="flex items-center gap-1.5 px-1.5 shrink-0"><span className="text-2xl" style=${{filter:'drop-shadow(0 0 6px #F6B40E)'}}>☀️</span><div className="leading-none hidden sm:block"><div className="title text-base" style=${{color:'#74ACDF'}}>KEYTAR LIVE</div><div className="text-[9px] tracking-[.25em] text-zinc-400">ARG</div></div></div>
      <div className=${`shrink-0 text-[11px] px-2.5 py-1 rounded-full max-w-[9rem] truncate ${midi.ins.length?'bg-emerald-900/70 text-emerald-300':'bg-white/10 text-zinc-400'}`}>${midi.ok===false?'Sin Web MIDI':midi.ins.length?'🎹 '+midi.ins[0]:'Sin teclado'}</div>
      <div className="flex-1 min-w-2"></div>
      ${busy&&html`<div className="text-xs text-sky-300 shrink-0 animate-pulse">${busy}</div>`}
      <${Btn} className="h-12 px-3 text-sm shrink-0" onClick=${()=>setLib(true)}>📂 SF2 (${sfs.length})<//>
      <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1 shrink-0">
        <${Btn} className="h-12 w-12 text-2xl" onClick=${()=>setOct(o=>Math.max(-4,o-1))}>−<//>
        <div className="w-14 text-center leading-none"><div className="text-[9px] text-zinc-400">OCTAVA</div><div className="title text-xl text-sky-300">${oct>0?'+'+oct:oct}</div></div>
        <${Btn} className="h-12 w-12 text-2xl" onClick=${()=>setOct(o=>Math.min(4,o+1))}>+<//>
      </div>
      <${Btn} on=${split} color="#F6B40E" className="h-12 px-5 shrink-0" onClick=${()=>setSplit(s=>!s)}>SPLIT<//>
      ${split&&html`<${Btn} on=${setting} color="#ef4444" className="h-12 px-3 text-xs shrink-0" onClick=${()=>{setSetting(s=>!s);say('Tocá la tecla donde empieza UPPER')}}>${setting?'TOCÁ TECLA…':'PUNTO'}<//>`}
      <${Btn} on=${edit} color="#a78bfa" className="h-12 px-3 text-sm shrink-0" onClick=${()=>setEdit(e=>!e)}>${edit?'✔ LISTO':'✎'}<//>
      <${Btn} className="h-12 w-12 shrink-0" onClick=${fs}>⛶<//>
    </div>

    <!-- CUERPO -->
    <div className="flex-1 min-h-0 flex gap-1.5">
      <div className="w-48 shrink-0 overflow-y-auto scroll-thin space-y-1.5 pr-0.5">
        <div className="text-[9px] tracking-widest text-zinc-400 px-1">BACKING TRACKS</div>
        ${[0,1,2,3,4,5].map(i=>html`<${Track} key=${i} i=${i}/>`)}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className=${`grid gap-1.5 shrink-0 ${split?'grid-cols-2':'grid-cols-1'}`}>
          ${(split?['lower','upper']:['upper']).map(z=>html`<button key=${z} onClick=${()=>setTarget(z)} className="glass rounded-xl px-3 py-1.5 text-left border-2" style=${{borderColor:split&&target===z?Z(z):'rgba(116,172,223,.22)',boxShadow:split&&target===z?`0 0 14px ${Z(z)}66`:'none'}}>
            <div className="text-[9px] tracking-widest text-zinc-400">${split?(z==='lower'?'LOWER':'UPPER')+(target===z?' · DESTINO':''):'SONANDO'}</div>
            <div className="title text-sm truncate" style=${{color:Z(z)}}>${sounds[z]?.title||'— sin sonido —'}</div></button>`)}
        </div>
        <div className="flex gap-1.5 overflow-x-auto scroll-thin shrink-0 pb-0.5">
          ${cfg.map(g=>html`<button key=${g.id} onClick=${()=>{setGid(g.id);setSelA(null)}} className="shrink-0 h-12 px-4 rounded-xl flex items-center gap-1.5 title text-sm border-2 active:scale-95 transition"
            style=${g.id===grp?.id?{background:g.color,color:'#06101f',borderColor:g.color,boxShadow:`0 0 18px ${g.color}88`}:{background:'rgba(255,255,255,.05)',borderColor:g.color+'66',color:g.color}}><span className="text-xl">${g.icon}</span>${g.name}</button>`)}
          ${edit&&html`<button onClick=${()=>{const g={id:'g'+rid(),name:'NUEVO',icon:'🎵',color:'#a78bfa',artists:[]};setCfg(c=>[...c,g]);setGid(g.id)}} className="shrink-0 h-12 px-4 rounded-xl border-2 border-dashed border-sky-300/40 text-sky-300 font-bold">＋ GRUPO</button>`}
          ${edit&&grp&&html`<${Btn} className="shrink-0 h-12 px-3 text-sm" onClick=${()=>setEditing({kind:'group',item:grp})}>✎ Grupo<//>`}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
          ${grp&&html`<div className="grid gap-1.5" style=${{gridTemplateColumns:'repeat(auto-fill,minmax(112px,1fr))'}}>
            ${grp.artists.map(a=>{const on=sounds[zone]?.artistId===a.id;return html`<button key=${a.id} onClick=${()=>pickArtist(grp,a)} className="relative h-24 rounded-2xl flex flex-col items-center justify-end p-1.5 active:scale-95 transition border overflow-hidden"
              style=${{background:a.img?`linear-gradient(to top,#000c,#0000 65%),url("${a.img}") center/cover`:`linear-gradient(160deg,${grp.color}30,#0a1428)`,borderColor:on?grp.color:'rgba(255,255,255,.14)',boxShadow:on?`0 0 20px ${grp.color}88, inset 0 0 12px ${grp.color}44`:'none'}}>
              ${!a.img&&html`<span className="text-4xl leading-none mb-auto">${a.icon||'🎵'}</span>`}
              <span className="title text-xs leading-tight text-center">${a.name}</span>
              <span className="absolute bottom-0 inset-x-0 h-1" style=${{background:on?grp.color:'transparent',boxShadow:on?`0 0 8px ${grp.color}`:'none'}}></span>
              ${edit&&html`<span className="absolute top-1 right-1 bg-violet-500 text-black rounded-full w-5 h-5 text-[10px] flex items-center justify-center">✎</span>`}</button>`})}
            ${edit&&html`<button onClick=${()=>updG(g=>g.id===grp.id?{...g,artists:[...g.artists,mkA('Nuevo artista','🎵')]}:g)} className="h-24 rounded-2xl border-2 border-dashed border-sky-300/40 text-3xl text-sky-300">＋</button>`}
          </div>`}
        </div>
        ${art&&!edit&&html`<div className="shrink-0 flex gap-1.5 overflow-x-auto scroll-thin items-center">
          <div className="text-[9px] tracking-widest text-zinc-400 shrink-0 max-w-[5rem] truncate">${art.name.toUpperCase()}</div>
          ${art.sounds.map(s=>html`<${Btn} key=${s.id} on=${sounds[zone]?.soundId===s.id} color=${grp.color} className="h-12 px-4 shrink-0 text-sm" onClick=${()=>applySound(grp,art,s)}>${s.label}<//>`)}</div>`}
      </div>
    </div>

    <!-- TECLADO -->
    <div className="shrink-0" style=${{height:'30dvh',minHeight:'96px'}}>
      <${Keyboard} active=${active} split=${split} splitAt=${splitAt} oct=${oct} onDown=${n=>play(n,100)} onUp=${stop}/></div>

    ${toast&&html`<div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-white text-slate-900 font-bold px-5 py-2.5 rounded-full shadow-xl text-sm">${toast}</div>`}
    ${editing&&html`<${Editor} kind=${editing.kind} item=${editing.item} sfs=${sfs} onClose=${()=>setEditing(null)} onSave=${saveItem} onDel=${delItem}/>`}
    ${lib&&html`<div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3" onClick=${()=>setLib(false)}>
      <div className="w-full max-w-2xl max-h-[92dvh] overflow-y-auto scroll-thin rounded-2xl p-4 space-y-2 border border-sky-300/30" style=${{background:'#0b1730'}} onClick=${e=>e.stopPropagation()}>
        <div className="flex items-center gap-2"><div className="title text-lg flex-1">BIBLIOTECA SF2 · guardada en el dispositivo</div>
          <${Btn} on=${true} className="h-12 px-4 text-sm" onClick=${()=>fileIn.current.click()}>＋ IMPORTAR<//><${Btn} className="h-12 w-12" onClick=${()=>setLib(false)}>✕<//></div>
        ${sfs.length===0&&html`<div className="text-zinc-400 text-sm py-4">Todavía no cargaste ningún .sf2. Se guardan solos y quedan al reiniciar la app.</div>`}
        ${sfs.map(sf=>{const cur=sounds[zone]?.sfId===sf.id?sounds[zone].pi:0;return html`<div key=${sf.id} className="glass rounded-xl p-2 space-y-1.5">
          <div className="flex items-center gap-2"><div className="text-sm font-bold truncate flex-1">${sf.name}</div><button className="text-red-400 px-3 h-10" onClick=${()=>delSF(sf)}>Borrar</button></div>
          <div className="flex gap-1.5 items-center"><select value=${cur} onChange=${e=>direct(sf,+e.target.value,zone)} className="flex-1 min-w-0 bg-zinc-800 rounded-lg p-2 text-sm border border-zinc-700">${sf.presets.map((x,i)=>html`<option key=${i} value=${i}>${x.name}</option>`)}</select>
            ${split&&html`<${Btn} className="h-11 px-3 text-xs" onClick=${()=>direct(sf,cur,'lower')}>→ LOWER<//>`}<${Btn} className="h-11 px-3 text-xs" onClick=${()=>direct(sf,cur,'upper')}>→ UPPER<//></div></div>`})}
      </div></div>`}
  </div>`;
}
document.addEventListener('pointerdown',()=>{if(AC.state!=='running')AC.resume();lockScreen()});
ReactDOM.createRoot(document.getElementById('root')).render(html`<${App}/>`);
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

})();
