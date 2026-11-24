const VERSION='0.1.7-preview';
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
  set hass(v){this._hass=v;if(this.isConnected&&!this.started)this.start();}
  connectedCallback(){this.page='live';this.epoch=(this.epoch||0)+1;this.render();if(this._hass)this.start();}
  disconnectedCallback(){this.epoch++;this.started=false;clearInterval(this.timer);this.destroyMap();}
  render(){
    this.innerHTML=`<style>
    luxe-location-probe{display:block;height:100vh;height:100dvh;width:100%;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--primary-text-color,#e7eaf0);background:var(--primary-background-color,#131820);-webkit-text-size-adjust:100%;text-size-adjust:100%;--lx-accent:var(--primary-color,#4387e8);--lx-card:var(--card-background-color,#202733);--lx-line:var(--divider-color,#394453)}
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
    .lx-map-layout{display:grid;grid-template-rows:minmax(0,1fr);grid-template-columns:minmax(260px,320px) minmax(0,1fr);gap:10px;height:100%;min-height:300px}
    .lx-side{display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto}.lx-map{position:relative;isolation:isolate;overflow:hidden;border-radius:14px;min-height:260px;background:var(--lx-card)}
    .lx-track-end{width:30px;height:30px;border:2px solid white;border-radius:50%;display:grid;place-items:center;color:white;font:bold 12px sans-serif;box-shadow:0 2px 6px #0005}.lx-selected-point{padding:10px;margin:8px 0;border:1px solid var(--lx-line);border-radius:9px}.lx-track-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--secondary-text-color,#a6afbd);margin-top:10px}.lx-track-legend span:before{content:'';display:inline-block;width:24px;border-top:3px solid #4387e8;vertical-align:middle;margin-right:5px}.lx-track-legend span:last-child:before{border-top-style:dashed;opacity:.65}.lx-map-inner{position:absolute;inset:0;touch-action:none}.lx-map-tools{position:absolute;right:10px;top:10px;z-index:5;display:flex;flex-direction:column;gap:4px;background:var(--lx-card);border-radius:10px;padding:4px;box-shadow:0 2px 12px #0002}
    .lx-map-tools button{padding:7px;font-size:12px}.lx-map-tools button[aria-pressed=true]{color:var(--lx-accent)}
    .lx-error{color:#e7a23b;font-size:13px;flex:none}.lx-error:empty{display:none}.lx-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.lx-stack{display:flex;flex-direction:column;gap:10px;max-width:1000px;margin:auto}
    .lx-device-head{display:flex;align-items:center;gap:10px}.lx-avatar{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--secondary-background-color,#293441);color:var(--lx-accent);flex:none}.lx-name{flex:1;min-width:0;overflow-wrap:anywhere}
    .lx-switch{display:flex;align-items:center;gap:8px;cursor:pointer}.lx-switch input{appearance:none;-webkit-appearance:none;width:42px;height:24px;border-radius:20px;background:#78838e;position:relative;cursor:pointer;margin:0}.lx-switch input:checked{background:var(--lx-accent)}.lx-switch input:before{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;background:white;border-radius:50%;transition:transform .15s}.lx-switch input:checked:before{transform:translateX(18px)}
    .lx-more{position:relative}.lx-more summary{cursor:pointer;list-style:none;padding:8px}.lx-more summary::-webkit-details-marker{display:none}.lx-more-panel{position:absolute;right:0;top:100%;z-index:10;min-width:180px;background:var(--lx-card);border:1px solid var(--lx-line);border-radius:10px;padding:5px;box-shadow:0 6px 20px #0003}.lx-more-panel button{display:block;width:100%;text-align:left;white-space:nowrap}
    .lx-calendar-wrap{position:relative;min-width:0}.lx-date-trigger{display:flex;align-items:center;gap:8px;text-align:left}.lx-date-arrow{margin-left:auto}.lx-calendar{width:100%;margin-top:8px;padding:8px;background:var(--lx-card);border:1px solid var(--lx-line);border-radius:12px}.lx-calendar[hidden],.lx-point-address[hidden]{display:none!important}.lx-cal-header{display:flex;align-items:center;justify-content:space-between;gap:4px}.lx-cal-header button{min-height:34px;padding:4px 10px}.lx-cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;text-align:center;align-items:center;margin:6px 0}.lx-cal-grid button{padding:0;height:34px;min-width:0;font-size:14px;border-radius:8px}.lx-cal-grid button[aria-pressed=true]{background:var(--lx-accent);color:white}.lx-cal-grid button:disabled{opacity:.3}.lx-cal-today:not([aria-pressed=true]){color:var(--lx-accent);font-weight:bold}.lx-point-card{border-bottom:1px solid var(--lx-line);border-radius:9px;padding:3px 0}.lx-point-card:last-child{border:0}.lx-point-open{background:var(--secondary-background-color,#293441)}.lx-point-row{display:flex;width:100%;align-items:center;gap:8px;text-align:left;padding:10px 6px!important}.lx-point-row svg{flex:none;color:var(--lx-accent);width:18px;height:18px}.lx-point-time{flex:1;font-variant-numeric:tabular-nums;white-space:nowrap}.lx-point-arrow{color:var(--secondary-text-color,#a6afbd);font-size:16px}.lx-point-address{padding:0 10px 10px 32px;font-size:13px;color:var(--secondary-text-color,#a6afbd);overflow-wrap:anywhere}.lx-field{font:inherit;width:100%;padding:8px;border:1px solid var(--lx-line);border-radius:8px;background:var(--lx-card);color:inherit}.lx-sub{margin:8px 0 0}.lx-list-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--lx-line)}.lx-list-row:last-child{border:0}
    @media(max-width:760px){.lx-menu{display:block}.lx-head h1{font-size:20px}.lx-tabs{order:5;justify-content:space-around;border-top:1px solid var(--lx-line);padding:5px 0 env(safe-area-inset-bottom,0px)}.lx-tabs button{flex:1;flex-direction:column;gap:3px;padding:5px 2px;font-size:11px}.lx-tabs ha-icon{--mdc-icon-size:23px}.lx-grid{grid-template-columns:1fr}.lx-map-layout{display:flex;flex-direction:column;height:auto;min-height:0}.lx-map{order:-1;flex:none;height:48vh;height:48dvh;min-height:250px}.lx-side{overflow:visible}.lx-card{padding:11px}.lx-shell{padding-bottom:0}}
    </style><div class="lx-shell"><header class="lx-head"><button id="menu" class="lx-menu" aria-label="打开侧边栏"></button><h1>位置中心</h1></header><nav class="lx-tabs" aria-label="位置中心页面"></nav><div class="lx-error" role="status"></div><main class="lx-content"></main></div>`;
    this.querySelector('#menu').append(icon('mdi:menu'));this.querySelector('#menu').onclick=()=>this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true}));
    for(const [id,label,glyph] of TABS){const b=button(undefined,()=>this.switchPage(id));b.append(icon(glyph),el('span',label));b.dataset.page=id;this.querySelector('.lx-tabs').append(b);}
    this.switchPage(this.page);
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
    this.page=page;this.historySeq=(this.historySeq||0)+1;this.historyData=null;this.destroyMap();
    for(const b of this.querySelectorAll('[data-page]'))b.setAttribute('aria-selected',String(b.dataset.page===page));
    const main=this.querySelector('.lx-content');main.replaceChildren();
    if(page==='live'||page==='history'){
      const layout=el('div',undefined,'lx-map-layout'),side=el('aside',undefined,'lx-side'),map=el('div',undefined,'lx-map'),target=el('div',undefined,'lx-map-inner'),tools=el('div',undefined,'lx-map-tools');
      const details=el('details'),summary=el('summary');summary.setAttribute('aria-label','地图图层');summary.append(icon('layers'));details.append(summary);for(const [id,label] of [['standard','标准'],['satellite','卫星'],['dark','深色']]){const b=button(label,()=>{this.layer(id);details.open=false;});b.dataset.layer=id;b.setAttribute('aria-pressed',String(id===(this.mapLayer||'standard')));details.append(b);}tools.append(details);if(page==='live'){const fit=button(undefined,()=>this.fitMarkers());fit.setAttribute('aria-label','显示全部位置');fit.append(icon('locate'));tools.append(fit);}
      map.append(target,tools);layout.append(side,map);main.append(layout);this.drawSide();
      if(this._hass?.user?.is_admin){this.buildMap(target);if(page==='live'&&this.started&&!this.busy)this.refresh();}
    }else this.drawData();
  }
  updateData(){if(this.page==='live'){this.drawSide();this.syncMarkers();}else if(this.page==='history'){if(!this.querySelector('.lx-side select')?.options.length)this.drawSide();}else this.drawData();}
  drawSide(){
    const side=this.querySelector('.lx-side');if(!side)return;
    const old=side.querySelector('select')?.value,date=side.querySelector('[data-history-date]')?.value;side.replaceChildren();
    const data=this.data,devices=(data?.candidates||[]).filter(d=>d.managed);
    if(this.page==='live'){
      const card=el('section',undefined,'lx-card'),head=el('div',undefined,'lx-title');head.append(el('h2','设备位置'),el('span',devices.length+' 台','lx-muted'));card.append(head);
      for(const d of devices){const row=el('div',undefined,'lx-list-row'),avatar=el('div',undefined,'lx-avatar'),info=el('div',undefined,'lx-name');avatar.append(icon(/ipad|tablet|平板/i.test(d.name)?'tablet':'mdi:cellphone'));avatar.style.color=this.color(d.entity_id);info.append(el('strong',d.name));const p=d.position;info.append(el('div',p?(p.accuracy==null?'定位可用':'定位精度 '+Math.round(p.accuracy)+' m'):(!d.enabled?'历史记录未开启 · 未展示位置':'暂无定位'),'lx-muted'));if(p){const addr=el('div','地址解析中…','lx-muted');info.append(addr);this.resolveAddress(d.entity_id,undefined,addr);info.append(el('div',fmt(p.updated_at),'lx-muted'));row.dataset.focus=d.entity_id;row.tabIndex=0;row.setAttribute('role','button');row.onclick=()=>this.focusDevice(d.entity_id);row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.focusDevice(d.entity_id);}};}row.append(avatar,info);card.append(row);}
      if(!devices.length)card.append(el('p',data?'暂无设备':'正在读取设备…','lx-muted'));side.append(card);
    }else{
      const card=el('section',undefined,'lx-card');card.append(el('h2','历史轨迹'));
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
      const wrap=el('div',undefined,'lx-stack');wrap.append(select,calendar);card.append(wrap);side.append(card);
      const timeline=el('section',undefined,'lx-card');timeline.id='history-timeline';side.append(timeline);
      select.onchange=()=>{popup.hidden=true;trigger.setAttribute('aria-expanded','false');this.loadHistory();};
      this.loadHistory();
    }
  }
  async buildMap(target){
    try{const c=await this._hass.callWS({type:NS+'config'}),A=await sdk(c);if(!this.isConnected||!target.isConnected)return;this.A=A;this.map=new A.Map(target,{zoom:5,viewMode:'2D',resizeEnable:true,dragEnable:true,zoomEnable:true,scrollWheel:true,doubleClickZoom:true,touchZoom:true});this.layer(this.mapLayer||'standard');if(this.page==='live')this.syncMarkers();else this.paintHistory();}
    catch(e){if(target.isConnected)this.status('地图加载失败：'+String(e.message||e));}
  }
  destroyMap(){this.historyOverlays=[];this.markers=new Map();this.didFit=false;if(this.map){this.map.destroy();this.map=null;}}
  async resolveAddress(entity,recorded_at,target){
    try{
      const r=await this._hass.callWS({type:NS+'address',entity_id:entity,...(recorded_at===undefined?{}:{recorded_at})});
      if(target.isConnected)target.textContent=r.address||'地址暂不可用';
    }catch(e){if(target.isConnected)target.textContent='地址暂不可用';}
  }
  async loadHistory(){
    const select=this.querySelector('.lx-side select'),day=this.querySelector('[data-history-date]'),timeline=this.querySelector('#history-timeline');
    if(!select||!day||!timeline)return;
    const seq=this.historySeq=(this.historySeq||0)+1;this.historyData=null;this.openHistoryPoint=null;this.paintHistory();
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
      let shown=0,expanded=null;const entity=select.value;
      const timeOnly=t=>new Date(t).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
      const close=()=>{if(!expanded)return;expanded.row.setAttribute('aria-expanded','false');expanded.card.classList.remove('lx-point-open');expanded.arrow.textContent='⌄';expanded.detail.hidden=true;expanded=null;};
      const more=button('显示更多',()=>append());
      const append=()=>{more.remove();for(const p of r.points.slice(shown,shown+50)){
        const card=el('div',undefined,'lx-point-card'),detail=el('div',undefined,'lx-point-address'),arrow=el('span','⌄','lx-point-arrow');
        detail.hidden=true;detail.textContent='地址解析中…';let requested=false;
        const row=button('',()=>open(false),'lx-point-row');
        row.dataset.recordedAt=String(p.recorded_at);row.setAttribute('aria-expanded','false');
        row.append(icon('mdi:map-marker-radius-outline'),el('span',timeOnly(p.recorded_at),'lx-point-time'),el('span',p.accuracy==null?'精度未知':Math.round(p.accuracy)+' m','lx-muted'),arrow);
        const open=force=>{if(expanded?.row===row){if(!force)close();return;}close();expanded={row,card,arrow,detail};card.classList.add('lx-point-open');row.setAttribute('aria-expanded','true');arrow.textContent='⌃';detail.hidden=false;if(this.map)this.map.setZoomAndCenter(17,this.gcj(p.longitude,p.latitude));if(!requested){requested=true;this.resolveAddress(entity,p.recorded_at,detail);}};
        row.openPoint=()=>open(true);card.append(row,detail);timeline.append(card);
      }shown=Math.min(shown+50,r.points.length);if(shown<r.points.length)timeline.append(more);};
      append();
      this.openHistoryPoint=i=>{if(seq!==this.historySeq||!timeline.isConnected)return;while(shown<=i&&shown<r.points.length)append();const row=timeline.querySelector('[data-recorded-at="'+r.points[i].recorded_at+'"]');if(row){row.openPoint();row.scrollIntoView({block:'nearest'});}};
      this.paintHistory();
    }catch(e){if(seq===this.historySeq&&timeline.isConnected)timeline.replaceChildren(el('h2','定位时间轴'),el('p','查询失败：'+String(e.message||e),'lx-muted'));}
  }
  paintHistory(){
    if(!this.map||this.page!=='history')return;
    if(this.historyOverlays?.length)this.map.remove(this.historyOverlays);
    this.historyOverlays=[];const points=this.historyData||[];if(!points.length)return;
    const A=this.A,xy=points.map(p=>this.gcj(p.longitude,p.latitude));
    let run=[xy[0]],dashed=null;
    const flush=()=>{if(run.length>1)this.historyOverlays.push(new A.Polyline({path:run,strokeColor:'#4387e8',strokeWeight:dashed?3:4,strokeOpacity:dashed ? 0.55 : 0.9,strokeStyle:dashed?'dashed':'solid',strokeDasharray:[8,6],lineJoin:'round',lineCap:'round',zIndex:10}));};
    for(let i=1;i<points.length;i++){
      const gap=points[i].recorded_at-points[i-1].recorded_at>30*60000;
      if(dashed!==null&&gap!==dashed){flush();run=[xy[i-1]];}
      dashed=gap;run.push(xy[i]);
    }flush();
    const groups=new Map();
    for(let i=0;i<xy.length;i++){
      const key=xy[i].map(v=>v.toFixed(6)).join(',');
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);
    }
    const focus=i=>{if(this.map&&this.page==='history')this.openHistoryPoint?.(i);};
    for(const indices of groups.values()){
      const i=indices[0],isFirst=indices.includes(0),isLast=indices.includes(points.length-1);
      if(isFirst||isLast){
        const dot=el('div',isFirst&&isLast?'起/终':isFirst?'起':'终','lx-track-end');
        dot.style.background=isFirst&&isLast?'#64748b':isFirst?'#059669':'#dc5252';
        const marker=new A.Marker({position:xy[i],content:dot,anchor:'center',title:isFirst&&isLast?'起点与终点重合':isFirst?'首个定位':'末次定位',zIndex:120});
        marker.on('click',()=>focus(isLast&&!isFirst?points.length-1:i));this.historyOverlays.push(marker);
      }else{
        const marker=new A.CircleMarker({center:xy[i],radius:4,fillColor:'#ffffff',fillOpacity:1,strokeColor:'#4387e8',strokeWeight:2,zIndex:30});
        marker.on('click',()=>focus(i));this.historyOverlays.push(marker);
      }
    }
    this.map.add(this.historyOverlays);if(groups.size===1)this.map.setZoomAndCenter(16,xy[0]);else this.map.setFitView(this.historyOverlays,false,[45,45,45,45],16);
  }
  color(id){let n=0;for(const c of id)n=(n*31+c.charCodeAt(0))>>>0;return ['#3b82f6','#0ca87d','#a855f7','#e58b25','#e05e86'][n%5];}
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
        const marker=new A.Marker({position:xy,content,anchor:'center',title:d.name});
        marker.on('click',()=>this.focusDevice(d.entity_id));map.add(marker);m={marker,circle:null,xy};this.markers.set(d.entity_id,m);
      }
      m.xy=xy;m.marker.setPosition(xy);
      if(Number.isFinite(p.accuracy)&&p.accuracy>0){
        if(!m.circle){m.circle=new A.Circle({center:xy,radius:p.accuracy,strokeColor:color,strokeOpacity:.65,strokeWeight:1,fillColor:color,fillOpacity:.12,zIndex:5});map.add(m.circle);}
        else{m.circle.setCenter(xy);m.circle.setRadius(p.accuracy);}
      }else if(m.circle){map.remove(m.circle);m.circle=null;}
    }
    if(!this.didFit&&this.markers.size){this.didFit=true;this.fitMarkers();}
  }
  fitMarkers(){if(!this.map||!this.markers?.size)return;const list=[...this.markers.values()];if(list.length===1){this.map.setZoomAndCenter(16,list[0].xy);return;}this.map.setFitView(list.map(x=>x.marker),false,[60,60,60,60],16);}
  focusDevice(id){const m=this.markers?.get(id);if(m&&this.map)this.map.setZoomAndCenter(16,m.xy);}
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
      card.append(button('复制诊断',async()=>{try{await navigator.clipboard.writeText(JSON.stringify(d,null,2));this.status('诊断已复制');}catch(e){this.status('复制失败');}}));stack.append(card);
      const mapSettings=el('section',undefined,'lx-card');mapSettings.append(el('h2','地图设置'));const layer=el('select',undefined,'lx-field');layer.setAttribute('aria-label','地图图层');for(const [id,name] of [['standard','标准地图'],['satellite','卫星地图'],['dark','深色地图']]){const o=el('option',name);o.value=id;layer.append(o);}layer.value=this.mapLayer||'standard';layer.onchange=()=>{this.mapLayer=layer.value;};mapSettings.append(layer);stack.prepend(mapSettings);
      const about=el('section',undefined,'lx-card');about.append(el('h2','关于'),el('div','LUXE Location · '+VERSION),el('p','仅被动读取 HA 已有定位。真实定位仅展示已开启历史记录的设备；地址按需通过高德解析，缓存于 HA 内存和 SQLite；地图安全代理使用短期会话路径。','lx-muted'));stack.append(about);
    }
  }
}
if(!customElements.get('luxe-location-probe'))customElements.define('luxe-location-probe',LocationPanel);
