const VERSION='0.1.14-preview';
let sdkPromise;
function sdk(config){
  if(sdkPromise)return sdkPromise;
  sdkPromise=new Promise((resolve,reject)=>{
    if(window.AMap){reject(new Error('页面已加载其他高德 SDK，请刷新页面'));return;}
    window._AMapSecurityConfig={serviceHost:new URL(config.proxy_path,location.origin).href};
    const s=document.createElement('script');
    const timer=setTimeout(()=>{s.remove();reject(new Error('SDK 加载超时'));},20000);
    s.src='https://webapi.amap.com/maps?v=2.0&key='+encodeURIComponent(config.map_key);
    s.onload=()=>{clearTimeout(timer);window.AMap?resolve(window.AMap):reject(new Error('SDK 对象不存在'));};
    s.onerror=()=>{clearTimeout(timer);s.remove();reject(new Error('SDK 网络加载失败'));};
    document.head.appendChild(s);
  }).catch(e=>{sdkPromise=null;throw e;});
  return sdkPromise;
}


const TABS=[['live','实时位置','mdi:map-marker-radius-outline'],['history','历史轨迹','mdi:map-marker-path'],['devices','设备管理','mdi:cellphone'],['settings','设置','mdi:cog-outline']];
const NS='luxe_location_probe/';
const fmt=t=>t?new Date(t).toLocaleString('zh-CN',{hour12:false}):'—';
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const icon=name=>{const paths={'mdi:menu':'M4 6h16M4 12h16M4 18h16','mdi:map-marker-radius-outline':'M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z M12 6a3 3 0 1 0 0 6 3 3 0 1 0 0-6','mdi:map-marker-path':'M5 6a2 2 0 1 0 0 4 2 2 0 1 0 0-4 M19 14a2 2 0 1 0 0 4 2 2 0 1 0 0-4 M7 8h7a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h7','mdi:cellphone':'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M10 18h4','mdi:cog-outline':'M10 2h4l.7 3 2 .9 2.7-1.6 2 3.5-2.3 2.1v2.2l2.3 2.1-2 3.5-2.7-1.6-2 .9-.7 3h-4l-.7-3-2-.9-2.7 1.6-2-3.5L5 12.1V9.9L2.7 7.8l2-3.5 2.7 1.6 2-.9z M12 8a3 3 0 1 0 0 6 3 3 0 1 0 0-6','mdi:dots-horizontal':'M5 12h.1M12 12h.1M19 12h.1','tablet':'M5 3h14v18H5z M10 18h4','layers':'M3 8l9-5 9 5-9 5z M3 12l9 5 9-5 M3 16l9 5 9-5','locate':'M12 2v4 M12 18v4 M2 12h4 M18 12h4 M12 6a6 6 0 1 0 0 12 6 6 0 1 0 0-12'};const ns='http://www.w3.org/2000/svg',e=document.createElementNS(ns,'svg'),p=document.createElementNS(ns,'path');e.setAttribute('viewBox','0 0 24 24');e.setAttribute('width','22');e.setAttribute('height','22');e.setAttribute('aria-hidden','true');p.setAttribute('d',paths[name]||paths['mdi:cellphone']);p.setAttribute('fill','none');p.setAttribute('stroke','currentColor');p.setAttribute('stroke-width',name==='mdi:dots-horizontal'?'4':'1.8');p.setAttribute('stroke-linecap','round');p.setAttribute('stroke-linejoin','round');e.append(p);return e;};
const button=(text,fn,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=fn;return b;};
class LocationPanel extends HTMLElement{
  set hass(v){this._hass=v;if(this.isConnected&&this.viewportResize)this.syncHostLayout();if(this.isConnected&&!this.started)this.start();}
  connectedCallback(){this.page='live';this.epoch=(this.epoch||0)+1;this.render();if(this._hass)this.start();}
  disconnectedCallback(){this.epoch++;this.started=false;clearInterval(this.timer);this.stopViewport();this.stopHistoryAddresses();this.destroyMap();}
  render(){
    this.innerHTML=`<style>
    html,body{margin:0;padding:0;height:100%;overflow:hidden;background:var(--primary-background-color,#131820);overscroll-behavior:none}luxe-location-probe{display:block;height:100vh;height:var(--lx-viewport,100dvh);width:100%;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--primary-text-color,#e7eaf0);background:var(--primary-background-color,#131820);-webkit-text-size-adjust:100%;text-size-adjust:100%;--lx-accent:var(--primary-color,#4387e8);--lx-card:var(--card-background-color,#202733);--lx-line:var(--divider-color,#394453)}
    luxe-location-probe *{box-sizing:border-box}.lx-shell{height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;padding:10px;overflow:hidden}
    .lx-head,.lx-tabs,.lx-row,.lx-actions,.lx-title{display:flex;align-items:center;gap:10px}
    .lx-head{flex:none;min-height:44px}.lx-menu{display:none}.lx-map-tools summary{list-style:none;cursor:pointer;padding:7px;display:flex}.lx-map-tools summary::-webkit-details-marker{display:none}.lx-map-tools details:not([open]) button{display:none}.lx-map-tools details button{display:block;width:100%}.lx-list-row[data-focus]{cursor:pointer}.lx-list-row[data-focus]:hover{background:var(--secondary-background-color,#293441)}.lx-marker{width:32px;height:32px;border:2px solid white;border-radius:50%;display:grid;place-items:center;color:white;font:bold 13px sans-serif;box-shadow:0 2px 8px #0006}.lx-marker-label{background:#182330;color:white;padding:3px 7px;border-radius:6px;white-space:nowrap;font:12px sans-serif;margin-top:3px;text-align:center}.lx-head h1{font-size:21px;margin:0;font-weight:650;flex:1}.lx-tabs{gap:4px;flex:none}
    luxe-location-probe button{font:inherit;color:inherit;cursor:pointer;background:transparent;border:0;border-radius:9px;padding:8px 12px}
    luxe-location-probe button:focus-visible{outline:2px solid var(--lx-accent);outline-offset:1px}
    luxe-location-probe button:disabled{opacity:.5;cursor:default}
    .lx-tabs button{display:flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;color:var(--secondary-text-color,#a6afbd)}
    .lx-tabs button[aria-selected=true]{color:var(--lx-accent);background:var(--secondary-background-color,#293441)}
    .lx-tabs ha-icon{--mdc-icon-size:21px}.lx-menu ha-icon{--mdc-icon-size:24px}
    .lx-content{flex:1;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain}
    .lx-card{background:var(--lx-card);border:1px solid var(--lx-line);border-radius:14px;padding:14px;min-width:0}
    .lx-card h2{font-size:16px;margin:0;font-weight:650}.lx-muted{color:var(--secondary-text-color,#a6afbd);font-size:12px;overflow-wrap:anywhere}
    .lx-title{justify-content:space-between;margin-bottom:10px}.lx-row{justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--lx-line)}.lx-row:last-child{border:0}.lx-actions{flex-wrap:wrap}
    .lx-map-layout{display:grid;grid-template-rows:minmax(0,1fr);grid-template-columns:minmax(260px,320px) minmax(0,1fr);grid-template-areas:'side map';gap:10px;height:100%;min-height:0}.lx-map-layout[data-mode=history]{grid-template-rows:auto minmax(0,1fr);grid-template-areas:'filter map' 'side map'}.lx-map{grid-area:map}.lx-side{grid-area:side}.lx-history-filter{grid-area:filter;position:relative;z-index:8}.lx-history-filter .lx-stack{margin-top:6px}.lx-side>.lx-card{display:flex;flex-direction:column;min-height:0;max-height:100%;overflow:hidden}.lx-side>.lx-card>.lx-title{flex:none}.lx-list-scroll{min-height:0;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:thin}.lx-map-layout[data-mode] .lx-side{overflow:hidden}.lx-content.lx-map-page{overflow:hidden}.lx-live-row{position:relative;border:0!important;border-radius:9px;padding:10px 5px}.lx-live-row+.lx-live-row:before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:var(--lx-line);pointer-events:none}.lx-live-row[aria-pressed=true]{background:var(--secondary-background-color,#293441)}.lx-live-address{font-size:13px;overflow-wrap:anywhere}.lx-live-meta{font-size:11px}.lx-list-row[data-focus]{-webkit-tap-highlight-color:transparent}.lx-list-row[data-focus]:not([aria-pressed=true]){background:transparent}
    .lx-side{display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto}.lx-map{position:relative;isolation:isolate;overflow:hidden;border-radius:14px;min-height:0;background:var(--lx-card)}
    .lx-track-end{width:30px;height:30px;border:2px solid white;border-radius:50%;display:grid;place-items:center;color:white;font:bold 12px sans-serif;box-shadow:0 2px 6px #0005}.lx-selected-point{padding:10px;margin:8px 0;border:1px solid var(--lx-line);border-radius:9px}.lx-track-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--secondary-text-color,#a6afbd);margin-top:10px}.lx-track-legend span:before{content:'';display:inline-block;width:24px;border-top:3px solid #4387e8;vertical-align:middle;margin-right:5px}.lx-track-legend span:last-child:before{border-top-style:dashed;opacity:.65}.lx-map-inner{position:absolute;inset:0;touch-action:none}.lx-map-tools{position:absolute;right:10px;top:10px;z-index:5;display:flex;flex-direction:column;gap:4px;background:var(--lx-card);border-radius:10px;padding:4px;box-shadow:0 2px 12px #0002}
    .lx-map-tools button{padding:7px;font-size:12px}.lx-map-tools button[aria-pressed=true]{color:var(--lx-accent)}
    .lx-error{color:#e7a23b;font-size:13px;flex:none}.lx-error:empty{display:none}.lx-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.lx-stack{display:flex;flex-direction:column;gap:10px;max-width:1000px;margin:auto}
    .lx-device-head{display:flex;align-items:center;gap:10px}.lx-avatar{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--secondary-background-color,#293441);color:var(--lx-accent);flex:none}.lx-name{flex:1;min-width:0;overflow-wrap:anywhere}
    .lx-switch{display:flex;align-items:center;gap:8px;cursor:pointer}.lx-switch input{appearance:none;-webkit-appearance:none;width:42px;height:24px;border-radius:20px;background:#78838e;position:relative;cursor:pointer;margin:0}.lx-switch input:checked{background:var(--lx-accent)}.lx-switch input:before{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;background:white;border-radius:50%;transition:transform .15s}.lx-switch input:checked:before{transform:translateX(18px)}
    .lx-more{position:relative}.lx-more summary{cursor:pointer;list-style:none;padding:8px}.lx-more summary::-webkit-details-marker{display:none}.lx-more-panel{position:absolute;right:0;top:100%;z-index:10;min-width:180px;background:var(--lx-card);border:1px solid var(--lx-line);border-radius:10px;padding:5px;box-shadow:0 6px 20px #0003}.lx-more-panel button{display:block;width:100%;text-align:left;white-space:nowrap}
    .lx-calendar-wrap{position:relative;min-width:0}.lx-date-trigger{display:flex;align-items:center;gap:8px;text-align:left}.lx-date-arrow{margin-left:auto}.lx-calendar{width:100%;margin-top:8px;padding:8px;background:var(--lx-card);border:1px solid var(--lx-line);border-radius:12px}.lx-calendar[hidden],.lx-point-address[hidden]{display:none!important}.lx-cal-header{display:flex;align-items:center;justify-content:space-between;gap:4px}.lx-cal-header button{min-height:34px;padding:4px 10px}.lx-cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;text-align:center;align-items:center;margin:6px 0}.lx-cal-grid button{padding:0;height:34px;min-width:0;font-size:14px;border-radius:8px}.lx-cal-grid button[aria-pressed=true]{background:var(--lx-accent);color:white}.lx-cal-grid button:disabled{opacity:.3}.lx-cal-today:not([aria-pressed=true]){color:var(--lx-accent);font-weight:bold}.lx-group-address{display:block}.lx-group-count{display:block;margin-top:3px}.lx-group-detail:not([hidden]){display:flex;flex-direction:column;gap:4px;padding-left:8px}.lx-raw-point{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:6px 4px!important}.lx-raw-point>span:last-child{margin-left:auto}.lx-raw-number{min-width:24px;text-align:center;font-size:12px;color:var(--secondary-text-color,#a6afbd)}.lx-raw-selected{color:var(--lx-accent);background:var(--secondary-background-color,#293441)}.lx-point-number{display:grid;place-items:center;flex:none;min-width:26px;height:26px;padding:0 5px;border-radius:20px;background:var(--secondary-background-color,#303c4b);color:var(--secondary-text-color,#a6b4c5);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}.lx-point-row[aria-expanded=true] .lx-point-number{background:var(--lx-accent);color:white}.lx-point-label{flex:1;min-width:0;overflow-wrap:anywhere;font-size:13px;line-height:1.5}.lx-point-row[aria-expanded=true] .lx-point-label{color:var(--lx-accent)}.lx-track-number{min-width:28px;width:auto;padding:0 5px;white-space:nowrap}.lx-track-selected{transform:scale(1.25);box-shadow:0 0 0 5px #4387e855,0 2px 6px #0005}.lx-point-address:not([hidden]){display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap}.lx-point-card{position:relative;border-radius:9px;padding:3px 0}.lx-point-card+.lx-point-card:before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:var(--lx-line);pointer-events:none}.lx-point-open{background:var(--secondary-background-color,#293441)}.lx-point-row{display:flex;width:100%;align-items:center;gap:8px;text-align:left;padding:10px 6px!important}.lx-point-row svg{flex:none;color:var(--secondary-text-color,#8997a9);width:18px;height:18px}.lx-point-row[aria-expanded=true] svg{color:var(--lx-accent)}.lx-point-row[aria-expanded=true] .lx-point-time,.lx-point-row[aria-expanded=true] .lx-point-arrow{color:var(--lx-accent)}.lx-point-row .lx-pin-filled{display:none}.lx-point-row[aria-expanded=true] .lx-pin-filled{display:block}.lx-point-row[aria-expanded=true] .lx-pin-outline{display:none}.lx-point-time{flex:1;font-variant-numeric:tabular-nums;white-space:nowrap}.lx-point-arrow{color:var(--secondary-text-color,#a6afbd);font-size:16px}.lx-point-address{padding:0 10px 10px 32px;font-size:13px;color:var(--secondary-text-color,#a6afbd);overflow-wrap:anywhere}.lx-field{font:inherit;width:100%;padding:8px;border:1px solid var(--lx-line);border-radius:8px;background:var(--lx-card);color:inherit}.lx-sub{margin:8px 0 0}.lx-list-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--lx-line)}.lx-list-row:last-child{border:0}
    @media(max-width:760px){.lx-menu{display:block}.lx-head h1{font-size:20px}.lx-tabs{order:5;justify-content:space-around;border-top:1px solid var(--lx-line);padding:3px 0 max(0px, calc(env(safe-area-inset-bottom,0px) - var(--lx-host-safe-bottom,0px)))}.lx-tabs button{flex:1;flex-direction:column;gap:2px;padding:2px;font-size:11px}.lx-tabs ha-icon{--mdc-icon-size:23px}.lx-grid{grid-template-columns:1fr}.lx-map-layout{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr);grid-template-areas:'map' 'side';height:100%;min-height:0}.lx-map-layout[data-mode=history]{grid-template-rows:auto minmax(0,1fr) minmax(0,1fr);grid-template-areas:'filter' 'map' 'side'}.lx-map{height:auto;min-height:0}.lx-side{overflow:hidden}.lx-history-filter h2{display:none}.lx-history-filter .lx-stack{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:8px;margin:0}.lx-history-filter .lx-date-trigger{font-size:12px;white-space:nowrap;padding:8px 5px}.lx-history-filter .lx-calendar{position:absolute;right:0;top:100%;width:min(310px,calc(100vw - 40px));z-index:15;box-shadow:0 8px 24px #0005}.lx-tabs button[aria-selected=true]{background:transparent}.lx-tabs button[aria-selected=true] svg{background:var(--secondary-background-color,#293441);box-sizing:content-box;padding:5px 12px;border-radius:10px}.lx-tabs button svg{box-sizing:content-box;padding:5px 12px}.lx-tabs button{-webkit-tap-highlight-color:transparent}.lx-card{padding:11px}.lx-shell{padding-bottom:0;gap:8px}}
    @media(max-width:760px) and (max-height:700px){.lx-map-layout{grid-template-rows:minmax(0,.85fr) minmax(0,1.15fr)}.lx-map-layout[data-mode=history]{grid-template-rows:auto minmax(0,.85fr) minmax(0,1.15fr)}}@media(max-width:760px) and (min-height:850px){.lx-map-layout{grid-template-rows:minmax(0,1.1fr) minmax(0,.9fr)}.lx-map-layout[data-mode=history]{grid-template-rows:auto minmax(0,1.1fr) minmax(0,.9fr)}}
    </style><div class="lx-shell"><header class="lx-head"><button id="menu" class="lx-menu" aria-label="打开侧边栏"></button><h1>位置中心</h1></header><nav class="lx-tabs" aria-label="位置中心页面"></nav><div class="lx-error" role="status"></div><main class="lx-content"></main></div>`;
    this.querySelector('#menu').append(icon('mdi:menu'));this.querySelector('#menu').onclick=()=>this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true}));
    for(const [id,label,glyph] of TABS){const b=button(undefined,()=>this.switchPage(id));b.append(icon(glyph),el('span',label));b.dataset.page=id;this.querySelector('.lx-tabs').append(b);}
    this.switchPage(this.page);this.startViewport();
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
    this.style.removeProperty('--lx-host-safe-bottom');
  }
  layoutDiagnostics(){
    const round=n=>Math.round(n*100)/100;
    const describe=node=>{
      if(!node)return null;
      const r=node.getBoundingClientRect(),c=node.ownerDocument.defaultView.getComputedStyle(node);
      return {tag:node.tagName,top:round(r.top),bottom:round(r.bottom),width:round(r.width),height:round(r.height),clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,paddingTop:c.paddingTop,paddingBottom:c.paddingBottom,marginBottom:c.marginBottom,background:c.backgroundColor,overflowY:c.overflowY,position:c.position,cssHeight:c.height};
    };
    const probe=document.createElement('div');probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px);padding-top:env(safe-area-inset-top,0px);';this.append(probe);
    const safe={top:getComputedStyle(probe).paddingTop,bottom:getComputedStyle(probe).paddingBottom};probe.remove();
    let parent={accessible:false};try{
      const frame=window.frameElement;
      if(frame){parent={accessible:true,frame:describe(frame),ancestors:[],viewport:{innerHeight:window.parent.innerHeight,clientHeight:window.parent.document.documentElement.clientHeight,visualHeight:window.parent.visualViewport?.height??null},body:describe(window.parent.document.body)};
        let n=frame.parentElement||frame.getRootNode()?.host;
        for(let i=0;i<6&&n;i++){parent.ancestors.push(describe(n));n=n.parentElement||n.getRootNode()?.host;}
      }
    }catch(e){}
    const nav=this.querySelector('.lx-tabs'),last=nav?.lastElementChild,vv=window.visualViewport,viewportBottom=vv?vv.height+vv.offsetTop:window.innerHeight;
    return {version:VERSION,page:this.page,hostSafeBottom:this.style.getPropertyValue('--lx-host-safe-bottom'),inIframe:window!==window.top,devicePixelRatio:window.devicePixelRatio,screen:{width:screen.width,height:screen.height},inner:{width:window.innerWidth,height:window.innerHeight},client:{width:document.documentElement.clientWidth,height:document.documentElement.clientHeight},visualViewport:vv?{width:vv.width,height:vv.height,offsetTop:vv.offsetTop,offsetLeft:vv.offsetLeft,scale:vv.scale}:null,safeArea:safe,viewportCss:this.style.getPropertyValue('--lx-viewport'),viewportMeta:document.querySelector('meta[name=viewport]')?.content??null,html:describe(document.documentElement),body:describe(document.body),panel:describe(this),shell:describe(this.querySelector('.lx-shell')),content:describe(this.querySelector('.lx-content')),map:describe(this.querySelector('.lx-map')),nav:describe(nav),navButton:describe(last),navBottomGap:nav?round(viewportBottom-nav.getBoundingClientRect().bottom):null,buttonBottomGap:last&&nav?round(nav.getBoundingClientRect().bottom-last.getBoundingClientRect().bottom):null,parent};
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
  async start(){if(this.started)return;this.started=true;const epoch=this.epoch;if(!this._hass.user?.is_admin){this.status('仅管理员可访问');return;}if(this.page==='live'||this.page==='history')this.switchPage(this.page);await this.refresh();if(this.isConnected&&epoch===this.epoch)this.timer=setInterval(()=>{if(!document.hidden&&!this.busy)this.refresh();},15000);}
  status(s=''){const n=this.querySelector('.lx-error');if(n)n.textContent=s;}
  async refresh(action='list',entity_id,delete_history=false){
    if(this.busy||!this._hass?.user?.is_admin)return;
    const epoch=this.epoch;this.busy=true;
    try{const r=await this._hass.callWS({type:NS+'storage',action,...(entity_id?{entity_id}:{}),import_history:true,delete_history,include_position:this.page==='live'});if(!this.isConnected||epoch!==this.epoch)return;this.data=r;this.status();this.updateData();}
    catch(e){if(this.isConnected&&epoch===this.epoch){this.status('操作失败：'+String(e.message||e));this.updateData();}}
    finally{this.busy=false;}
  }
  switchPage(page){
    this.stopHistoryAddresses();this.liveSelected=null;this.page=page;this.historySeq=(this.historySeq||0)+1;this.historyData=null;this.destroyMap();
    for(const b of this.querySelectorAll('[data-page]'))b.setAttribute('aria-selected',String(b.dataset.page===page));
    const main=this.querySelector('.lx-content');main.replaceChildren();main.classList.toggle('lx-map-page',page==='live'||page==='history');
    if(page==='live'||page==='history'){
      const layout=el('div',undefined,'lx-map-layout'),side=el('aside',undefined,'lx-side'),map=el('div',undefined,'lx-map'),target=el('div',undefined,'lx-map-inner'),tools=el('div',undefined,'lx-map-tools');
      const details=el('details'),summary=el('summary');summary.setAttribute('aria-label','地图图层');summary.append(icon('layers'));details.append(summary);for(const [id,label] of [['standard','标准'],['satellite','卫星'],['dark','深色']]){const b=button(label,()=>{this.layer(id);details.open=false;});b.dataset.layer=id;b.setAttribute('aria-pressed',String(id===(this.mapLayer||'standard')));details.append(b);}tools.append(details);if(page==='live'){const fit=button(undefined,()=>{this.liveSelected=null;this.fitMarkers();this.clusterLive();this.drawSide();});fit.setAttribute('aria-label','显示全部位置');fit.append(icon('locate'));tools.append(fit);}
      layout.dataset.mode=page;map.append(target,tools);layout.append(side,map);main.append(layout);this.drawSide();
      if(this._hass?.user?.is_admin){this.buildMap(target);if(page==='live'&&this.started&&!this.busy)this.refresh();}
    }else this.drawData();
  }
  updateData(){if(this.page==='live'){this.drawSide();this.syncMarkers();}else if(this.page==='history'){if(!this.querySelector('.lx-history-filter select')?.options.length)this.drawSide();}else this.drawData();}
  drawSide(){
    const side=this.querySelector('.lx-side');if(!side)return;
    const layout=this.querySelector('.lx-map-layout'),filter=layout.querySelector('.lx-history-filter'),old=filter?.querySelector('select')?.value,date=filter?.querySelector('[data-history-date]')?.value,scroll=side.querySelector('.lx-list-scroll')?.scrollTop||0;filter?.remove();side.replaceChildren();
    const data=this.data,devices=(data?.candidates||[]).filter(d=>d.managed);
    if(this.page==='live'){
      const card=el('section',undefined,'lx-card'),head=el('div',undefined,'lx-title');head.append(el('h2','设备位置'),el('span',devices.length+' 台','lx-muted'));card.append(head);
      const list=el('div',undefined,'lx-list-scroll');card.append(list);
      for(const d of devices){
        const row=el('div',undefined,'lx-list-row lx-live-row'),avatar=el('div',undefined,'lx-avatar'),info=el('div',undefined,'lx-name');
        avatar.append(icon(/ipad|tablet|平板/i.test(d.name)?'tablet':'mdi:cellphone'));avatar.style.color=this.color(d.entity_id);info.append(el('strong',d.name));const p=d.position;
        if(p){
          const selected=this.liveSelected===d.entity_id,addr=el('div','地址解析中…','lx-live-address'),meta=el('div',this.liveTime(p.updated_at)+' · '+(p.accuracy==null?'精度未知':'精度 '+Math.round(p.accuracy)+' m'),'lx-muted lx-live-meta');
          info.append(addr,meta);meta.title='HA 实体更新时间，非确认的 GPS 上报时间';
          row.dataset.focus=d.entity_id;row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-pressed',String(selected));
          this.liveAddress(d,addr,selected);
          row.onclick=()=>{this.liveSelected=this.liveSelected===d.entity_id?null:d.entity_id;if(this.liveSelected)this.focusDevice(d.entity_id);else this.fitMarkers();this.drawSide();};
          row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();row.click();}};
        }else info.append(el('div',!d.enabled?'历史记录未开启 · 未展示位置':'暂无定位','lx-muted'));
        row.append(avatar,info);list.append(row);
      }
      if(!devices.length)list.append(el('p',data?'暂无设备':'正在读取设备…','lx-muted'));side.append(card);list.scrollTop=scroll;
    }else{
      const card=el('section',undefined,'lx-card lx-history-filter');card.append(el('h2','历史轨迹'));
      const select=el('select',undefined,'lx-field');select.setAttribute('aria-label','选择设备');
      for(const d of devices){const opt=el('option',d.name);opt.value=d.entity_id;select.append(opt);}
      if(devices.some(d=>d.entity_id===old))select.value=old;
      const day=el('input');day.type='hidden';day.dataset.historyDate='1';
      const local=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
      const today=new Date(),min=new Date(today),yesterday=new Date(today);min.setDate(min.getDate()-29);yesterday.setDate(yesterday.getDate()-1);
      const maxDate=local(today),minDate=local(min);day.value=date&&date>=minDate&&date<=maxDate?date:maxDate;
      const calendar=el('div',undefined,'lx-calendar-wrap'),trigger=button('',()=>{popup.hidden=!popup.hidden;trigger.setAttribute('aria-expanded',String(!popup.hidden));if(!popup.hidden){month=new Date(day.value+'T00:00:00');month.setDate(1);drawCalendar();}},'lx-field lx-date-trigger');
      trigger.setAttribute('aria-label','选择日期');trigger.setAttribute('aria-expanded','false');
      const popup=el('div',undefined,'lx-calendar');popup.hidden=true;
      let month=new Date(day.value+'T00:00:00');month.setDate(1);
      const updateLabel=()=>{trigger.replaceChildren(el('span','▦'),el('span',day.value+(day.value===maxDate?' · 今日':day.value===local(yesterday)?' · 昨日':'')),el('span','⌄','lx-date-arrow'));};
      const choose=value=>{if(value<minDate||value>maxDate)return;day.value=value;popup.hidden=true;trigger.setAttribute('aria-expanded','false');updateLabel();this.loadHistory();};
      const drawCalendar=()=>{
        popup.replaceChildren();const header=el('div',undefined,'lx-cal-header');
        const prev=button('‹',()=>{month.setMonth(month.getMonth()-1);drawCalendar();}),next=button('›',()=>{month.setMonth(month.getMonth()+1);drawCalendar();});
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
      calendar.append(trigger,day,popup);calendar.onkeydown=e=>{if(e.key==='Escape'){popup.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();}};
      updateLabel();
      const wrap=el('div',undefined,'lx-stack');wrap.append(select,calendar);card.append(wrap);layout.prepend(card);
      const timeline=el('section',undefined,'lx-card');timeline.id='history-timeline';side.append(timeline);
      select.onchange=()=>{popup.hidden=true;trigger.setAttribute('aria-expanded','false');this.loadHistory();};
      this.loadHistory();
    }
  }
  async buildMap(target){
    try{const c=await this._hass.callWS({type:NS+'config'}),A=await sdk(c);if(!this.isConnected||!target.isConnected)return;this.A=A;this.map=new A.Map(target,{zoom:5,viewMode:'2D',resizeEnable:true,dragEnable:true,zoomEnable:true,scrollWheel:true,doubleClickZoom:true,touchZoom:true});if(this.page==='live'){this.map.on('zoomend',()=>this.clusterLive());this.map.on('moveend',()=>this.clusterLive());this.map.on('dragstart',()=>{this.cancelCamera();this.liveExpanded=null;});}this.layer(this.mapLayer||'standard');if(this.page==='live')this.syncMarkers();else this.paintHistory();}
    catch(e){if(target.isConnected)this.status('地图加载失败：'+String(e.message||e));}
  }
  destroyMap(){this.cancelCamera();this.liveExpanded=null;this.liveClusters=[];this.historyOverlays=[];this.historyNumberMarkers=[];this.markers=new Map();this.didFit=false;if(this.map){this.map.destroy();this.map=null;}}
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
      if(target._lxQueued||!target.isConnected)return;
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
    return target=>{if(this.historyAddressObserver)this.historyAddressObserver.observe(target);else enqueue(target);};
  }
  async drainHistoryAddresses(){
    if(this.historyAddressBusy)return;
    this.historyAddressBusy=true;
    try{
      while(this.historyAddressQueue?.length){
        const item=this.historyAddressQueue.shift();
        if(item.generation!==this.historyAddressGeneration||item.seq!==this.historySeq||this.page!=='history'||!item.target.isConnected)continue;
        if(!this._hass?.user?.is_admin)break;
        const address=await this.resolveAddress(item.entity,item.at,item.target);
        if(item.generation===this.historyAddressGeneration&&item.seq===this.historySeq&&this.page==='history'&&item.target.isConnected&&address){
          this.historyResolved.set(item.at,address);this.historyRegroup?.();
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
  historyGroups(points){
    const groups=[];let group=null;
    for(let i=0;i<points.length;i++){
      const p=points[i],addr=this.historyResolved?.get(p.recorded_at);
      const exact=(a,b)=>a.latitude===b.latitude&&a.longitude===b.longitude;
      const canJoin=group&&group.every(j=>{
        const q=points[j],other=this.historyResolved?.get(q.recorded_at);
        return exact(p,q)||(addr&&other===addr&&this.historyDistance(p,q)<=30);
      });
      if(canJoin)group.push(i);else{group=[i];groups.push(group);}
    }
    return groups;
  }
  selectHistoryMarker(index){
    this.selectedHistoryIndex=index;
    for(const item of this.historyNumberMarkers||[]){
      const selected=index!==null&&item.indices.includes(index);
      item.dot.classList.toggle('lx-track-selected',selected);
      item.dot.textContent=item.label;
      item.marker.setzIndex?.(selected?200:120);
    }
  }
  async loadHistory(){
    const select=this.querySelector('.lx-history-filter select'),day=this.querySelector('[data-history-date]'),timeline=this.querySelector('#history-timeline');
    if(!select||!day||!timeline)return;
    this.stopHistoryAddresses();this.historyResolved=new Map();this.historyRegroup=null;this.selectedHistoryIndex=null;const seq=this.historySeq=(this.historySeq||0)+1;this.historyData=null;this.historyTimelineGroups=null;this.openHistoryPoint=null;this.paintHistory();
    timeline.replaceChildren(el('h2','定位时间轴'));
    if(!select.value||!day.value){timeline.append(el('p','请选择设备及日期','lx-muted'));return;}
    const start=new Date(day.value+'T00:00:00'),end=new Date(start);end.setDate(end.getDate()+1);
    timeline.append(el('p','正在加载…','lx-muted'));
    try{
      const r=await this._hass.callWS({type:NS+'history',entity_id:select.value,start:start.getTime(),end:end.getTime()});
      if(this.page!=='history'||seq!==this.historySeq||!timeline.isConnected)return;
      this.historyData=r.points;
      const title=el('div',undefined,'lx-title');title.append(el('h2','定位时间轴'),el('span',r.points.length+' 个定位点'+(r.truncated?' · 已截断':''),'lx-muted'));timeline.replaceChildren(title);
      if(!r.points.length)timeline.append(el('p','当日暂无定位记录','lx-muted'));
      let shown=0,expanded=null,groups=this.historyGroups(r.points),limit=50,rendering=false;
      const entity=select.value,watchAddress=this.watchHistoryAddresses(entity,seq);
      const body=el('div',undefined,'lx-list-scroll');timeline.append(body);
      const timeOnly=t=>new Date(t).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
      const close=(restore=false)=>{if(!expanded)return;expanded.row.setAttribute('aria-expanded','false');expanded.card.classList.remove('lx-point-open');expanded.arrow.textContent='⌄';this.animatePoint(expanded.detail,false);expanded=null;if(restore){this.selectHistoryMarker(null);this.fitHistory();}};
      const more=button('显示更多',()=>{limit+=50;render();});
      const render=()=>{
        if(rendering||seq!==this.historySeq||!body.isConnected)return;
        rendering=true;
        const active=this.selectedHistoryIndex,scroll=body.scrollTop;
        // Cancel obsolete visible-row observations; pending requests for removed DOM nodes are discarded.
        this.historyAddressObserver?.disconnect();
        expanded=null;body.replaceChildren();shown=0;
        for(const indices of groups.slice(0,limit)){
          const i=indices[0],p=r.points[i],card=el('div',undefined,'lx-point-card'),detail=el('div',undefined,'lx-point-address lx-group-detail'),arrow=el('span','⌄','lx-point-arrow');
          detail.hidden=true;
          const row=button('',()=>open(i,false),'lx-point-row'),number=el('span',this.historyLabel(indices),'lx-point-number'),info=el('span',undefined,'lx-point-label');
          const address=el('span',this.historyResolved.get(p.recorded_at)||'地址待加载','lx-group-address');address._lxRecordedAt=p.recorded_at;info.append(address);
          if(indices.length>1)info.append(el('span',indices.length+' 次定位记录','lx-muted lx-group-count'));
          row.dataset.groupStart=String(i);row.setAttribute('aria-expanded','false');row.append(number,info,arrow);
          const focus=j=>{this.selectHistoryMarker(j);if(this.map)this.flyTo(this.gcj(r.points[j].longitude,r.points[j].latitude),17);for(const child of detail.children)child.classList.toggle('lx-raw-selected',Number(child.dataset.index)===j);};
          const open=(j,force)=>{if(expanded?.row===row){if(!force){close(true);return;}focus(j);return;}close(false);expanded={row,card,arrow,detail};card.classList.add('lx-point-open');row.setAttribute('aria-expanded','true');arrow.textContent='⌃';this.animatePoint(detail,true);focus(j);};
          for(const j of indices){const raw=r.points[j],child=button('',()=>focus(j),'lx-raw-point');child.dataset.index=String(j);child.append(el('span',String(j+1),'lx-raw-number'),el('span',timeOnly(raw.recorded_at)),el('span',raw.accuracy==null?'精度未知':Math.round(raw.accuracy)+' m','lx-muted'));detail.append(child);}
          row.openPoint=j=>open(j,true);card.append(row,detail);body.append(card);
          if(!this.historyResolved.has(p.recorded_at))watchAddress(address);
          // Exact coordinate groups reuse the representative address; distinct nearby points must resolve individually before merging.
          if(active!=null&&indices.includes(active)){expanded={row,card,arrow,detail};card.classList.add('lx-point-open');row.setAttribute('aria-expanded','true');arrow.textContent='⌃';detail.hidden=false;for(const child of detail.children)child.classList.toggle('lx-raw-selected',Number(child.dataset.index)===active);}
          shown++;
        }
        if(shown<groups.length)body.append(more);
        if(scroll!=null)body.scrollTop=scroll;
        rendering=false;
      };
      this.historyRegroup=()=>{
        if(seq!==this.historySeq||!body.isConnected)return;
        // Propagate addresses only for exactly equal coordinates.
        const known=new Map();for(const p of r.points){const addr=this.historyResolved.get(p.recorded_at);if(addr)known.set(p.latitude+','+p.longitude,addr);}
        for(const p of r.points){const addr=known.get(p.latitude+','+p.longitude);if(addr)this.historyResolved.set(p.recorded_at,addr);}
        const next=this.historyGroups(r.points);
        if(JSON.stringify(next)===JSON.stringify(groups))return;
        groups=next;this.historyTimelineGroups=groups;
        const active=this.selectedHistoryIndex;if(active!=null){const g=groups.findIndex(v=>v.includes(active));if(g>=limit)limit=g+1;}
        render();this.paintHistory(false);
      };
      this.historyTimelineGroups=groups;render();
      this.openHistoryPoint=i=>{if(seq!==this.historySeq||!body.isConnected)return;const g=groups.findIndex(v=>v.includes(i));if(g<0)return;if(g>=limit){limit=Math.ceil((g+1)/50)*50;render();}const row=body.querySelector('[data-group-start="'+groups[g][0]+'"]');if(row){row.openPoint(i);row.scrollIntoView({block:'nearest'});}};
      this.paintHistory();
    }catch(e){if(seq===this.historySeq&&timeline.isConnected)timeline.replaceChildren(el('h2','定位时间轴'),el('p','查询失败：'+String(e.message||e),'lx-muted'));}
  }
  animatePoint(detail,open){
    if(detail._lxAnimation){detail._lxAnimation.cancel();detail._lxAnimation=null;}
    const reduce=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(!detail.animate||reduce){detail.hidden=!open;return;}
    if(open)detail.hidden=false;
    const h=detail.getBoundingClientRect().height;
    const animation=detail.animate(open?[{height:'0px',opacity:0,paddingBottom:'0px'},{height:h+'px',opacity:1}]:[{height:h+'px',opacity:1},{height:'0px',opacity:0,paddingBottom:'0px'}],{duration:180,easing:'ease',fill:'none'});
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
    if(this.historyOverlays?.length)this.map.remove(this.historyOverlays);
    this.historyOverlays=[];this.historyNumberMarkers=[];const points=this.historyData||[];if(!points.length)return;
    const A=this.A,xy=points.map(p=>this.gcj(p.longitude,p.latitude));
    let run=[xy[0]],dashed=null;
    const flush=()=>{if(run.length>1)this.historyOverlays.push(new A.Polyline({path:run,strokeColor:'#4387e8',strokeWeight:dashed?3:4,strokeOpacity:dashed ? 0.55 : 0.9,strokeStyle:dashed?'dashed':'solid',strokeDasharray:[8,6],lineJoin:'round',lineCap:'round',zIndex:10}));};
    for(let i=1;i<points.length;i++){
      const gap=points[i].recorded_at-points[i-1].recorded_at>30*60000;
      if(dashed!==null&&gap!==dashed){flush();run=[xy[i-1]];}
      dashed=gap;run.push(xy[i]);
    }flush();
    const groups=new Map();
    for(const indices of this.historyTimelineGroups||this.historyGroups(points)){
      const i=indices[0],key=points[i].latitude+','+points[i].longitude;
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(...indices);
    }
    const focus=i=>{if(this.map&&this.page==='history')this.openHistoryPoint?.(i);};
    for(const indices of groups.values()){
      const i=indices[0],isFirst=indices.includes(0),isLast=indices.includes(points.length-1);
      const label=this.historyLabel(indices);
      const dot=el('div',label,'lx-track-end lx-track-number');
      dot.style.background=isFirst&&isLast?'#64748b':isFirst?'#059669':isLast?'#dc5252':'#4387e8';
      const marker=new A.Marker({position:xy[i],content:dot,anchor:'center',title:'定位点 '+indices.map(n=>n+1).join('、'),zIndex:120});
      marker.on('click',()=>{const selected=this.selectedHistoryIndex,pos=indices.indexOf(selected);focus(indices[(pos+1)%indices.length]);});
      this.historyNumberMarkers.push({marker,dot,indices,label});this.historyOverlays.push(marker);
    }
    this.map.add(this.historyOverlays);this.selectHistoryMarker(this.selectedHistoryIndex??null);if(adjustView){if(this.selectedHistoryIndex==null)this.fitHistory();else this.map.setZoomAndCenter(17,xy[this.selectedHistoryIndex]);}
  }
  liveTime(t){
    if(!t)return '更新时间未知';const d=new Date(t),now=new Date(),y=new Date(now);y.setDate(y.getDate()-1);
    const time=d.toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const md=String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const prefix=d.toDateString()===now.toDateString()?'':d.toDateString()===y.toDateString()?'昨日 ':d.getFullYear()===now.getFullYear()?md+' ':d.getFullYear()+'-'+md+' ';
    return prefix+time;
  }
  async liveAddress(d,target,full){
    const p=d.position,key=d.entity_id+':'+p.latitude+':'+p.longitude;
    this.liveAddressCache??=new Map();let entry=this.liveAddressCache.get(key);
    if(!entry||Date.now()-entry.at>300000){
      entry={at:Date.now(),promise:this._hass.callWS({type:NS+'address',entity_id:d.entity_id}).then(r=>r.address||null).catch(()=>null)};
      if(this.liveAddressCache.size>=128)this.liveAddressCache.delete(this.liveAddressCache.keys().next().value);
      this.liveAddressCache.set(key,entry);
    }
    const address=await entry.promise;
    if(target.isConnected)target.textContent=address?(full?address:address.replace(/^(?:[^省]{2,8}省|内蒙古自治区|广西壮族自治区|宁夏回族自治区|新疆维吾尔自治区|西藏自治区)/,'')):'地址暂不可用';
    if(!address&&this.liveAddressCache.get(key)===entry)this.liveAddressCache.delete(key);
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
    const ids=new Set(devices.map(d=>d.entity_id));
    for(const [id,m] of this.markers)if(!ids.has(id)){map.remove([m.marker,...(m.circle?[m.circle]:[])]);this.markers.delete(id);}
    for(const d of devices){
      const p=d.position,xy=this.gcj(p.longitude,p.latitude),color=this.color(d.entity_id);
      let m=this.markers.get(d.entity_id);
      if(!m){
        const content=el('div'),dot=el('div',Array.from(d.name)[0]||'•','lx-marker');dot.style.background=color;
        content.append(dot,el('div',d.name,'lx-marker-label'));
        const marker=new A.Marker({position:xy,content,anchor:'center',offset:new A.Pixel(0,0),title:d.name});
        marker.on('click',()=>{this.focusDevice(d.entity_id);this.drawSide();});map.add(marker);m={marker,circle:null,xy};this.markers.set(d.entity_id,m);
      }
      m.xy=xy;m.marker.setPosition(xy);
      if(Number.isFinite(p.accuracy)&&p.accuracy>0){
        if(!m.circle){m.circle=new A.Circle({center:xy,radius:p.accuracy,strokeColor:color,strokeOpacity:.65,strokeWeight:1,fillColor:color,fillOpacity:.12,zIndex:5});map.add(m.circle);}
        else{m.circle.setCenter(xy);m.circle.setRadius(p.accuracy);}
      }else if(m.circle){map.remove(m.circle);m.circle=null;}
    }
    if(!this.didFit&&this.markers.size){this.didFit=true;this.fitMarkers();}this.clusterLive();
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
    if(reduce||!Number.isFinite(distance)||distance<2&&Math.abs(startZoom-zoom)<.1){map.setZoomAndCenter(zoom,xy,true);done?.();return;}
    const far=distance>30000,duration=far?850:distance>1000?650:450;
    const mid=Math.min(startZoom,zoom,Math.max(3,Math.log2(40075000/Math.max(distance*2,1)/256)+1));
    const begin=performance.now();this.cameraMoving=true;
    const ease=t=>t*t*(3-2*t);
    const tick=now=>{
      if(seq!==this.cameraSeq||map!==this.map)return;
      const t=Math.min(1,(now-begin)/duration);let p=ease(t),z=startZoom+(zoom-startZoom)*p;
      if(far){if(t<.25){p=0;z=startZoom+(mid-startZoom)*ease(t/.25);}else if(t<.7){p=ease((t-.25)/.45);z=mid;}else{p=1;z=mid+(zoom-mid)*ease((t-.7)/.3);}}
      map.setZoomAndCenter(z,[from[0]+(xy[0]-from[0])*p,from[1]+(xy[1]-from[1])*p],true);
      if(t<1)this.cameraFrame=requestAnimationFrame(tick);else{this.cameraFrame=null;this.cameraMoving=false;map.setZoomAndCenter(zoom,xy,true);if(this.page==='live')this.clusterLive();done?.();}
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
    if(this.liveClusters?.length)map.remove(this.liveClusters);
    this.liveClusters=[];
    const groups=[];
    for(const [id,m] of this.markers){
      m.marker.setOffset?.(new A.Pixel(0,0));m.marker.show();if(m.circle)m.circle.show();
      let px;try{px=map.lngLatToContainer(new A.LngLat(m.xy[0],m.xy[1]));}catch(e){continue;}
      if(!px||!Number.isFinite(px.x)||!Number.isFinite(px.y))continue;
      const item={id,m,x:px.x,y:px.y};
      const group=groups.find(g=>g.every(v=>Math.hypot(v.x-item.x,v.y-item.y)<52));
      if(group)group.push(item);else groups.push([item]);
    }
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
      const content=el('div'),dot=el('div',String(group.length),'lx-marker');dot.style.background='#4387e8';content.append(dot,el('div',group.length+' 台设备','lx-marker-label'));
      const marker=new A.Marker({position:center,content,anchor:'center',zIndex:130});
      marker.on('click',()=>this.expandLiveCluster(group,center));this.liveClusters.push(marker);
    }
    if(this.liveClusters.length)map.add(this.liveClusters);
  }
  fitMarkers(){this.cancelCamera();this.liveExpanded=null;if(!this.map||!this.markers?.size)return;const list=[...this.markers.values()];if(list.length===1){this.map.setZoomAndCenter(16,list[0].xy);return;}this.map.setFitView(list.map(x=>x.marker),false,[60,60,60,60],16);}
  focusDevice(id){const m=this.markers?.get(id);if(m&&this.map){this.liveSelected=id;this.liveExpanded=null;this.flyTo(m.xy,16);this.clusterLive();}}
  layer(id){this.mapLayer=id;for(const b of this.querySelectorAll('[data-layer]'))b.setAttribute('aria-pressed',String(b.dataset.layer===id));if(!this.map)return;const A=this.A;if(id==='satellite'){this.map.setMapStyle('amap://styles/normal');this.map.setLayers([new A.TileLayer.Satellite(),new A.TileLayer.RoadNet()]);}else{this.map.setLayers([new A.TileLayer()]);this.map.setMapStyle(id==='dark'?'amap://styles/dark':'amap://styles/normal');}}
  drawData(){
    const main=this.querySelector('.lx-content');main.replaceChildren();const data=this.data;
    if(!data){main.append(el('div','正在读取设备及存储信息…','lx-card'));return;}
    const stack=el('div',undefined,'lx-stack');main.append(stack);
    if(this.page==='devices'){
      const managed=data.candidates.filter(d=>d.managed),removed=data.candidates.filter(d=>!d.managed),heading=el('div',undefined,'lx-title');heading.append(el('strong','已管理设备'),el('span',managed.length+' 台','lx-muted'));stack.append(heading);
      const grid=el('div',undefined,'lx-grid');
      for(const d of managed){
        const card=el('section',undefined,'lx-card'),head=el('div',undefined,'lx-device-head'),avatar=el('div',undefined,'lx-avatar'),info=el('div',undefined,'lx-name');avatar.append(icon(/ipad|tablet|平板/i.test(d.name)?'tablet':'mdi:cellphone'));avatar.style.color=this.color(d.entity_id);info.append(el('strong',d.name),el('div',d.available?'定位可用':'暂无定位','lx-muted'));
        const more=el('details',undefined,'lx-more'),summary=el('summary');summary.setAttribute('aria-label',d.name+' 更多操作');summary.append(icon('mdi:dots-horizontal'));const menu=el('div',undefined,'lx-more-panel');
        menu.append(button('移除并保留历史',()=>{more.open=false;this.refresh('remove',d.entity_id,false);}),button('移除并删除历史',()=>{more.open=false;if(confirm('确定删除该设备在本集成中的历史记录？'))this.refresh('remove',d.entity_id,true);}));more.append(summary,menu);head.append(avatar,info,more);card.append(head);
        const row=el('div',undefined,'lx-row'),label=el('label',undefined,'lx-switch'),toggle=el('input');toggle.type='checkbox';toggle.checked=d.enabled;toggle.setAttribute('aria-label',d.name+' 历史记录');toggle.onchange=()=>{const checked=toggle.checked;toggle.checked=d.enabled;this.refresh(checked?'enable':'disable',d.entity_id);};label.append(toggle);row.append(el('span','历史记录'),label);card.append(row);grid.append(card);
      }
      if(!managed.length)grid.append(el('div','暂无设备','lx-card'));stack.append(grid);
      const excluded=el('details',undefined,'lx-card'),summary=el('summary','已移除设备 · '+removed.length+' 台');excluded.append(summary);for(const d of removed){const row=el('div',undefined,'lx-row');row.append(el('span',d.name),button('重新添加',()=>this.refresh('add',d.entity_id)));excluded.append(row);}stack.append(excluded);
      stack.append(el('p','首次开启历史记录自动导入可用历史；关闭后保留已有数据。仅对已有位置共享许可的设备开启记录。','lx-muted'));
    }else{
      const d=data.diagnostics,card=el('section',undefined,'lx-card');card.append(el('h2','数据存储'));
      for(const [name,value] of [['历史保留','30 天'],['数据库大小',(d.database_bytes/1024).toFixed(1)+' KB'],['地址缓存',String(d.address_cache_count??0)+' 条'],['历史定位点',String(d.devices.reduce((s,x)=>s+x.count,0))],['最近清理',fmt(d.last_cleanup)],['错误次数',String(d.errors)]]){const row=el('div',undefined,'lx-row');row.append(el('span',name),el('strong',value));card.append(row);}
      card.append(button('复制诊断',async()=>{try{await navigator.clipboard.writeText(JSON.stringify({storage:d,layout:this.layoutDiagnostics()},null,2));this.status('诊断已复制');}catch(e){this.status('复制失败');}}));stack.append(card);
      const layoutCard=el('section',undefined,'lx-card');layoutCard.append(el('h2','布局诊断'),el('p','复制视口、安全区域及宿主 iframe 尺寸，不含定位数据。','lx-muted'));
      const output=el('textarea');output.readOnly=true;output.style.cssText='width:100%;min-height:120px;font:11px monospace;background:var(--lx-card);color:inherit;border:1px solid var(--lx-line);border-radius:8px;margin-top:8px';output.hidden=true;
      const copy=button('复制布局诊断',async()=>{const report=JSON.stringify(this.layoutDiagnostics(),null,2);try{await navigator.clipboard.writeText(report);this.status('布局诊断已复制');}catch(e){output.hidden=false;output.value=report;output.focus();output.select();}});
      layoutCard.append(copy,output);stack.append(layoutCard);
      const mapSettings=el('section',undefined,'lx-card');mapSettings.append(el('h2','地图设置'));const layer=el('select',undefined,'lx-field');layer.setAttribute('aria-label','地图图层');for(const [id,name] of [['standard','标准地图'],['satellite','卫星地图'],['dark','深色地图']]){const o=el('option',name);o.value=id;layer.append(o);}layer.value=this.mapLayer||'standard';layer.onchange=()=>{this.mapLayer=layer.value;};mapSettings.append(layer);stack.prepend(mapSettings);
      const about=el('section',undefined,'lx-card');about.append(el('h2','关于'),el('div','LUXE Location · '+VERSION),el('p','仅被动读取 HA 已有定位。真实定位仅展示已开启历史记录的设备；地址按需通过高德解析，缓存于 HA 内存和 SQLite；地图安全代理使用短期会话路径。','lx-muted'));stack.append(about);
    }
  }
}
if(!customElements.get('luxe-location-probe'))customElements.define('luxe-location-probe',LocationPanel);
