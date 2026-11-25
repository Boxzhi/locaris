const VERSION='0.2.0-preview';
const POLICY_OPTIONS=Object.freeze({discovery_minutes:[5,10,15,30,60],live_refresh_seconds:[15,30,60,120],backfill_minutes:[30,60,120,240],track_gap_minutes:[10,15,30,60]});
const DEFAULT_POLICY=Object.freeze({discovery_minutes:10,live_refresh_seconds:30,backfill_minutes:60,track_gap_minutes:30});
const TIMING=Object.freeze({REFRESH_TICK_MS:5000,LIVE_DIRTY_MS:5000,DEVICE_REFRESH_MS:60000,HISTORY_REFRESH_MS:120000,SETTINGS_REFRESH_MS:300000,ADDRESS_SUCCESS_MS:1800000,ADDRESS_FAILURE_MS:60000,MAP_CONFIG_TTL_MS:7200000,MAP_RETRY_MS:60000,SDK_TIMEOUT_MS:20000,GPS_JUMP_MS:120000,DETAIL_ANIMATION_MS:180,MAP_NEAR_MS:450,MAP_MEDIUM_MS:650,MAP_FAR_MS:1350,SWITCH_ANIMATION_MS:150,HISTORY_DAYS:30});
let sdkPromise,sdkSession,sdkConfigPromise;
const WEBGL_SAFE_KEY='luxe_location.webgl_safe_session';
const WEBGL_FORCE_RETRY_KEY='luxe_location.webgl_force_retry_session';
let webglState={available:false,force:false,safe:false,retried:false,reloadPending:false,correctionBlocked:false};
function probeWebGL(strict){
  // Use separate canvases for different context attributes and release probes.
  for(const type of ['webgl','experimental-webgl','webgl2']){
    let canvas,gl;
    try{
      canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      gl=canvas.getContext(type,{failIfMajorPerformanceCaveat:strict});
      if(gl&&!gl.isContextLost())return type;
    }catch(e){}finally{
      if(gl){try{gl.getExtension('WEBGL_lose_context')?.loseContext();}catch(e){}}
      if(canvas){canvas.width=canvas.height=0;}
    }
  }
  return null;
}
function configureWebGL(){
  const strict=probeWebGL(true),relaxed=strict||probeWebGL(false);
  let safe=false,forceRetry=false;
  try{safe=sessionStorage.getItem(WEBGL_SAFE_KEY)==='1';forceRetry=sessionStorage.getItem(WEBGL_FORCE_RETRY_KEY)==='1';}catch(e){}
  const force=!!(relaxed&&!safe&&(!strict||forceRetry));
  if(force)window.forceWebGL=true;
  else if(window.forceWebGL===true)delete window.forceWebGL;
  if(safe)window.forbidenWebGL=true;
  else if(window.forbidenWebGL===true)delete window.forbidenWebGL;
  webglState={available:!!relaxed,force,safe,retried:forceRetry,reloadPending:false,correctionBlocked:false};
}
function correctWebGLMismatch(A){
  const state=webglState;
  if(state.reloadPending)return true;
  if(state.safe||!state.available||A.Browser?.isWebGL!==false||state.force||state.retried||state.correctionBlocked)return false;
  // Record the retry before navigation so an SDK rejection cannot loop.
  try{
    sessionStorage.setItem(WEBGL_FORCE_RETRY_KEY,'1');
    if(sessionStorage.getItem(WEBGL_FORCE_RETRY_KEY)!=='1')throw new Error('session storage unavailable');
  }catch(e){state.correctionBlocked=true;return false;}
  state.retried=true;state.reloadPending=true;
  try{location.reload();return true;}
  catch(e){state.reloadPending=false;state.correctionBlocked=true;return false;}
}
function restartRaster(){
  try{sessionStorage.setItem(WEBGL_SAFE_KEY,'1');}catch(e){return false;}
  location.reload();return true;
}
const expiredMapSession=e=>e?.code==='session_expired'||String(e?.message||e).includes('Map session expired; reload panel');
async function ensureSdkConfig(hass){
  if(sdkSession&&Date.now()-sdkSession.at<TIMING.MAP_CONFIG_TTL_MS)return sdkSession.config;
  if(!sdkConfigPromise)sdkConfigPromise=(async()=>{const old=sdkSession?.config;const config=await hass.callWS({type:NS+'config',...(old?{renew_path:old.proxy_path}:{})});if(old&&config.proxy_path!==old.proxy_path)throw Object.assign(new Error('地图会话已失效，请刷新位置中心'),{code:'session_expired'});sdkSession={config,at:Date.now()};return config;})().finally(()=>{sdkConfigPromise=null;});
  return sdkConfigPromise;
}
function sdk(config){
  if(sdkPromise)return sdkPromise;
  sdkPromise=new Promise((resolve,reject)=>{
    if(window.AMap){reject(new Error('页面已加载其他高德 SDK，请刷新页面'));return;}
    configureWebGL();
    window._AMapSecurityConfig={serviceHost:new URL(config.proxy_path,location.origin).href};
    const s=document.createElement('script');
    const timer=setTimeout(()=>{s.remove();reject(new Error('SDK 加载超时'));},TIMING.SDK_TIMEOUT_MS);
    s.src='https://webapi.amap.com/maps?v=2.0&key='+encodeURIComponent(config.map_key);
    s.onload=()=>{clearTimeout(timer);const A=window.AMap;A?resolve(A):reject(new Error('SDK 对象不存在'));};
    s.onerror=()=>{clearTimeout(timer);s.remove();reject(new Error('SDK 网络加载失败'));};
    document.head.appendChild(s);
  }).catch(e=>{sdkPromise=null;throw e;});
  return sdkPromise;
}


const TABS=[['live','实时位置','mdi:map-marker-radius-outline'],['history','历史轨迹','mdi:map-marker-path'],['devices','设备管理','mdi:cellphone'],['settings','设置','mdi:cog-outline']];
const NS='locaris/';
const fmt=t=>t?new Date(t).toLocaleString('zh-CN',{hour12:false}):'—';
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const icon=name=>{const paths={'mdi:menu':'M4 6h16M4 12h16M4 18h16','mdi:map-marker-radius-outline':'M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z M12 6a3 3 0 1 0 0 6 3 3 0 1 0 0-6','mdi:map-marker-path':'M5 6a2 2 0 1 0 0 4 2 2 0 1 0 0-4 M19 14a2 2 0 1 0 0 4 2 2 0 1 0 0-4 M7 8h7a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h7','mdi:cellphone':'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M10 18h4','mdi:cog-outline':'M10 2h4l.7 3 2 .9 2.7-1.6 2 3.5-2.3 2.1v2.2l2.3 2.1-2 3.5-2.7-1.6-2 .9-.7 3h-4l-.7-3-2-.9-2.7 1.6-2-3.5L5 12.1V9.9L2.7 7.8l2-3.5 2.7 1.6 2-.9z M12 8a3 3 0 1 0 0 6 3 3 0 1 0 0-6','mdi:dots-horizontal':'M5 12h.1M12 12h.1M19 12h.1','tablet':'M5 3h14v18H5z M10 18h4','layers':'M3 8l9-5 9 5-9 5z M3 12l9 5 9-5 M3 16l9 5 9-5','locate':'M12 2v4 M12 18v4 M2 12h4 M18 12h4 M12 6a6 6 0 1 0 0 12 6 6 0 1 0 0-12'};const ns='http://www.w3.org/2000/svg',e=document.createElementNS(ns,'svg'),p=document.createElementNS(ns,'path');e.setAttribute('viewBox','0 0 24 24');e.setAttribute('width','22');e.setAttribute('height','22');e.setAttribute('aria-hidden','true');p.setAttribute('d',paths[name]||paths['mdi:cellphone']);p.setAttribute('fill','none');p.setAttribute('stroke','currentColor');p.setAttribute('stroke-width',name==='mdi:dots-horizontal'?'4':'1.8');p.setAttribute('stroke-linecap','round');p.setAttribute('stroke-linejoin','round');e.append(p);return e;};
const selectArrowIcon=()=>{const selectArrow=document.createElementNS('http://www.w3.org/2000/svg','svg');selectArrow.setAttribute('viewBox','0 0 24 24');selectArrow.setAttribute('aria-hidden','true');const arrowPath=document.createElementNS('http://www.w3.org/2000/svg','path');arrowPath.setAttribute('d','M7 9l5-5 5 5M7 15l5 5 5-5');arrowPath.setAttribute('fill','none');arrowPath.setAttribute('stroke','currentColor');arrowPath.setAttribute('stroke-width','2');arrowPath.setAttribute('stroke-linecap','round');arrowPath.setAttribute('stroke-linejoin','round');selectArrow.append(arrowPath);return selectArrow;};
const button=(text,fn,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=fn;return b;};
class LocationPanel extends HTMLElement{
  set hass(v){
    const old=this._hass;this._hass=v;
    if(this.isConnected&&old?.user?.is_admin&&!v?.user?.is_admin){this.disconnectedCallback();this.accessRevoked=true;this.replaceChildren();return;}
    if(this.isConnected&&this.accessRevoked){if(v?.user?.is_admin){this.accessRevoked=false;this.connectedCallback();}return;}
    if(this.isConnected&&this.viewportResize&&(old?.themes!==v?.themes||old?.user!==v?.user))this.syncHostLayout();
    if(this.isConnected&&this.started&&old?.user&&!old.user.is_admin&&v?.user?.is_admin)this.started=false;
    if(this.isConnected&&!this.started)this.start();
    if(this.started&&v?.connected===false){this.pendingActions=[];if(old?.connected!==false)this.status('HA 连接已断开');return;}
    if(this.started&&old?.connected===false&&v?.connected!==false&&!document.hidden){this.status();if(this.refreshToken)this.refreshNeeded=true;else this.refresh();this.refreshMapSession();if(this.page==='history'){if(!this.historyData&&!this.historyLoading)this.loadHistory();else this.drainHistoryAddresses();}}
    if(this.started&&this.page==='live'&&old?.states&&v?.states&&this.data?.candidates?.some(d=>d.managed&&d.enabled&&(old.states[d.entity_id]?.last_updated!==v.states[d.entity_id]?.last_updated||old.states[d.entity_id]?.state!==v.states[d.entity_id]?.state)))this.liveDirty=true;
  }
  connectedCallback(){this.showHeader=true;try{this.showHeader=localStorage.getItem('luxe_location.show_header')!=='0';}catch(e){}this.page='live';this.data=null;this.dataError='';this.pendingActions=[];this.refreshToken=null;this.refreshNeeded=false;this.renderSignature=null;this.lastRefreshAt=0;this.liveDirty=false;this.epoch=(this.epoch||0)+1;this.render();if(this._hass)this.start();}
  disconnectedCallback(){this.epoch++;this.started=false;this.pendingActions=[];this.refreshToken=null;this.refreshNeeded=false;this.data=null;this.liveAddressCache?.clear();this.dataError='';clearInterval(this.timer);this.timer=null;if(this.visibilityHandler){document.removeEventListener('visibilitychange',this.visibilityHandler);this.visibilityHandler=null;}this.liveListObserver?.disconnect();this.liveListObserver=null;this.liveListView=null;this.stopViewport();this.closeHistoryCalendar();this.stopMenus();this.stopHistoryAddresses();this.releaseHistory();this.destroyMap();}
  render(){
    this.innerHTML=`<style>
    html,body{margin:0;padding:0;height:100%;overflow:hidden;background:var(--primary-background-color,#131820);overscroll-behavior:none}locaris-panel{display:block;height:100vh;height:var(--lx-viewport,100dvh);width:100%;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--primary-text-color,#e7eaf0);background:var(--lx-host-bg,var(--primary-background-color,#131820));-webkit-text-size-adjust:100%;text-size-adjust:100%;--lx-accent:var(--primary-color,#4387e8);--lx-card:var(--card-background-color,#202733);--lx-line:var(--divider-color,#394453)}
    locaris-panel *{box-sizing:border-box}.lx-shell{height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;padding:10px;overflow:hidden}
    .lx-head,.lx-tabs,.lx-row,.lx-title{display:flex;align-items:center;gap:10px}
    .lx-head{flex:none;min-height:44px}.lx-menu{display:none}.lx-map-tools summary{list-style:none;cursor:pointer;padding:7px;display:flex}.lx-map-tools summary::-webkit-details-marker{display:none}.lx-map-tools details:not([open]) button{display:none}.lx-map-tools details button{display:block;width:100%}.lx-list-row[data-focus]{cursor:pointer}.lx-list-row[data-focus]:hover{background:var(--secondary-background-color,#293441)}.lx-marker{width:32px;height:32px;border:2px solid white;border-radius:50%;display:grid;place-items:center;color:white;font:bold 13px sans-serif;box-shadow:0 2px 8px #0006}.lx-head h1{font-size:21px;margin:0;font-weight:650;flex:1}.lx-tabs{gap:4px;flex:none}
    locaris-panel button{font:inherit;color:inherit;cursor:pointer;background:transparent;border:0;border-radius:9px;padding:8px 12px}
    locaris-panel button:focus-visible{outline:2px solid var(--lx-accent);outline-offset:1px}
    locaris-panel button:disabled{opacity:.5;cursor:default}
    .lx-tabs button{min-width:0;display:flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;color:var(--secondary-text-color,#a6afbd)}
    .lx-tabs button[aria-selected=true]{color:var(--lx-accent);background:var(--secondary-background-color,#293441)}
    
    .lx-content{flex:1;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain}
    .lx-card{background:var(--lx-card);border:1px solid var(--lx-line);border-radius:14px;padding:14px;min-width:0}
    .lx-card h2{font-size:16px;margin:0;font-weight:650}.lx-card>h2+.lx-field{margin-top:10px}.lx-muted{color:var(--secondary-text-color,#a6afbd);font-size:12px;overflow-wrap:anywhere}
    .lx-title{justify-content:space-between;margin-bottom:10px;min-width:0}.lx-title>h2{min-width:0}.lx-title>.lx-muted{flex:none;text-align:right}.lx-row{justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--lx-line)}.lx-row:last-child{border:0}
    .lx-map-layout{min-width:0;display:grid;grid-template-rows:minmax(0,1fr);grid-template-columns:minmax(260px,320px) minmax(0,1fr);grid-template-areas:'side map';gap:10px;height:100%;min-height:0}.lx-map-layout[data-mode=history]{grid-template-rows:auto minmax(0,1fr);grid-template-areas:'filter map' 'side map'}.lx-map{grid-area:map}.lx-side{grid-area:side;min-width:0}.lx-history-filter{grid-area:filter;position:relative;z-index:8;min-width:0}.lx-history-filter .lx-stack{margin-top:6px}.lx-side>.lx-card{display:flex;flex-direction:column;min-height:0;max-height:100%;overflow:hidden}.lx-side>.lx-card>.lx-title{flex:none}.lx-list-scroll{min-height:0;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:thin}.lx-map-layout[data-mode] .lx-side{overflow:hidden}.lx-content.lx-map-page{overflow:hidden}.lx-live-row{position:relative;border:0!important;border-radius:9px;padding:10px 5px}.lx-live-row+.lx-live-row:before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:var(--lx-line);pointer-events:none}.lx-live-row[aria-pressed=true]{background:var(--secondary-background-color,#293441)}.lx-live-address{font-size:13px;overflow-wrap:anywhere}.lx-live-meta{font-size:11px}.lx-list-row[data-focus]{-webkit-tap-highlight-color:transparent}.lx-list-row[data-focus]:not([aria-pressed=true]){background:transparent}
    .lx-side{display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto}.lx-map{position:relative;isolation:isolate;overflow:hidden;border-radius:14px;min-height:0;background:var(--lx-card)}
    .lx-track-end{width:30px;height:30px;border:2px solid white;border-radius:50%;display:grid;place-items:center;color:white;font:bold 12px sans-serif;box-shadow:0 2px 6px #0005}.lx-map-inner{position:absolute;inset:0;touch-action:none}.lx-map-tools{position:absolute;right:10px;top:10px;z-index:5;display:flex;flex-direction:column;gap:4px;background:var(--lx-card);border-radius:10px;padding:4px;box-shadow:0 2px 12px #0002}
    .lx-map-tools button{padding:7px;font-size:12px}.lx-map-tools button[aria-pressed=true]{color:var(--lx-accent)}
    .lx-error{color:var(--error-color,#e7a23b);font-size:13px;flex:none;display:flex;align-items:center;gap:8px;overflow-wrap:anywhere}.lx-error[hidden]{display:none!important}.lx-error>span{min-width:0;flex:1;max-height:72px;overflow:auto}.lx-error button,.lx-state button,.lx-map-state button{color:var(--lx-accent);flex:none;padding:6px 10px}.lx-state{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;min-height:52px;padding:10px;text-align:center}.lx-map-state{position:absolute;inset:0;z-index:4;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:22px;text-align:center;background:var(--lx-card);color:var(--primary-text-color,#e7eaf0)}.lx-map-state[hidden]{display:none!important}.lx-map-state>span{max-width:100%;overflow-wrap:anywhere}.lx-map-state button{background:var(--secondary-background-color,#293441)}.lx-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.lx-stack{display:flex;flex-direction:column;gap:10px;max-width:1000px;margin:auto}
    .lx-device-head{display:flex;align-items:center;gap:10px}.lx-avatar{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--secondary-background-color,#293441);color:var(--lx-accent);flex:none}.lx-name{flex:1;min-width:0;overflow-wrap:anywhere}
    .lx-switch{display:flex;align-items:center;gap:8px;cursor:pointer}.lx-switch input{flex:none;appearance:none;-webkit-appearance:none;width:42px;height:24px;border-radius:20px;background:#78838e;position:relative;cursor:pointer;margin:0}.lx-switch input:checked{background:var(--lx-accent)}.lx-switch input:focus-visible,.lx-field:focus-visible,.lx-more summary:focus-visible,.lx-map-tools summary:focus-visible,.lx-live-row[data-focus]:focus-visible{outline:2px solid var(--lx-accent);outline-offset:2px}.lx-row>strong{text-align:right;overflow-wrap:anywhere;min-width:0}.lx-switch input:before{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;background:white;border-radius:50%;transition:transform ${TIMING.SWITCH_ANIMATION_MS}ms}.lx-switch input:checked:before{transform:translateX(18px)}
    .lx-more{position:relative}.lx-more summary{cursor:pointer;list-style:none;padding:8px}.lx-more summary::-webkit-details-marker{display:none}.lx-more-panel{position:absolute;right:0;top:100%;z-index:10;min-width:180px;background:var(--lx-card);border:1px solid var(--lx-line);border-radius:10px;padding:5px;box-shadow:0 6px 20px #0003}.lx-more-panel button{display:block;width:100%;text-align:left;white-space:nowrap}.lx-more-panel .lx-danger{color:var(--error-color,#db5454)}.lx-row>button{flex:none}
    .lx-calendar-wrap{position:relative;min-width:0}.lx-date-trigger{display:flex;align-items:center;gap:8px;text-align:left;min-width:0;min-height:38px}.lx-date-trigger>span:nth-child(2){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lx-date-trigger>span:first-child,.lx-date-arrow{flex:none}.lx-date-arrow{margin-left:auto}.lx-calendar{width:100%;margin-top:8px;padding:8px;background:var(--lx-card);border:1px solid var(--lx-line);border-radius:12px}.lx-calendar[hidden],.lx-point-address[hidden]{display:none!important}.lx-cal-header{display:flex;align-items:center;justify-content:space-between;gap:4px}.lx-cal-header button{min-height:34px;padding:4px 10px}.lx-cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;text-align:center;align-items:center;margin:6px 0}.lx-cal-grid button{padding:0;height:34px;min-width:0;font-size:14px;border-radius:8px}.lx-cal-grid button[aria-pressed=true]{background:var(--lx-accent);color:white}.lx-cal-grid button:disabled{opacity:.3}.lx-cal-today:not([aria-pressed=true]){color:var(--lx-accent);font-weight:bold}.lx-group-address{display:block}.lx-group-count{display:block;margin-top:3px}.lx-group-detail:not([hidden]){display:flex;flex-direction:column;gap:4px;padding-left:8px}.lx-raw-point{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:6px 4px!important}.lx-raw-point>span:last-child{margin-left:auto;text-align:right;min-width:0;overflow-wrap:anywhere}.lx-raw-point>span:first-child{flex:none;font-variant-numeric:tabular-nums}.lx-quality-warning{color:var(--warning-color,#e58b25)}.lx-raw-number{min-width:24px;text-align:center;font-size:12px;color:var(--secondary-text-color,#a6afbd)}.lx-raw-selected{color:var(--lx-accent);background:var(--secondary-background-color,#293441)}.lx-point-number{display:grid;place-items:center;flex:none;min-width:26px;height:26px;padding:0 5px;border-radius:20px;background:var(--secondary-background-color,#303c4b);color:var(--secondary-text-color,#a6b4c5);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}.lx-point-row[aria-expanded=true] .lx-point-number{background:var(--lx-accent);color:white}.lx-point-label{flex:1;min-width:0;overflow-wrap:anywhere;font-size:13px;line-height:1.5}.lx-point-row[aria-expanded=true] .lx-point-label{color:var(--lx-accent)}.lx-track-number{min-width:28px;width:auto;padding:0 5px;white-space:nowrap}.lx-track-selected{transform:scale(1.25);box-shadow:0 0 0 5px #4387e855,0 2px 6px #0005}.lx-point-address:not([hidden]){display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap}.lx-point-card{position:relative;border-radius:9px;padding:3px 0}.lx-point-card+.lx-point-card:before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:var(--lx-line);pointer-events:none}.lx-point-open{background:var(--secondary-background-color,#293441)}.lx-point-row{display:flex;width:100%;align-items:center;gap:8px;text-align:left;padding:10px 6px!important}.lx-point-row svg{flex:none;color:var(--secondary-text-color,#8997a9);width:18px;height:18px}.lx-point-row[aria-expanded=true] svg{color:var(--lx-accent)}.lx-point-row[aria-expanded=true] .lx-point-arrow{color:var(--lx-accent)}.lx-point-arrow{color:var(--secondary-text-color,#a6afbd);font-size:16px}.lx-point-address{padding:0 10px 10px 32px;font-size:13px;color:var(--secondary-text-color,#a6afbd);overflow-wrap:anywhere}.lx-policy-select-wrap{width:116px;max-width:100%;flex:none}.lx-field{font:inherit;width:100%;min-height:38px;padding:8px;border:1px solid var(--lx-line);border-radius:8px;background:var(--lx-card);color:inherit}.lx-list-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--lx-line)}.lx-list-row:last-child{border:0}
    @media(max-width:760px){.lx-menu{display:block}.lx-head h1{font-size:20px}.lx-tabs{order:5;justify-content:space-around;border-top:1px solid var(--lx-line);padding:3px 0 max(0px, calc(env(safe-area-inset-bottom,0px) - var(--lx-host-safe-bottom,0px)))}.lx-tabs button{flex:1;flex-direction:column;gap:2px;padding:2px;font-size:11px;min-height:44px}.lx-grid{grid-template-columns:1fr}.lx-map-layout{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr);grid-template-areas:'map' 'side';height:100%;min-height:0}.lx-map-layout[data-mode=history]{grid-template-rows:auto minmax(0,1fr) minmax(0,1fr);grid-template-areas:'filter' 'map' 'side'}.lx-map{height:auto;min-height:0}.lx-side{overflow:hidden}.lx-history-filter h2{display:none}.lx-history-filter .lx-stack{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:8px;margin:0}.lx-history-filter .lx-date-trigger{font-size:12px;white-space:nowrap;padding:8px 5px;gap:4px}.lx-history-filter .lx-calendar{position:absolute;right:0;top:100%;width:min(310px,calc(100vw - 40px));max-height:calc(var(--lx-viewport,100vh) - 160px);overflow:auto;overscroll-behavior:contain;z-index:15;box-shadow:0 8px 24px #0005}.lx-tabs button[aria-selected=true]{background:transparent}.lx-tabs button[aria-selected=true] svg{background:var(--secondary-background-color,#293441);box-sizing:content-box;padding:5px 12px;border-radius:10px}.lx-tabs button svg{box-sizing:content-box;padding:5px 12px}.lx-tabs button{-webkit-tap-highlight-color:transparent}.lx-card{padding:11px}.lx-shell{padding-bottom:0;gap:8px}}
    @media(max-width:760px) and (max-height:700px){.lx-map-layout{grid-template-rows:minmax(0,.85fr) minmax(0,1.15fr)}.lx-map-layout[data-mode=history]{grid-template-rows:auto minmax(0,.85fr) minmax(0,1.15fr)}}@media(max-width:760px) and (min-height:850px){.lx-map-layout{grid-template-rows:minmax(0,1.1fr) minmax(0,.9fr)}.lx-map-layout[data-mode=history]{grid-template-rows:auto minmax(0,1.1fr) minmax(0,.9fr)}}
    locaris-panel[data-hide-header] .lx-head{display:none}
    .lx-fallback-menu{display:none}
    @media(max-width:760px){
      locaris-panel[data-hide-header] .lx-fallback-menu{display:flex;align-items:center;justify-content:center;width:38px;height:38px;background:var(--lx-card);border-radius:10px;box-shadow:0 2px 10px #0002}
      .lx-map>.lx-fallback-menu{position:absolute;left:10px;top:10px;z-index:6}
      .lx-content>.lx-fallback-menu{margin-bottom:10px}
      .lx-map-layout[data-mode=live]{grid-template-rows:minmax(0,1fr) minmax(0,min(var(--lx-live-list-natural,9999px),50%))}
    }
    @media(max-width:760px) and (max-height:700px){.lx-map-layout[data-mode=live]{grid-template-rows:minmax(0,1fr) minmax(0,min(var(--lx-live-list-natural,9999px),57.5%))}}
    @media(max-width:760px) and (min-height:850px){.lx-map-layout[data-mode=live]{grid-template-rows:minmax(0,1fr) minmax(0,min(var(--lx-live-list-natural,9999px),45%))}}
    .lx-history-select-wrap,.lx-policy-select-wrap{position:relative;min-width:0;color:var(--primary-text-color,#e7eaf0)}.lx-history-select-wrap .lx-history-select,.lx-policy-select-wrap .lx-policy-select{appearance:none;-webkit-appearance:none;padding-right:30px;color:inherit;min-width:0;text-overflow:ellipsis}.lx-history-select-wrap>svg,.lx-policy-select-wrap>svg{position:absolute;right:9px;top:50%;transform:translateY(-50%);width:16px;height:16px;pointer-events:none;color:inherit}
    @media(max-width:380px){.lx-tabs button svg{padding:4px 8px}.lx-history-filter .lx-stack{grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:6px}.lx-history-filter .lx-date-trigger{padding:6px 5px}.lx-raw-point{gap:4px}.lx-raw-number{min-width:20px}}
    @media(max-width:760px) and (max-height:460px){.lx-shell{gap:6px}.lx-head{min-height:36px}.lx-tabs button{flex-direction:row;gap:3px;min-height:36px}.lx-tabs button svg{padding:3px 5px;width:18px;height:18px}.lx-map-layout[data-mode=live]{grid-template-rows:minmax(0,1fr) minmax(0,min(var(--lx-live-list-natural,9999px),48%))}.lx-map-layout[data-mode=history]{grid-template-rows:auto minmax(0,1fr) minmax(0,1fr)}}
    @media(pointer:coarse){.lx-field,.lx-history-filter .lx-date-trigger{font-size:16px}.lx-history-filter .lx-date-trigger{font-size:12px}.lx-history-select-wrap .lx-history-select{font-size:16px}.lx-cal-grid button{min-height:36px}}
    </style><div class="lx-shell"><header class="lx-head"><button id="menu" class="lx-menu" aria-label="打开侧边栏"></button><h1>位置中心</h1></header><nav class="lx-tabs" aria-label="位置中心页面"></nav><div class="lx-error" role="status" hidden></div><main class="lx-content"></main></div>`;
    this.querySelector('#menu').append(icon('mdi:menu'));this.querySelector('#menu').onclick=()=>this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true}));
    for(const [id,label,glyph] of TABS){const b=button(undefined,()=>{if(id!==this.page)this.switchPage(id);});b.append(icon(glyph),el('span',label));b.dataset.page=id;this.querySelector('.lx-tabs').append(b);}
    this.applyHeader();this.switchPage(this.page);this.startViewport();
  }
  applyHeader(){
    this.toggleAttribute('data-hide-header',!this.showHeader);
    if(this.map)requestAnimationFrame(()=>this.map?.resize?.());
  }
  menuButton(){
    const b=button('',()=>this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true})),'lx-fallback-menu');
    b.setAttribute('aria-label','打开侧边栏');b.append(icon('mdi:menu'));return b;
  }
  syncHostLayout(){
    // HA's custom-panel iframe can already reserve the iOS safe area as padding.
    // Subtract only that padding; never enlarge or change the host frame.
    let reserved=0,frame=null;
    try{
      frame=window.frameElement;
      if(frame&&frame.tagName==='IFRAME'){
        const hostStyle=frame.ownerDocument.defaultView.getComputedStyle(frame);
        reserved=Math.max(0,parseFloat(hostStyle.paddingBottom)||0);
        if(this.hostFrame&&this.hostFrame!==frame)this.restoreHostLayout();
        if(!this.hostFrame){
          this.hostFrame=frame;
          this.hostBackground={value:frame.style.getPropertyValue('background-color'),priority:frame.style.getPropertyPriority('background-color')};
        }
        // Prefer the host's theme tokens, not the iframe's own previously applied color.
        const hostDoc=frame.ownerDocument,hostWin=hostDoc.defaultView;
        const hostApp=hostDoc.querySelector('home-assistant');
        const themeStyle=hostWin.getComputedStyle(hostApp||hostDoc.documentElement);
        const rootStyle=hostWin.getComputedStyle(hostDoc.documentElement);
        const token=name=>themeStyle.getPropertyValue(name).trim()||rootStyle.getPropertyValue(name).trim();
        const hostColor=token('--app-header-background-color')||token('--primary-background-color')||token('--lovelace-background');
        if(hostColor&&CSS.supports('background-color',hostColor))this.style.setProperty('--lx-host-bg',hostColor);
        else this.style.removeProperty('--lx-host-bg');
        const color=getComputedStyle(this).backgroundColor;
        if(color&&color!=='transparent'&&color!=='rgba(0, 0, 0, 0)'){
          if(frame.style.getPropertyValue('background-color')!==color||frame.style.getPropertyPriority('background-color')!=='important'){
            // Preserve any intervening host-side inline change for restoration.
            if(this.hostAppliedColor&&frame.style.getPropertyValue('background-color')!==this.hostAppliedColor){
              this.hostBackground={value:frame.style.getPropertyValue('background-color'),priority:frame.style.getPropertyPriority('background-color')};
            }
            frame.style.setProperty('background-color',color,'important');
          }
          this.hostAppliedColor=frame.style.getPropertyValue('background-color');
        }
      }
    }catch(e){reserved=0;}
    this.style.setProperty('--lx-host-safe-bottom',reserved+'px');
  }
  restoreHostLayout(){
    const frame=this.hostFrame,original=this.hostBackground;
    try{
      if(frame&&original&&this.hostAppliedColor&&frame.style.getPropertyValue('background-color')===this.hostAppliedColor&&frame.style.getPropertyPriority('background-color')==='important'){
        if(original.value)frame.style.setProperty('background-color',original.value,original.priority);
        else frame.style.removeProperty('background-color');
      }
    }catch(e){}
    this.hostFrame=null;this.hostBackground=null;this.hostAppliedColor=null;
    this.style.removeProperty('--lx-host-safe-bottom');this.style.removeProperty('--lx-host-bg');
  }
  startViewport(){
    this.stopViewport();
    const resize=()=>{
      if(!this.isConnected)return;
      this.syncHostLayout();
      const top=Math.max(0,this.getBoundingClientRect().top);
      const vh=window.visualViewport?.height||window.innerHeight;
      const rootHeight=document.documentElement.clientHeight||window.innerHeight;
      const height=Math.max(0,Math.min(vh,rootHeight)-top);
      if(height>0)this.style.setProperty('--lx-viewport',height+'px');
      this.map?.resize?.();
    };
    this.viewportResize=resize;window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
    // Theme variables may change on the root or on the panel itself.
    this.hostThemeObserver=new MutationObserver(()=>this.syncHostLayout());
    for(const node of [document.documentElement,document.body])this.hostThemeObserver.observe(node,{attributes:true,attributeFilter:['style','class']});
    this.hostThemeMedia=window.matchMedia?.('(prefers-color-scheme: dark)');
    this.hostThemeChange=()=>this.syncHostLayout();
    if(this.hostThemeMedia?.addEventListener)this.hostThemeMedia.addEventListener('change',this.hostThemeChange);
    else this.hostThemeMedia?.addListener?.(this.hostThemeChange);
    resize();
  }
  stopViewport(){
    if(this.viewportResize){window.removeEventListener('resize',this.viewportResize);window.visualViewport?.removeEventListener('resize',this.viewportResize);this.viewportResize=null;}
    this.hostThemeObserver?.disconnect();this.hostThemeObserver=null;
    if(this.hostThemeMedia?.removeEventListener)this.hostThemeMedia.removeEventListener('change',this.hostThemeChange);else this.hostThemeMedia?.removeListener?.(this.hostThemeChange);
    this.hostThemeMedia=null;this.hostThemeChange=null;this.restoreHostLayout();
  }
  async start(){
    if(this.started)return;
    this.started=true;const epoch=this.epoch;
    if(!this._hass.user?.is_admin){this.status('仅管理员可访问');return;}
    if(this.page==='live'||this.page==='history')this.switchPage(this.page);
    else this.refresh();
    if(this.isConnected&&epoch===this.epoch){
      this.timer=setInterval(()=>this.refreshTick(),TIMING.REFRESH_TICK_MS);
      this.visibilityHandler=()=>{if(!document.hidden){if(this.refreshToken)this.refreshNeeded=true;else this.refresh();this.refreshMapSession();if(this.page==='history'){if(!this.historyData&&!this.historyLoading&&this._hass?.connected!==false)this.loadHistory();else this.drainHistoryAddresses();}}};
      document.addEventListener('visibilitychange',this.visibilityHandler);
    }
  }
  refreshMapSession(){
    if(this._hass?.connected===false||!sdkSession||Date.now()<(this.mapRenewRetryAt||0)||(this.page!=='live'&&this.page!=='history'))return;
    const epoch=this.epoch,target=this.querySelector('.lx-map-inner'),map=this.map;
    if(!target||!map||this.mapRenewPending||this.mapSessionExpired)return;
    const token={};this.mapRenewPending=token;
    const current=()=>this.isConnected&&epoch===this.epoch&&this.map===map&&target.isConnected&&this.mapRenewPending===token;
    ensureSdkConfig(this._hass).then(()=>{if(current()&&this.mapSessionError){this.mapSessionError=false;this.mapStatus(target);}}).catch(e=>{if(current()){this.mapRenewRetryAt=Date.now()+TIMING.MAP_RETRY_MS;this.mapSessionError=true;this.mapSessionExpired=expiredMapSession(e);this.mapStatus(target,this.mapSessionExpired?'地图会话已失效，请重新加载':'地图会话暂不可用',()=>this.retryMap(target),this.mapSessionExpired?'重新加载':'重试');}}).finally(()=>{if(this.mapRenewPending===token)this.mapRenewPending=null;});
  }
  policyValue(key){const value=this.data?.policy?.[key];return POLICY_OPTIONS[key]?.includes(value)?value:DEFAULT_POLICY[key];}
  historyLegend(){return '地图连线仅连接已记录坐标，不代表实际行走路线；间隔超过'+this.policyValue('track_gap_minutes')+'分钟或涉及疑似跳点时以虚线表示';}
  refreshTick(now=Date.now()){
    if(document.hidden||!this.isConnected||!this.started||this._hass?.connected===false)return;
    const interval=this.page==='live'?this.policyValue('live_refresh_seconds')*1000:this.page==='devices'?TIMING.DEVICE_REFRESH_MS:this.page==='history'?TIMING.HISTORY_REFRESH_MS:TIMING.SETTINGS_REFRESH_MS;
    const elapsed=now-this.lastRefreshAt;
    if(!this.refreshToken&&(elapsed>=interval||(this.page==='live'&&this.liveDirty&&elapsed>=TIMING.LIVE_DIRTY_MS)))this.refresh();
    this.refreshMapSession();
  }
  status(s='',retry){const n=this.querySelector('.lx-error');if(!n)return;n.replaceChildren();n.hidden=!s;if(s){n.append(el('span',s));if(retry)n.append(button('重试',retry));}}
  stateView(message,retry){const node=el('div',undefined,'lx-state lx-muted');node.setAttribute('role','status');node.append(el('span',message));if(retry)node.append(button('重试',retry));return node;}
  mapStatus(target,message='',retry,retryLabel='重试'){const node=target.parentElement?.querySelector('.lx-map-state');if(!node)return;node.replaceChildren();node.hidden=!message;if(message){node.append(el('span',message));if(retry)node.append(button(retryLabel,retry));}}
  refresh(action='list',entity_id,delete_history=false,policy){
    if(!this.isConnected||!this._hass?.user?.is_admin||this._hass.connected===false)return;
    if(action==='list'){
      if(this.refreshToken)return;
      this.refreshNeeded=true;
    }else{
      const key=JSON.stringify([action,entity_id,delete_history,policy]);
      const last=this.pendingActions[this.pendingActions.length-1];if(last?.key===key||(!last&&this.refreshToken?.key===key))return;
      if(this.pendingActions.length>=32){this.status('待处理操作过多，请稍后重试');return;}
      this.pendingActions.push({action,entity_id,delete_history,policy,key});
    }
    this.drainRefresh();
  }
  async drainRefresh(){
    if(this.refreshToken||!this.isConnected||!this._hass?.user?.is_admin||this._hass.connected===false)return;
    const job=this.pendingActions.shift()||(this.refreshNeeded?{action:'list'}:null);
    if(!job)return;
    this.refreshNeeded=false;
    const epoch=this.epoch,token={key:job.key},live=this.page==='live',settings=this.page==='settings';
    this.refreshToken=token;this.lastRefreshAt=Date.now();if(live)this.liveDirty=false;
    const current=()=>this.isConnected&&this.epoch===epoch&&this.refreshToken===token;
    const active=()=>current()&&this._hass?.user?.is_admin&&this._hass.connected!==false;
    try{
      const r=await this._hass.callWS({type:NS+'storage',action:job.action,...(job.entity_id?{entity_id:job.entity_id}:{}),import_history:true,delete_history:!!job.delete_history,include_position:live,include_storage:settings,...(job.policy?{policy:job.policy}:{})});
      if(!active())return;
      if(live!==(this.page==='live')||settings!==(this.page==='settings')){this.refreshNeeded=true;return;}
      const oldGap=this.policyValue('track_gap_minutes');this.data=r;this.dataError='';if(this.page==='history'&&oldGap!==this.policyValue('track_gap_minutes')){const legend=this.querySelector('[data-history-legend]');if(legend)legend.title=this.historyLegend();this.historyTrackData=null;this.paintHistory(false);}this.pruneLiveAddresses();this.status();const signature=JSON.stringify([this.page,r,this.page==='live'?new Date().toDateString():null]);if(signature!==this.renderSignature){this.updateData();this.renderSignature=signature;}else if(live)this.retryLiveAddresses();
    }catch(e){if(current()){this.dataError=job.action==='list'?'数据读取失败':'操作失败';this.status(this.dataError+'：'+String(e.message||e),job.action==='list'?()=>this.refresh():null);if(!this.data){if(this.page==='history')this.drawSide();else this.updateData();}}}
    finally{if(current()){this.refreshToken=null;this.drainRefresh();}}
  }
  releaseHistory(){
    this.historySeq=(this.historySeq||0)+1;this.historyData=null;this.historyTimelineGroups=null;
    this.historyResolved=null;this.historyFailed=null;this.historyFlags=null;this.historyRegroup=null;this.historyLoading=null;this.openHistoryPoint=null;this.closeHistoryPoint=null;this.selectedHistoryIndex=null;
  }
  closeHistoryCalendar(){
    if(this.calendarOutside){document.removeEventListener('pointerdown',this.calendarOutside,true);this.calendarOutside=null;}
    if(this.calendarDismiss){this.calendarDismiss();this.calendarDismiss=null;}
  }
  stopMenus(){
    if(this.menuOutside)document.removeEventListener('pointerdown',this.menuOutside,true);
    if(this.menuEscape)document.removeEventListener('keydown',this.menuEscape,true);
    this.menuOutside=null;this.menuEscape=null;
  }
  bindMenus(){
    this.stopMenus();
    const menus=()=>Array.from(this.querySelectorAll('.lx-more[open],.lx-map-tools details[open]'));
    this.menuOutside=e=>{const path=e.composedPath?.()||[];for(const d of menus())if(!path.includes(d)&&!d.contains(e.target))d.open=false;};
    this.menuEscape=e=>{if(e.key!=='Escape')return;for(const d of menus()){d.open=false;d.querySelector('summary')?.focus();}};
    document.addEventListener('pointerdown',this.menuOutside,true);
    document.addEventListener('keydown',this.menuEscape,true);
  }
  switchPage(page){
    this.closeHistoryCalendar();this.stopMenus();this.renderSignature=null;this.liveDirty=false;
    this.stopHistoryAddresses();this.liveListObserver?.disconnect();this.liveListObserver=null;this.liveListView=null;this.liveSelected=null;if(this.page!==page&&this.data){this.data={...this.data,candidates:this.data.candidates.map(d=>{const {position,...rest}=d;return rest;})};}this.page=page;this.releaseHistory();this.destroyMap();
    for(const b of this.querySelectorAll('[data-page]')){b.setAttribute('aria-current',b.dataset.page===page?'page':'false');b.setAttribute('aria-selected',String(b.dataset.page===page));}
    const main=this.querySelector('.lx-content');main.replaceChildren();main.classList.toggle('lx-map-page',page==='live'||page==='history');
    if(page==='live'||page==='history'){
      const layout=el('div',undefined,'lx-map-layout'),side=el('aside',undefined,'lx-side'),map=el('div',undefined,'lx-map'),target=el('div',undefined,'lx-map-inner'),tools=el('div',undefined,'lx-map-tools');
      const details=el('details'),summary=el('summary');summary.setAttribute('aria-label','地图图层');summary.append(icon('layers'));details.append(summary);for(const [id,label] of [['standard','标准'],['satellite','卫星'],['dark','深色']]){const b=button(label,()=>{this.layer(id);details.open=false;});b.dataset.layer=id;b.setAttribute('aria-pressed',String(id===(this.mapLayer||'standard')));details.append(b);}tools.append(details);const fit=button(undefined,()=>this.resetMapView());fit.setAttribute('aria-label',page==='live'?'显示全部位置':'显示全部轨迹');fit.title=page==='live'?'显示全部位置':'显示全部轨迹';fit.append(icon('locate'));tools.append(fit);
      const mapState=el('div',undefined,'lx-map-state');mapState.setAttribute('role','status');mapState.append(el('span','正在加载地图…'));layout.dataset.mode=page;map.append(target,mapState,tools,this.menuButton());layout.append(side,map);main.append(layout);this.drawSide();
      if(this.started&&this._hass?.user?.is_admin)this.buildMap(target);
    }else this.drawData();
    this.bindMenus();
    if(this.started){if(this.refreshToken)this.refreshNeeded=true;else this.refresh();}
  }
  updateData(){if(this.page==='live'){if(this.liveSelected&&!this.data?.candidates.some(d=>d.entity_id===this.liveSelected&&d.managed&&d.enabled&&d.position)){this.liveSelected=null;this.cancelCamera();}this.drawSide();this.syncMarkers();}else if(this.page==='history'){const select=this.querySelector('.lx-history-filter select'),ids=(this.data?.candidates||[]).filter(d=>d.managed).map(d=>d.entity_id);if(!select||JSON.stringify(Array.from(select.options,o=>o.value))!==JSON.stringify(ids))this.drawSide();else for(const o of select.options){const d=this.data.candidates.find(d=>d.entity_id===o.value);if(d&&o.textContent!==d.name)o.textContent=d.name;}}else this.drawData();}
  drawLiveSide(side,layout,devices,data){
    let view=this.liveListView;
    if(!view||view.side!==side||!view.card.isConnected){
      this.liveListObserver?.disconnect();
      const card=el('section',undefined,'lx-card'),head=el('div',undefined,'lx-title'),count=el('span','','lx-muted'),list=el('div',undefined,'lx-list-scroll');
      head.append(el('h2','设备位置'),count);card.append(head,list);side.replaceChildren(card);
      view={side,card,head,count,list,rows:new Map(),empty:el('p','','lx-muted')};this.liveListView=view;
      view.measure=()=>{
        if(this.liveListView!==view||!card.isConnected||this.page!=='live')return;
        const cs=getComputedStyle(card),hs=getComputedStyle(head);
        const natural=Math.ceil(list.scrollHeight+head.getBoundingClientRect().height+(parseFloat(hs.marginBottom)||0)+(parseFloat(cs.paddingTop)||0)+(parseFloat(cs.paddingBottom)||0)+(parseFloat(cs.borderTopWidth)||0)+(parseFloat(cs.borderBottomWidth)||0));
        const value=natural+'px';if(layout.style.getPropertyValue('--lx-live-list-natural')!==value){layout.style.setProperty('--lx-live-list-natural',value);requestAnimationFrame(()=>{if(this.liveListView===view)this.map?.resize?.();});}
      };
      if(typeof ResizeObserver==='function'){this.liveListObserver=new ResizeObserver(view.measure);this.liveListObserver.observe(list);this.liveListObserver.observe(head);}
    }
    const {list,rows,count,empty}=view,ids=new Set(devices.map(d=>d.entity_id));
    if(count.textContent!==devices.length+' 台')count.textContent=devices.length+' 台';
    for(const [id,item] of rows)if(!ids.has(id)){this.liveListObserver?.unobserve(item.row);item.row.remove();rows.delete(id);}
    if(devices.length)empty.remove();
    for(let index=0;index<devices.length;index++){
      const d=devices[index],id=d.entity_id,kind=/ipad|tablet|平板/i.test(d.name)?'tablet':'mdi:cellphone';let item=rows.get(id);
      if(!item){
        const row=el('div',undefined,'lx-list-row lx-live-row'),avatar=el('div',undefined,'lx-avatar'),info=el('div',undefined,'lx-name'),name=el('strong',d.name);
        avatar.append(icon(kind));avatar.style.color=this.color(id);info.append(name);row.append(avatar,info);
        row.onclick=()=>{if(!row.dataset.focus)return;if(this.liveSelected===id)this.resetMapView();else{this.focusDevice(id);this.drawSide();}};
        row.onkeydown=e=>{if(row.dataset.focus&&(e.key==='Enter'||e.key===' ')){e.preventDefault();row.click();}};
        item={row,avatar,info,name,kind,addr:null,meta:null,status:null,key:null,full:null};rows.set(id,item);this.liveListObserver?.observe(row);
      }
      const {row,avatar,info,name}=item;
      if(name.textContent!==d.name)name.textContent=d.name;
      if(item.kind!==kind){avatar.replaceChildren(icon(kind));item.kind=kind;}
      const p=d.enabled?d.position:null;
      if(p){
        const selected=this.liveSelected===id,key=JSON.stringify([id,d.recording_generation,p.latitude,p.longitude]);
        if(!item.addr){item.addr=el('div','地址解析中…','lx-live-address');item.meta=el('div','','lx-muted lx-live-meta');item.meta.title='HA 实体更新时间（可能为恢复或属性更新），不是 GPS 实际采样时间';info.replaceChildren(name,item.addr,item.meta);item.status=null;}
        const meta=this.liveTime(p.updated_at)+' · '+(p.accuracy==null?'精度未知':'精度 '+Math.round(p.accuracy)+' m');
        if(item.meta.textContent!==meta)item.meta.textContent=meta;
        if(row.dataset.focus!==id){row.dataset.focus=id;row.tabIndex=0;row.setAttribute('role','button');}
        if(row.getAttribute('aria-pressed')!==String(selected))row.setAttribute('aria-pressed',String(selected));
        if(item.key!==key||item.full!==selected){if(item.key!==key)item.addr.textContent='地址解析中…';item.key=key;item.full=selected;this.liveAddress(d,item.addr,selected);}
        else if(item.addr._lxRetryAt&&Date.now()>=item.addr._lxRetryAt){item.addr._lxRetryAt=0;this.liveAddress(d,item.addr,selected);}
      }else{
        if(!item.status){item.status=el('div','','lx-muted');info.replaceChildren(name,item.status);item.addr=null;item.meta=null;item.key=null;item.full=null;}
        const status=!d.enabled?'历史记录未开启 · 未展示位置':'暂无定位';if(item.status.textContent!==status)item.status.textContent=status;
        if(row.dataset.focus){delete row.dataset.focus;row.removeAttribute('tabindex');row.removeAttribute('role');row.removeAttribute('aria-pressed');}
      }
      if(list.children[index]!==row)list.insertBefore(row,list.children[index]||null);
    }
    if(!devices.length){const label=data?'暂无设备':this.dataError||'正在读取设备…';if(empty.textContent!==label)empty.textContent=label;if(!empty.isConnected)list.append(empty);}
    requestAnimationFrame(view.measure);
  }
  drawSide(){
    const side=this.querySelector('.lx-side');if(!side)return;this.closeHistoryCalendar();
    const layout=this.querySelector('.lx-map-layout'),data=this.data,devices=(data?.candidates||[]).filter(d=>d.managed);
    if(this.page==='live'){this.drawLiveSide(side,layout,devices,data);return;}
    const filter=layout.querySelector('.lx-history-filter'),old=filter?.querySelector('select')?.value,date=filter?.querySelector('[data-history-date]')?.value;filter?.remove();side.replaceChildren();
    {
      const card=el('section',undefined,'lx-card lx-history-filter');card.append(el('h2','历史轨迹'));
      const select=el('select',undefined,'lx-field lx-history-select');select.setAttribute('aria-label','选择设备');const selectWrap=el('div',undefined,'lx-history-select-wrap');selectWrap.append(select,selectArrowIcon());
      for(const d of devices){const opt=el('option',d.name);opt.value=d.entity_id;select.append(opt);}
      if(devices.some(d=>d.entity_id===old))select.value=old;
      const day=el('input');day.type='hidden';day.dataset.historyDate='1';
      const local=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
      const today=new Date(),min=new Date(today),yesterday=new Date(today);min.setDate(min.getDate()-(TIMING.HISTORY_DAYS-1));yesterday.setDate(yesterday.getDate()-1);
      const maxDate=local(today),minDate=local(min);day.value=date&&date>=minDate&&date<=maxDate?date:maxDate;
      const calendar=el('div',undefined,'lx-calendar-wrap'),trigger=button('',()=>{if(!popup.hidden){dismiss();return;}popup.hidden=false;trigger.setAttribute('aria-expanded','true');month=new Date(day.value+'T00:00:00');month.setDate(1);drawCalendar();document.addEventListener('pointerdown',outside,true);this.calendarOutside=outside;},'lx-field lx-date-trigger');
      trigger.setAttribute('aria-label','选择日期');trigger.setAttribute('aria-expanded','false');
      const popup=el('div',undefined,'lx-calendar');popup.hidden=true;
      const dismiss=()=>{popup.hidden=true;trigger.setAttribute('aria-expanded','false');document.removeEventListener('pointerdown',outside,true);if(this.calendarOutside===outside)this.calendarOutside=null;};
      const outside=e=>{if(!(e.composedPath?.()||[]).includes(calendar)&&!calendar.contains(e.target))dismiss();};this.calendarDismiss=dismiss;
      let month=new Date(day.value+'T00:00:00');month.setDate(1);
      const updateLabel=()=>{trigger.replaceChildren(el('span','▦'),el('span',day.value+(day.value===maxDate?' · 今日':day.value===local(yesterday)?' · 昨日':'')),el('span','⌄','lx-date-arrow'));};
      const choose=value=>{if(value<minDate||value>maxDate)return;const changed=day.value!==value;day.value=value;dismiss();updateLabel();trigger.focus({preventScroll:true});if(changed)this.loadHistory();};
      const drawCalendar=()=>{
        popup.replaceChildren();const header=el('div',undefined,'lx-cal-header');
        const shiftMonth=delta=>{month.setMonth(month.getMonth()+delta);drawCalendar();const arrows=popup.querySelectorAll('.lx-cal-header button');const control=arrows[delta<0?0:1];if(control&&!control.disabled)control.focus();else if(arrows[delta<0?1:0]&&!arrows[delta<0?1:0].disabled)arrows[delta<0?1:0].focus();};const prev=button('‹',()=>shiftMonth(-1)),next=button('›',()=>shiftMonth(1));
        prev.setAttribute('aria-label','上个月');next.setAttribute('aria-label','下个月');
        prev.disabled=local(new Date(month.getFullYear(),month.getMonth(),0))<minDate;
        next.disabled=local(new Date(month.getFullYear(),month.getMonth()+1,1))>maxDate;
        header.append(prev,el('strong',month.getFullYear()+'年'+(month.getMonth()+1)+'月'),next);popup.append(header);
        const grid=el('div',undefined,'lx-cal-grid');
        for(const name of ['日','一','二','三','四','五','六'])grid.append(el('span',name,'lx-muted'));
        for(let i=0;i<month.getDay();i++)grid.append(el('span'));
        const count=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
        for(let i=1;i<=count;i++){
          const value=local(new Date(month.getFullYear(),month.getMonth(),i)),cell=button(String(i),()=>choose(value));
          cell.disabled=value<minDate||value>maxDate;cell.setAttribute('aria-pressed',String(value===day.value));cell.setAttribute('aria-label',value);
          if(value===maxDate)cell.classList.add('lx-cal-today');grid.append(cell);
        }popup.append(grid);
        const footer=el('div',undefined,'lx-cal-header');footer.append(button('昨日',()=>choose(local(yesterday))),button('今日',()=>choose(maxDate)));popup.append(footer);
      };
      calendar.append(trigger,day,popup);calendar.onkeydown=e=>{if(e.key==='Escape'){dismiss();trigger.focus();}};
      updateLabel();
      const wrap=el('div',undefined,'lx-stack');wrap.append(selectWrap,calendar);card.append(wrap);layout.prepend(card);
      const timeline=el('section',undefined,'lx-card');timeline.id='history-timeline';side.append(timeline);
      select.onchange=()=>{dismiss();this.loadHistory();};
      this.loadHistory();
    }
  }
  retryMap(target){if(!this.isConnected||!target.isConnected||!this._hass?.user?.is_admin)return;if(this.mapSessionExpired){location.reload();return;}if(this.map){this.mapRenewRetryAt=0;this.mapStatus(target,'正在恢复地图会话…');this.refreshMapSession();return;}this.buildMap(target);}
  async buildMap(target){
    const epoch=this.epoch,build={};this.mapBuild=build;this.mapStatus(target,'正在加载地图…');
    const valid=()=>this.isConnected&&epoch===this.epoch&&this.mapBuild===build&&target.isConnected&&this._hass?.user?.is_admin;
    let map;
    try{
      const config=await ensureSdkConfig(this._hass);if(!valid())return;
      const A=await sdk(config);if(!valid())return;
      if(correctWebGLMismatch(A)){this.mapStatus(target,'正在调整地图渲染兼容性…');return;}
      this.A=A;this.vectorLayer=A.createDefaultLayer({visible:true});
      const initialStyle=this.mapLayer==='dark'?'dark':'normal';
      map=new A.Map(target,{zoom:5,viewMode:'2D',mapStyle:'amap://styles/'+initialStyle,layers:[this.vectorLayer],resizeEnable:true,dragEnable:true,zoomEnable:true,scrollWheel:true,doubleClickZoom:true,touchZoom:true});this.map=map;this.appliedLayer=initialStyle==='dark'?'dark':'standard';this.vectorStyle=initialStyle;this.satelliteLayers=null;
      const on=(name,fn)=>{const cb=()=>{if(this.map===map&&valid())fn();};map.on(name,cb);this.mapListeners.push([name,cb]);};
      this.mapListeners=[];
      on('dragstart',()=>{this.cancelCamera();this.liveExpanded=null;});
      if(this.page==='live'){on('zoomend',()=>this.scheduleCluster());on('moveend',()=>this.scheduleCluster());}
      this.layer(this.mapLayer||'standard');if(this.page==='live')this.syncMarkers();else this.paintHistory();if(valid())this.mapStatus(target);
    }catch(e){const current=valid();if(map&&this.map===map)this.destroyMap();if(current&&target.isConnected){this.mapSessionExpired=expiredMapSession(e);const safeRetry=!this.mapSessionExpired&&webglState.force;this.mapStatus(target,this.mapSessionExpired?'地图会话已失效，请重新加载':safeRetry?'地图加载失败，可使用栅格兼容模式重试':'地图加载失败',()=>{if(safeRetry){if(!restartRaster())this.mapStatus(target,'无法保存兼容模式，请重新打开位置中心');}else this.retryMap(target);},this.mapSessionExpired?'重新加载':safeRetry?'兼容模式重试':'重试');}}
  }
  destroyMap(){
    this.mapBuild=null;this.mapRenewPending=null;this.mapSessionError=false;this.mapSessionExpired=false;this.mapRenewRetryAt=0;this.cancelCamera();if(this.clusterFrame!=null){cancelAnimationFrame(this.clusterFrame);this.clusterFrame=null;}
    this.liveExpanded=null;this.liveClusters=[];this.clusterSignature=null;this.historyOverlays=[];this.historyNumberMarkers=[];this.historyTrackData=null;this.historyTrackOverlays=null;this.historyXY=null;this.historyMarkerMap=null;this.appliedLayer=null;this.vectorLayer=null;this.vectorStyle=null;this.satelliteLayers=null;this.markers=new Map();this.didFit=false;
    const map=this.map,listeners=this.mapListeners||[];this.map=null;this.mapListeners=[];
    if(map){for(const [name,cb] of listeners){try{map.off(name,cb);}catch(e){}}try{map.destroy();}catch(e){}}
  }
  scheduleCluster(){
    if(this.clusterFrame!=null||!this.map)return;const map=this.map;
    this.clusterFrame=requestAnimationFrame(()=>{this.clusterFrame=null;if(this.map===map)this.clusterLive();});
  }
  async resolveAddress(entity,recorded_at,target){
    try{
      const r=await this._hass.callWS({type:NS+'address',entity_id:entity,...(recorded_at===undefined?{}:{recorded_at})});
      if(target.isConnected)target.textContent=r.address||'地址暂不可用';return r.address||null;
    }catch(e){if(target.isConnected)target.textContent='地址暂不可用';return null;}
  }
  stopHistoryAddresses(){
    if(this.historyAddressObserver)this.historyAddressObserver.disconnect();
    this.historyAddressObserver=null;this.historyAddressQueue=[];
    this.historyAddressGeneration=(this.historyAddressGeneration||0)+1;
  }
  watchHistoryAddresses(entity,seq){
    const generation=this.historyAddressGeneration;
    const enqueue=target=>{
      if(generation!==this.historyAddressGeneration||seq!==this.historySeq||this.page!=='history'||target._lxQueued||!target.isConnected)return;
      target._lxQueued=true;
      this.historyAddressQueue.push({entity,at:target._lxRecordedAt,target,seq,generation});
      this.drainHistoryAddresses();
    };
    if(typeof IntersectionObserver==='function'){
      this.historyAddressObserver=new IntersectionObserver(entries=>{
        for(const entry of entries)if(entry.isIntersecting){
          if(generation===this.historyAddressGeneration){this.historyAddressObserver?.unobserve(entry.target);enqueue(entry.target);}
        }
      },{root:null,rootMargin:'60px 0px'});
    }
    return target=>{if(generation!==this.historyAddressGeneration||seq!==this.historySeq)return;if(this.historyAddressObserver)this.historyAddressObserver.observe(target);else enqueue(target);};
  }
  async drainHistoryAddresses(){
    if(this.historyAddressBusy||document.hidden||this._hass?.connected===false)return;
    this.historyAddressBusy=true;
    try{
      while(this.historyAddressQueue?.length&&!document.hidden&&this._hass?.connected!==false){
        const item=this.historyAddressQueue.shift();
        if(item.generation!==this.historyAddressGeneration||item.seq!==this.historySeq||this.page!=='history'||!item.target.isConnected)continue;
        if(!this._hass?.user?.is_admin)break;
        if(this.historyResolved?.has(item.at)||this.historyFailed?.has(item.at))continue;
        const address=await this.resolveAddress(item.entity,item.at,item.target);
        if(item.generation===this.historyAddressGeneration&&item.seq===this.historySeq&&this.page==='history'){
          if(address){this.historyResolved.set(item.at,address);this.historyRegroup?.(item.at,address);}
          else{this.historyFailed?.add(item.at);for(const node of this.querySelectorAll('.lx-group-address'))if(node._lxRecordedAt===item.at)node.textContent='地址暂不可用';}
        }
      }
    }finally{this.historyAddressBusy=false;}
  }
  historyLabel(indices){
    const parts=[];let start=indices[0],end=start;
    for(const i of indices.slice(1)){if(i===end+1)end=i;else{parts.push(start===end?String(start+1):(start+1)+'–'+(end+1));start=end=i;}}
    if(start!==undefined)parts.push(start===end?String(start+1):(start+1)+'–'+(end+1));
    return parts.join(', ');
  }
  historyDistance(a,b){
    const rad=Math.PI/180,dlat=(b.latitude-a.latitude)*rad,dlon=(b.longitude-a.longitude)*rad;
    const h=Math.sin(dlat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dlon/2)**2;
    return 12742000*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
  }
  historyQuality(points){
    const flags=points.map(p=>({lowAccuracy:Number.isFinite(p.accuracy)&&p.accuracy>100,suspect:false}));
    // A strict A-B-A pattern is a hint, not a proof of GPS drift.
    // Never discard, relocate or change the timestamp of a reported point.
    for(let i=1;i+1<points.length;i++){
      const a=points[i-1],b=points[i],c=points[i+1];
      const ab=b.recorded_at-a.recorded_at,bc=c.recorded_at-b.recorded_at;
      if(ab<=0||bc<=0||ab+bc>TIMING.GPS_JUMP_MS)continue;
      if(![a,b,c].every(p=>Number.isFinite(p.accuracy)&&p.accuracy>0))continue;
      if(a.accuracy>50||c.accuracy>50||b.accuracy<=100||b.accuracy<3*Math.max(a.accuracy,c.accuracy))continue;
      const da=this.historyDistance(a,b),dc=this.historyDistance(b,c),ac=this.historyDistance(a,c);
      if(ac>Math.max(50,a.accuracy+c.accuracy))continue;
      const ua=a.accuracy+b.accuracy,uc=b.accuracy+c.accuracy;
      if(da>=Math.max(1000,5*ua)&&dc>=Math.max(1000,5*uc)&&(da-ua)/ab*3600>=300&&(dc-uc)/bc*3600>=300)flags[i].suspect=true;
    }
    return flags;
  }
  historySegment(a,b,flagA,flagB){
    const elapsed=b.recorded_at-a.recorded_at;
    // A line connects samples; it is never a reconstructed road or actual path.
    if(elapsed<=0)return 'break';
    if(a.latitude===b.latitude&&a.longitude===b.longitude)return 'break';
    return elapsed>this.policyValue('track_gap_minutes')*60000||flagA?.suspect||flagB?.suspect?'dashed':'solid';
  }
  historyGroups(points){
    const groups=[];let group=null,unique=null,counts=null,west=0,east=0,south=0,north=0;
    const rad=Math.PI/180;
    for(let i=0;i<points.length;i++){
      const p=points[i],addr=this.historyResolved?.get(p.recorded_at),key=p.latitude+','+p.longitude;
      let same=unique?.get(key),join=false;
      if(group){
        const otherCount=group.length-(same?.count||0);
        if(!otherCount)join=true;
        else if(addr&&((counts.get(addr)||0)-(same?.addresses.get(addr)||0)===otherCount)){
          // A conservative spherical upper bound avoids pairwise work for compact groups.
          const dlat=Math.max(Math.abs(p.latitude-south),Math.abs(p.latitude-north))*rad;
          const dlon=Math.max(Math.abs(p.longitude-west),Math.abs(p.longitude-east))*rad;
          const nearEquator=south<=0&&north>=0?0:Math.min(Math.abs(south),Math.abs(north));
          const h=Math.sin(Math.min(Math.PI,dlat)/2)**2+Math.cos(p.latitude*rad)*Math.cos(nearEquator*rad)*Math.sin(Math.min(Math.PI,dlon)/2)**2;
          join=12742000*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))))<29.99999;
          if(!join){join=true;for(const [k,q] of unique){if(k!==key&&this.historyDistance(p,q.point)>30){join=false;break;}}}
        }
      }
      if(!join){group=[];groups.push(group);unique=new Map();counts=new Map();west=east=p.longitude;south=north=p.latitude;same=null;}
      group.push(i);
      if(!same){same={point:p,count:0,addresses:new Map()};unique.set(key,same);west=Math.min(west,p.longitude);east=Math.max(east,p.longitude);south=Math.min(south,p.latitude);north=Math.max(north,p.latitude);}
      same.count++;same.addresses.set(addr,(same.addresses.get(addr)||0)+1);counts.set(addr,(counts.get(addr)||0)+1);
    }
    return groups;
  }
  selectHistoryMarker(index){
    this.selectedHistoryIndex=index;
    for(const item of this.historyNumberMarkers||[]){
      const selected=index!==null&&item.indices.includes(index);
      if(item.dot.textContent!==item.label)item.dot.textContent=item.label;
      if(item.selected!==selected){item.selected=selected;item.dot.classList.toggle('lx-track-selected',selected);item.marker.setzIndex?.(selected?200:120);}
    }
  }
  async loadHistory(){
    const select=this.querySelector('.lx-history-filter select'),day=this.querySelector('[data-history-date]'),timeline=this.querySelector('#history-timeline');
    if(!select||!day||!timeline||!this._hass?.user?.is_admin)return;
    this.stopHistoryAddresses();this.historyResolved=new Map();this.historyFailed=new Set();this.historyRegroup=null;this.selectedHistoryIndex=null;const seq=this.historySeq=(this.historySeq||0)+1;this.historyData=null;this.historyLoading=null;this.historyFlags=null;this.historyTimelineGroups=null;this.openHistoryPoint=null;this.closeHistoryPoint=null;this.paintHistory();
    timeline.replaceChildren(el('h2','定位时间轴'));
    if(!select.value||!day.value){timeline.append(this.stateView(this.data?'暂无可查询设备':this.dataError||'正在读取设备…'));return;}
    if(this._hass.connected===false){timeline.append(this.stateView('HA 连接已断开'));return;}
    const start=new Date(day.value+'T00:00:00'),end=new Date(start);end.setDate(end.getDate()+1);
    timeline.append(this.stateView('正在加载…'));this.historyLoading=seq;
    try{
      const r=await this._hass.callWS({type:NS+'history',entity_id:select.value,start:start.getTime(),end:end.getTime(),collapse_repeated:false});
      if(this.page!=='history'||seq!==this.historySeq||!timeline.isConnected)return;
      this.historyData=r.points;this.historyFlags=this.historyQuality(r.points);
      const title=el('div',undefined,'lx-title'),count=el('span','','lx-muted');title.dataset.historyLegend='1';title.title=this.historyLegend();count.title='位置为连续位置分组，记录为数据库中实际存储的定位记录';title.append(el('h2','定位时间轴'),count);timeline.replaceChildren(title);
      if(!r.points.length)timeline.append(this.stateView('当日暂无定位记录'));
      let shown=0,expanded=null,groups=this.historyGroups(r.points),limit=50,rendering=false;
      const updateCount=()=>{count.textContent=groups.length+' 个位置 · '+r.points.length+' 条记录'+(r.truncated?' · 已截断':'');};updateCount();
      const coordByTime=new Map(),timesByCoord=new Map();for(const p of r.points){const key=p.latitude+','+p.longitude;coordByTime.set(p.recorded_at,key);if(!timesByCoord.has(key))timesByCoord.set(key,[]);timesByCoord.get(key).push(p.recorded_at);}
      const entity=select.value,watchAddress=this.watchHistoryAddresses(entity,seq);
      const body=el('div',undefined,'lx-list-scroll');timeline.append(body);
      const timeOnly=t=>new Date(t).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
      const close=(restore=false)=>{if(!expanded)return;expanded.row.setAttribute('aria-expanded','false');expanded.card.classList.remove('lx-point-open');expanded.arrow.textContent='⌄';this.animatePoint(expanded.detail,false);expanded=null;if(restore){this.selectHistoryMarker(null);this.fitHistory();}};
      this.closeHistoryPoint=()=>close(false);
      const more=button('显示更多',()=>{limit+=50;render(true);});
      const render=(appendOnly=false)=>{
        if(rendering||seq!==this.historySeq||!body.isConnected)return;
        rendering=true;
        const active=this.selectedHistoryIndex,scroll=body.scrollTop;
        // Cancel obsolete visible-row observations; pending requests for removed DOM nodes are discarded.
        if(!appendOnly){this.historyAddressObserver?.disconnect();this.historyAddressQueue=[];expanded=null;body.replaceChildren();shown=0;}else more.remove();
        for(const indices of groups.slice(shown,limit)){
          const groupNumber=shown+1;
          const i=indices[0],p=r.points[i],card=el('div',undefined,'lx-point-card'),detail=el('div',undefined,'lx-point-address lx-group-detail'),arrow=el('span','⌄','lx-point-arrow');
          detail.hidden=true;
          const row=button('',()=>open(i,false),'lx-point-row'),number=el('span',String(groupNumber),'lx-point-number'),info=el('span',undefined,'lx-point-label');
          const address=el('span',this.historyResolved.get(p.recorded_at)||(this.historyFailed.has(p.recorded_at)?'地址暂不可用':'地址待加载'),'lx-group-address');address._lxRecordedAt=p.recorded_at;info.append(address);
          info.append(el('span',indices.length>1?indices.length+' 次定位记录':timeOnly(p.recorded_at),'lx-muted lx-group-count'));
          row.dataset.groupStart=String(i);row.setAttribute('aria-expanded','false');row.append(number,info,arrow);
          const focus=j=>{this.selectHistoryMarker(j);if(this.map)this.flyTo(this.gcj(r.points[j].longitude,r.points[j].latitude),17);for(const child of detail.children)child.classList.toggle('lx-raw-selected',Number(child.dataset.index)===j);};
          const open=(j,force)=>{populate();if(expanded?.row===row){if(!force){close(true);return;}focus(j);return;}close(false);expanded={row,card,arrow,detail};card.classList.add('lx-point-open');row.setAttribute('aria-expanded','true');arrow.textContent='⌃';this.animatePoint(detail,true);focus(j);};
          const populate=()=>{if(detail._lxPopulated)return;detail._lxPopulated=true;const fragment=document.createDocumentFragment();for(const j of indices){const raw=r.points[j],child=button('',()=>focus(j),'lx-raw-point'),quality=this.historyFlags?.[j],accuracy=el('span',raw.accuracy==null?'精度未知':Math.round(raw.accuracy)+' m','lx-muted');child.dataset.index=String(j);if(quality?.suspect){accuracy.textContent+=' · 疑似跳点';accuracy.title='短时远距离往返且中间点精度较低，仅提示，不代表确认漂移';accuracy.classList.add('lx-quality-warning');}else if(quality?.lowAccuracy){accuracy.textContent+=' · 低精度';accuracy.title='HA 报告的 GPS 精度大于100米，位置不确定范围较大';accuracy.classList.add('lx-quality-warning');}child.append(el('span',timeOnly(raw.recorded_at)),accuracy);fragment.append(child);}detail.append(fragment);};
          row.openPoint=j=>open(j,true);card.append(row,detail);body.append(card);
          if(!this.historyResolved.has(p.recorded_at)&&!this.historyFailed.has(p.recorded_at))watchAddress(address);
          // Exact coordinate groups reuse the representative address; distinct nearby points must resolve individually before merging.
          if(active!=null&&indices.includes(active)){populate();expanded={row,card,arrow,detail};card.classList.add('lx-point-open');row.setAttribute('aria-expanded','true');arrow.textContent='⌃';detail.hidden=false;for(const child of detail.children)child.classList.toggle('lx-raw-selected',Number(child.dataset.index)===active);}
          shown++;
        }
        if(shown<groups.length)body.append(more);
        if(scroll!=null)body.scrollTop=scroll;
        rendering=false;
      };
      this.historyRegroup=(at,address)=>{
        if(seq!==this.historySeq||!body.isConnected)return;
        // Only propagate the newly resolved address to exactly equal coordinates.
        for(const t of timesByCoord.get(coordByTime.get(at))||[])this.historyResolved.set(t,address);
        const next=this.historyGroups(r.points);
        if(JSON.stringify(next)===JSON.stringify(groups)){for(const node of body.querySelectorAll('.lx-group-address')){const addr=this.historyResolved.get(node._lxRecordedAt);if(addr)node.textContent=addr;}return;}
        groups=next;this.historyTimelineGroups=groups;updateCount();
        const active=this.selectedHistoryIndex;if(active!=null){const g=groups.findIndex(v=>v.includes(active));if(g>=limit)limit=g+1;}
        render();this.paintHistory(false);
      };
      this.historyTimelineGroups=groups;render();
      this.openHistoryPoint=i=>{if(seq!==this.historySeq||!body.isConnected)return;const g=groups.findIndex(v=>v.includes(i));if(g<0)return;if(g>=limit){limit=Math.ceil((g+1)/50)*50;render(true);}const row=body.querySelector('[data-group-start="'+groups[g][0]+'"]');if(row){row.openPoint(i);this.revealInList(body,row);}};
      this.paintHistory();
    }catch(e){if(seq===this.historySeq&&timeline.isConnected)timeline.replaceChildren(el('h2','定位时间轴'),this.stateView('历史轨迹查询失败',()=>this.loadHistory()));}finally{if(this.historyLoading===seq)this.historyLoading=null;}
  }
  animatePoint(detail,open){
    if(detail._lxAnimation){detail._lxAnimation.cancel();detail._lxAnimation=null;}
    const reduce=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(!detail.animate||reduce){detail.style.overflow='';detail.hidden=!open;return;}
    if(open)detail.hidden=false;
    const h=detail.getBoundingClientRect().height;
    const animation=detail.animate(open?[{height:'0px',opacity:0,paddingBottom:'0px'},{height:h+'px',opacity:1}]:[{height:h+'px',opacity:1},{height:'0px',opacity:0,paddingBottom:'0px'}],{duration:TIMING.DETAIL_ANIMATION_MS,easing:'ease',fill:'none'});
    detail._lxAnimation=animation;detail.style.overflow='hidden';
    animation.onfinish=()=>{if(detail._lxAnimation!==animation)return;detail._lxAnimation=null;detail.style.overflow='';detail.hidden=!open;};
  }
  fitHistory(){
    this.cancelCamera();if(!this.map||this.page!=='history'||!this.historyData?.length||!this.historyOverlays?.length)return;
    const first=this.historyData[0],xy=this.gcj(first.longitude,first.latitude);
    if(this.historyData.every(p=>Math.abs(p.longitude-first.longitude)<0.000001&&Math.abs(p.latitude-first.latitude)<0.000001))this.map.setZoomAndCenter(16,xy);
    else this.map.setFitView(this.historyOverlays,false,[45,45,45,45],16);
  }
  paintHistory(adjustView=true){
    if(!this.map||this.page!=='history')return;
    const map=this.map,A=this.A,points=this.historyData||[],seq=this.historySeq;
    if(this.historyTrackData!==this.historyData||!this.historyTrackOverlays){
      if(this.historyOverlays?.length)map.remove(this.historyOverlays);
      this.historyOverlays=[];this.historyNumberMarkers=[];this.historyMarkerMap=new Map();this.historyTrackOverlays=[];this.historyTrackData=this.historyData;
      this.historyXY=points.map(p=>this.gcj(p.longitude,p.latitude));
      const xy=this.historyXY;
      if(points.length){
        let run=[],style=null;
        const flags=this.historyFlags||this.historyQuality(points);
        const flush=()=>{if(run.length>1)this.historyTrackOverlays.push(new A.Polyline({path:run,strokeColor:'#4387e8',strokeWeight:style==='dashed'?3:4,strokeOpacity:style==='dashed'?0.55:0.9,strokeStyle:style,strokeDasharray:[8,6],lineJoin:'round',lineCap:'round',zIndex:10}));run=[];};
        for(let i=1;i<points.length;i++){
          const next=this.historySegment(points[i-1],points[i],flags[i-1],flags[i]);
          if(next==='break'){flush();style=null;continue;}
          if(style!==next){flush();style=next;}
          if(!run.length)run.push(xy[i-1]);
          run.push(xy[i]);
        }flush();
        if(this.historyTrackOverlays.length)map.add(this.historyTrackOverlays);
      }
    }
    if(!points.length)return;
    const xy=this.historyXY,groups=new Map(),previous=this.historyMarkerMap||new Map(),next=new Map(),added=[];
    const timelineGroups=this.historyTimelineGroups||this.historyGroups(points);
    for(let g=0;g<timelineGroups.length;g++){
      const indices=timelineGroups[g],i=indices[0],key=points[i].latitude+','+points[i].longitude;
      if(!groups.has(key))groups.set(key,{indices:[],numbers:[],starts:[]});
      const entry=groups.get(key);entry.indices.push(...indices);entry.numbers.push(g);entry.starts.push([i,indices[indices.length-1]]);
    }
    for(const [key,{indices,numbers,starts}] of groups){
      const i=indices[0],isFirst=indices.includes(0),isLast=indices.includes(points.length-1);
      const label=this.historyLabel(numbers),background=isFirst&&isLast?'#64748b':isFirst?'#059669':isLast?'#dc5252':'#4387e8';
      let item=previous.get(key);
      if(!item){
        const dot=el('div',label,'lx-track-end lx-track-number');dot.style.background=background;
        const marker=new A.Marker({position:xy[i],content:dot,anchor:'center',title:'位置 '+label,zIndex:120});
        item={marker,dot,indices,starts,label,background};
        marker.on('click',()=>{if(this.map!==map||this.historySeq!==seq||this.page!=='history'||this.historyMarkerMap?.get(key)!==item)return;const selected=this.selectedHistoryIndex,pos=selected==null?-1:item.starts.findIndex(([start,end])=>selected>=start&&selected<=end);this.openHistoryPoint?.(item.starts[(pos+1)%item.starts.length][0]);});
        added.push(marker);
      }else{
        if(item.label!==label){item.dot.textContent=label;item.marker.setTitle?.('位置 '+label);}
        if(item.background!==background)item.dot.style.background=background;
        item.indices=indices;item.starts=starts;item.label=label;item.background=background;
      }
      next.set(key,item);
    }
    const removed=[...previous].filter(([key])=>!next.has(key)).map(([,item])=>item.marker);
    if(removed.length)map.remove(removed);
    this.historyMarkerMap=next;this.historyNumberMarkers=[...next.values()];
    if(added.length)map.add(added);
    this.historyOverlays=[...this.historyTrackOverlays,...this.historyNumberMarkers.map(item=>item.marker)];
    this.selectHistoryMarker(this.selectedHistoryIndex??null);
    if(adjustView){if(this.selectedHistoryIndex==null)this.fitHistory();else if(xy[this.selectedHistoryIndex])map.setZoomAndCenter(17,xy[this.selectedHistoryIndex]);}
  }
  liveTime(t){
    if(!t)return '更新时间未知';const d=new Date(t),now=new Date(),y=new Date(now);y.setDate(y.getDate()-1);
    const time=d.toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const md=String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const prefix=d.toDateString()===now.toDateString()?'':d.toDateString()===y.toDateString()?'昨日 ':d.getFullYear()===now.getFullYear()?md+' ':d.getFullYear()+'-'+md+' ';
    return prefix+time;
  }
  retryLiveAddresses(){
    for(const row of this.querySelectorAll('.lx-live-row[data-focus]')){
      const node=row.querySelector('.lx-live-address');
      const d=this.data?.candidates.find(v=>v.entity_id===row.dataset.focus&&v.managed&&v.enabled&&v.position);
      if(node&&d&&node._lxRetryAt&&Date.now()>=node._lxRetryAt){node._lxRetryAt=0;this.liveAddress(d,node,this.liveSelected===d.entity_id);}
    }
  }
  pruneLiveAddresses(){
    const valid=new Map((this.data?.candidates||[]).filter(d=>d.managed&&d.enabled).map(d=>[d.entity_id,d.recording_generation]));
    for(const [key,entry] of this.liveAddressCache||[]){if(!valid.has(entry.entity)||valid.get(entry.entity)!==entry.generation)this.liveAddressCache.delete(key);}
  }
  async liveAddress(d,target,full){
    const p=d.position,key=JSON.stringify([d.entity_id,d.recording_generation,p.latitude,p.longitude]);
    const token={};target._lxAddressToken=token;target._lxRetryAt=0;
    if(document.hidden||this._hass?.connected===false){target._lxRetryAt=Date.now();return;}
    this.liveAddressCache??=new Map();let entry=this.liveAddressCache.get(key);
    if(!entry||Date.now()>=entry.until){
      entry={until:Date.now()+TIMING.ADDRESS_SUCCESS_MS,entity:d.entity_id,generation:d.recording_generation};
      entry.promise=this._hass.callWS({type:NS+'address',entity_id:d.entity_id,expected_updated_at:p.updated_at,expected_latitude:p.latitude,expected_longitude:p.longitude}).then(r=>r.address||null).catch(()=>null).then(address=>{entry.until=Date.now()+(address?TIMING.ADDRESS_SUCCESS_MS:TIMING.ADDRESS_FAILURE_MS);return address;});
      if(this.liveAddressCache.size>=128&&!this.liveAddressCache.has(key))this.liveAddressCache.delete(this.liveAddressCache.keys().next().value);
      this.liveAddressCache.set(key,entry);
    }
    const address=await entry.promise;
    const cached=this.liveAddressCache.get(key),current=this.data?.candidates?.find(v=>v.entity_id===d.entity_id);
    const usable=cached===entry||(!cached&&current?.managed&&current.enabled&&current.recording_generation===d.recording_generation&&current.position?.latitude===p.latitude&&current.position?.longitude===p.longitude);
    if(target.isConnected&&target._lxAddressToken===token&&this.page==='live'&&usable)target.textContent=address?(full?address:address.replace(/^(?:[^省]{2,8}省|内蒙古自治区|广西壮族自治区|宁夏回族自治区|新疆维吾尔自治区|西藏自治区)/,'')):'地址暂不可用';
    if(target.isConnected&&target._lxAddressToken===token&&this.page==='live')target._lxRetryAt=usable?entry.until:Date.now()+TIMING.ADDRESS_FAILURE_MS;
  }
  color(id){
    this.deviceColors??=new Map();const palette=['#4387e8','#0ca87d','#a855f7','#e58b25','#e05e86','#0891b2','#84a832','#c45e38'];
    if(!this.deviceColors.has(id)){const used=new Set(this.deviceColors.values());let color=palette.find(c=>!used.has(c));if(!color){let hue=(this.deviceColors.size*137.508)%360;color='hsl('+hue.toFixed(2)+',65%,48%)';}this.deviceColors.set(id,color);}
    return this.deviceColors.get(id);
  }
  // Local coordinate conversion avoids sending precise positions to the conversion service.
  gcj(lon,lat){
    if(lon<72.004||lon>137.8347||lat<0.8293||lat>55.8271)return [lon,lat];
    const x=lon-105,y=lat-35,pi=Math.PI,a=6378245,ee=0.006693421622965943;
    let dy=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x)),dx=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
    const common=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
    dy+=common+(20*Math.sin(y*pi)+40*Math.sin(y*pi/3))*2/3+(160*Math.sin(y*pi/12)+320*Math.sin(y*pi/30))*2/3;
    dx+=common+(20*Math.sin(x*pi)+40*Math.sin(x*pi/3))*2/3+(150*Math.sin(x*pi/12)+300*Math.sin(x*pi/30))*2/3;
    const rad=lat*pi/180,sin=Math.sin(rad),magic=1-ee*sin*sin,root=Math.sqrt(magic);
    return [lon+dx*180/(a/root*Math.cos(rad)*pi),lat+dy*180/(a*(1-ee)/(magic*root)*pi)];
  }
  syncMarkers(){
    if(!this.map||this.page!=='live')return;
    const A=this.A,map=this.map,devices=(this.data?.candidates||[]).filter(d=>d.managed&&d.enabled&&d.position);
    if(!this.markers)this.markers=new Map();
    const ids=new Set(devices.map(d=>d.entity_id));if(this.liveExpanded&&[...this.liveExpanded].some(id=>!ids.has(id))){this.liveExpanded=null;this.cancelCamera();}if(this.cameraMoving&&[...this.markers.keys()].some(id=>!ids.has(id)))this.cancelCamera();
    for(const [id,m] of this.markers)if(!ids.has(id)){map.remove([m.marker,...(m.circle?[m.circle]:[])]);this.markers.delete(id);this.clusterSignature=null;}
    for(const d of devices){
      const p=d.position,xy=this.gcj(p.longitude,p.latitude),color=this.color(d.entity_id);
      let m=this.markers.get(d.entity_id);
      if(!m){
        const dot=el('div',Array.from(d.name)[0]||'•','lx-marker');dot.style.background=color;dot.setAttribute('aria-label',d.name);
        const marker=new A.Marker({position:xy,content:dot,anchor:'center',offset:new A.Pixel(0,0),title:d.name});
        marker.on('click',()=>{if(this.map===map&&this.markers.get(d.entity_id)?.marker===marker){this.focusDevice(d.entity_id);this.drawSide();this.revealLiveDevice(d.entity_id);}});map.add(marker);m={marker,circle:null,xy,dot,name:d.name};this.markers.set(d.entity_id,m);this.clusterSignature=null;
      }
      if(m.name!==d.name){m.name=d.name;m.dot.textContent=Array.from(d.name)[0]||'•';m.dot.setAttribute('aria-label',d.name);m.marker.setTitle?.(d.name);}const moved=m.xy[0]!==xy[0]||m.xy[1]!==xy[1];if(moved){m.xy=xy;m.marker.setPosition(xy);}
      if(Number.isFinite(p.accuracy)&&p.accuracy>0){
        if(!m.circle){m.circle=new A.Circle({center:xy,radius:p.accuracy,strokeColor:color,strokeOpacity:.65,strokeWeight:1,fillColor:color,fillOpacity:.12,zIndex:5});map.add(m.circle);this.clusterSignature=null;}
        else{if(moved)m.circle.setCenter(xy);if(m.accuracy!==p.accuracy)m.circle.setRadius(p.accuracy);}
      }else if(m.circle){map.remove(m.circle);m.circle=null;this.clusterSignature=null;}
      m.accuracy=p.accuracy;
    }
    if(!this.didFit&&this.markers.size){this.didFit=true;if(this.liveSelected&&this.markers.has(this.liveSelected))this.focusDevice(this.liveSelected);else this.fitMarkers();}this.clusterLive();
  }
  cancelCamera(){
    this.cameraSeq=(this.cameraSeq||0)+1;
    if(this.cameraFrame!=null){cancelAnimationFrame(this.cameraFrame);this.cameraFrame=null;}
    this.cameraMoving=false;
  }
  flyTo(xy,zoom,done){
    this.cancelCamera();const map=this.map;if(!map)return;
    const seq=this.cameraSeq,center=map.getCenter(),from=[center.lng,center.lat],startZoom=map.getZoom();
    const distance=this.historyDistance({longitude:from[0],latitude:from[1]},{longitude:xy[0],latitude:xy[1]});
    const reduce=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduce||!Number.isFinite(distance)||distance<2&&Math.abs(startZoom-zoom)<.1){map.setZoomAndCenter(zoom,xy,true);if(this.page==='live')this.scheduleCluster();done?.();return;}
    const far=distance>30000,duration=far?TIMING.MAP_FAR_MS:distance>1000?TIMING.MAP_MEDIUM_MS:TIMING.MAP_NEAR_MS;
    const mid=Math.min(startZoom,zoom,Math.max(3,Math.log2(40075000/Math.max(distance*2,1)/256)+1));
    const begin=performance.now();this.cameraMoving=true;
    const ease=t=>t*t*(3-2*t);
    const tick=now=>{
      if(seq!==this.cameraSeq||map!==this.map)return;
      try{
      const t=Math.min(1,(now-begin)/duration);let p=ease(t),z=startZoom+(zoom-startZoom)*p;
      if(far){if(t<.25){p=0;z=startZoom+(mid-startZoom)*ease(t/.25);}else if(t<.7){p=ease((t-.25)/.45);z=mid;}else{p=1;z=mid+(zoom-mid)*ease((t-.7)/.3);}}
      map.setZoomAndCenter(z,[from[0]+(xy[0]-from[0])*p,from[1]+(xy[1]-from[1])*p],true);
      if(t<1)this.cameraFrame=requestAnimationFrame(tick);else{this.cameraFrame=null;this.cameraMoving=false;map.setZoomAndCenter(zoom,xy,true);if(this.page==='live')this.scheduleCluster();done?.();}
      }catch(e){if(seq===this.cameraSeq){this.cancelCamera();if(this.page==='live')this.scheduleCluster();}}
    };this.cameraFrame=requestAnimationFrame(tick);
  }
  expandLiveCluster(group,center){
    const map=this.map;if(!map)return;
    this.liveSelected=null;this.liveExpanded=new Set(group.map(v=>v.id));
    const zoom=map.getZoom();let min=Infinity;
    for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++)min=Math.min(min,Math.hypot(group[i].x-group[j].x,group[i].y-group[j].y));
    const needed=min>0?zoom+Math.log2(84/min):18;
    const max=18;
    this.flyTo(center,Math.min(max,Math.max(zoom+1,Math.ceil(needed))),()=>this.clusterLive());
    this.drawSide();
  }
  clusterLive(){
    if(!this.map||this.page!=='live'||!this.markers||this.cameraMoving)return;
    const map=this.map,A=this.A;
    const groups=[];
    for(const [id,m] of this.markers){
      let px;try{px=map.lngLatToContainer(new A.LngLat(m.xy[0],m.xy[1]));}catch(e){continue;}
      if(!px||!Number.isFinite(px.x)||!Number.isFinite(px.y))continue;
      const item={id,m,x:px.x,y:px.y};
      const group=groups.find(g=>g.every(v=>Math.hypot(v.x-item.x,v.y-item.y)<52));
      if(group)group.push(item);else groups.push([item]);
    }
    const zoom=map.getZoom(),signature=JSON.stringify([this.liveSelected,[...(this.liveExpanded||[])],zoom,groups.map(g=>g.map(v=>[v.id,v.m.xy[0],v.m.xy[1],!!v.m.circle,...(this.liveExpanded&&zoom>=17.9?[Math.round(v.x*10),Math.round(v.y*10)]:[])]))]);
    if(signature===this.clusterSignature)return;
    this.clusterSignature=null;
    if(this.liveClusters?.length)map.remove(this.liveClusters);this.liveClusters=[];
    for(const m of this.markers.values()){m.marker.setOffset?.(new A.Pixel(0,0));m.marker.show();if(m.circle)m.circle.show();}
    for(const group of groups){
      if(group.length<2)continue;
      if(this.liveExpanded&&group.every(v=>this.liveExpanded.has(v.id))&&map.getZoom()>=17.9){
        const radius=Math.max(48,group.length*13);
        group.forEach((v,i)=>{
          const angle=-Math.PI/2+i*2*Math.PI/group.length,dx=Math.cos(angle)*radius,dy=Math.sin(angle)*radius;
          v.m.marker.setOffset?.(new A.Pixel(dx,dy));
          const truePoint=new A.LngLat(v.m.xy[0],v.m.xy[1]);
          try{const anchor=map.containerToLngLat(new A.Pixel(v.x+dx,v.y+dy));const line=new A.Polyline({path:[truePoint,anchor],strokeColor:this.color(v.id),strokeOpacity:.75,strokeWeight:1,strokeStyle:'dashed'});this.liveClusters.push(line);}catch(e){}
        });continue;
      }
      if(this.liveSelected&&group.some(v=>v.id===this.liveSelected)){
        for(const v of group)if(v.id!==this.liveSelected){v.m.marker.hide();if(v.m.circle)v.m.circle.hide();}
        continue;
      }
      for(const v of group){v.m.marker.hide();if(v.m.circle)v.m.circle.hide();}
      const center=[group.reduce((a,v)=>a+v.m.xy[0],0)/group.length,group.reduce((a,v)=>a+v.m.xy[1],0)/group.length];
      const dot=el('div',String(group.length),'lx-marker');dot.style.background='#4387e8';dot.setAttribute('aria-label',group.length+' 台设备');
      const marker=new A.Marker({position:center,content:dot,anchor:'center',zIndex:130});
      marker.on('click',()=>{if(this.map===map&&this.liveClusters.includes(marker))this.expandLiveCluster(group,center);});this.liveClusters.push(marker);
    }
    if(this.liveClusters.length)map.add(this.liveClusters);this.clusterSignature=signature;
  }
  fitMarkers(){this.cancelCamera();this.liveExpanded=null;if(!this.map||!this.markers?.size)return;const list=[...this.markers.values()];if(list.length===1){this.map.setZoomAndCenter(16,list[0].xy);return;}this.map.setFitView(list.map(x=>x.marker),false,[60,60,60,60],16);}
  resetMapView(){
    if(this.page==='history'){this.closeHistoryPoint?.();this.selectHistoryMarker(null);this.fitHistory();return;}
    if(this.page!=='live')return;
    this.liveSelected=null;this.fitMarkers();this.clusterLive();this.drawSide();
  }
  revealInList(list,row){
    if(!list||!row||!row.isConnected)return;
    const box=list.getBoundingClientRect(),rect=row.getBoundingClientRect();
    if(rect.top<box.top)list.scrollTop+=rect.top-box.top;
    else if(rect.bottom>box.bottom)list.scrollTop+=Math.min(rect.top-box.top,rect.bottom-box.bottom);
  }
  revealLiveDevice(id){const view=this.liveListView;this.revealInList(view?.list,view?.rows.get(id)?.row);}
  focusDevice(id){
    this.liveSelected=id;this.liveExpanded=null;
    const m=this.markers?.get(id);if(m&&this.map){this.flyTo(m.xy,16);this.clusterLive();}
  }
  layer(id){
    if(!['standard','satellite','dark'].includes(id))return;
    const map=this.map,A=this.A;
    if(map&&this.appliedLayer!==id){
      // One permanent vector layer for normal/dark. Never replace it with
      // another default layer or rely on setLayers to detach satellite tiles.
      if(id==='satellite'){
        if(!this.satelliteLayers)this.satelliteLayers=[new A.TileLayer.Satellite({visible:false}),new A.TileLayer.RoadNet({visible:false})];
        const layers=this.satelliteLayers;
        this.vectorLayer.hide();
        // A layer may still be attached in some SDK builds after removal.
        const attached=map.getLayers();
        const missing=layers.filter(layer=>!attached.includes(layer));
        if(missing.length)map.add(missing);
        for(const layer of layers)layer.show();
      }else{
        const layers=this.satelliteLayers;
        if(layers&&this.appliedLayer==='satellite'){
          // Hide first so a delayed SDK detach cannot leave duplicate labels.
          for(const layer of layers)layer.hide();
          map.remove(layers);
        }
        this.vectorLayer.show();
        const style=id==='dark'?'dark':'normal';
        if(this.vectorStyle!==style){
          map.setMapStyle('amap://styles/'+style);
          this.vectorStyle=style;
        }
      }
      this.appliedLayer=id;
    }
    this.mapLayer=id;
    for(const b of this.querySelectorAll('[data-layer]'))b.setAttribute('aria-pressed',String(b.dataset.layer===id));
  }
  drawRuntimePolicy(){
    const card=el('section',undefined,'lx-card');card.append(el('h2','运行策略'));
    const options=[
      ['discovery_minutes','设备自动发现','GPS 设备兜底扫描周期',v=>v+' 分钟'],
      ['live_refresh_seconds','实时位置刷新','无状态变化时的兜底同步',v=>v+' 秒'],
      ['backfill_minutes','历史记录补查','Recorder 周期性补查',v=>v<60?v+' 分钟':v/60+' 小时'],
      ['track_gap_minutes','轨迹虚线间隔','超过指定时间使用虚线连接',v=>v+' 分钟']
    ];
    for(const [key,label,hint,format] of options){
      const row=el('div',undefined,'lx-row'),info=el('div',undefined,'lx-name'),select=el('select',undefined,'lx-field lx-policy-select');
      info.append(el('strong',label),el('div',hint,'lx-muted'));select.setAttribute('aria-label',label);select.dataset.controlKey='policy:'+key;
      for(const value of POLICY_OPTIONS[key]){const option=el('option',format(value));option.value=String(value);select.append(option);}
      select.value=String(this.policyValue(key));select.onchange=()=>{const value=Number(select.value);select.value=String(this.policyValue(key));if(POLICY_OPTIONS[key].includes(value))this.refresh('policy',undefined,false,{[key]:value});};
      const selectWrap=el('div',undefined,'lx-policy-select-wrap');selectWrap.append(select,selectArrowIcon());row.append(info,selectWrap);card.append(row);
    }
    const reset=button('恢复默认设置',()=>this.refresh('policy',undefined,false,{...DEFAULT_POLICY}));reset.dataset.controlKey='policy:reset';card.append(reset);
    return card;
  }
  drawData(){
    const main=this.querySelector('.lx-content'),scroll=main.scrollTop,excludedOpen=main.querySelector('[data-excluded]')?.open||false,openMenu=main.querySelector('.lx-more[open] summary')?.dataset.controlKey,focused=document.activeElement?.dataset?.controlKey;main.replaceChildren();main.append(this.menuButton());const data=this.data;
    if(!data){const card=el('div',undefined,'lx-card');card.append(this.stateView(this.dataError||'正在读取设备信息…',this.dataError?()=>this.refresh():null));main.append(card);return;}
    const stack=el('div',undefined,'lx-stack');main.append(stack);
    if(this.page==='devices'){
      const managed=data.candidates.filter(d=>d.managed),removed=data.candidates.filter(d=>!d.managed),heading=el('div',undefined,'lx-title');heading.append(el('strong','已管理设备'),el('span',managed.length+' 台','lx-muted'));stack.append(heading);
      const grid=el('div',undefined,'lx-grid');
      for(const d of managed){
        const card=el('section',undefined,'lx-card'),head=el('div',undefined,'lx-device-head'),avatar=el('div',undefined,'lx-avatar'),info=el('div',undefined,'lx-name');avatar.append(icon(/ipad|tablet|平板/i.test(d.name)?'tablet':'mdi:cellphone'));avatar.style.color=this.color(d.entity_id);info.append(el('strong',d.name),el('div',d.available?'定位可用':'暂无定位','lx-muted'));
        const more=el('details',undefined,'lx-more'),summary=el('summary');summary.setAttribute('aria-label',d.name+' 更多操作');summary.dataset.controlKey='menu:'+d.entity_id;more.open=openMenu===summary.dataset.controlKey;summary.append(icon('mdi:dots-horizontal'));const menu=el('div',undefined,'lx-more-panel');
        const keep=button('移除并保留历史',()=>{more.open=false;this.refresh('remove',d.entity_id,false);}),erase=button('移除并删除历史',()=>{more.open=false;if(confirm('确定移除该设备并删除本集成中已有的历史记录？此操作不可恢复。'))this.refresh('remove',d.entity_id,true);});erase.classList.add('lx-danger');menu.append(keep,erase);more.append(summary,menu);head.append(avatar,info,more);card.append(head);
        const row=el('div',undefined,'lx-row'),label=el('label',undefined,'lx-switch'),toggle=el('input');toggle.type='checkbox';toggle.checked=d.enabled;toggle.setAttribute('aria-label',d.name+' 历史记录');toggle.dataset.controlKey='record:'+d.entity_id;toggle.onchange=()=>{const checked=toggle.checked;toggle.checked=d.enabled;this.refresh(checked?'enable':'disable',d.entity_id);};label.append(toggle);row.append(el('span','历史记录'),label);card.append(row);grid.append(card);
      }
      if(!managed.length)grid.append(el('div','暂无设备','lx-card'));stack.append(grid);
      const excluded=el('details',undefined,'lx-card'),summary=el('summary','已移除设备 · '+removed.length+' 台');excluded.dataset.excluded='1';excluded.open=excludedOpen;excluded.append(summary);for(const d of removed){const row=el('div',undefined,'lx-row'),add=button('重新添加',()=>this.refresh('add',d.entity_id));add.dataset.controlKey='add:'+d.entity_id;row.append(el('span',d.name,'lx-name'),add);excluded.append(row);}stack.append(excluded);
      stack.append(el('p','首次开启历史记录自动导入可用历史；关闭后保留已有数据。仅对已有位置共享许可的设备开启记录。','lx-muted'));
    }else{
      const d=data.storage,card=el('section',undefined,'lx-card');card.append(el('h2','数据存储'));
      if(!d)card.append(el('p','正在读取存储信息…','lx-muted'));else for(const [name,value] of [['历史保留',String(d.retention_days)+' 天'],['数据库大小',(d.database_bytes/1024).toFixed(1)+' KB'],['地址缓存',String(d.address_cache_count??0)+' 条'],['历史定位点',String(d.location_count)],['最近清理',fmt(d.last_cleanup)]]){const row=el('div',undefined,'lx-row');row.append(el('span',name),el('strong',value));card.append(row);}
      stack.append(this.drawRuntimePolicy(),card);

      const ui=el('section',undefined,'lx-card');ui.append(el('h2','界面设置'));const uiRow=el('div',undefined,'lx-row'),uiLabel=el('label',undefined,'lx-switch'),uiToggle=el('input');uiToggle.type='checkbox';uiToggle.checked=this.showHeader;uiToggle.setAttribute('aria-label','显示顶部标题栏');uiToggle.dataset.controlKey='show-header';uiToggle.onchange=()=>{this.showHeader=uiToggle.checked;try{localStorage.setItem('luxe_location.show_header',this.showHeader?'1':'0');}catch(e){}this.applyHeader();};uiLabel.append(uiToggle);uiRow.append(el('span','显示顶部标题栏'),uiLabel);ui.append(uiRow);stack.prepend(ui);
      const about=el('section',undefined,'lx-card');about.append(el('h2','关于'),el('div','Locaris · '+VERSION));stack.append(about);
    }
    main.scrollTop=scroll;
    if(focused){const control=Array.from(main.querySelectorAll('[data-control-key]')).find(v=>v.dataset.controlKey===focused);control?.focus({preventScroll:true});}
  }
}
if(!customElements.get('locaris-panel'))customElements.define('locaris-panel',LocationPanel);
