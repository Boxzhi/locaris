const VERSION='0.1.0-preview';
let sdkPromise;
function sdk(config){
  if(sdkPromise)return sdkPromise;
  sdkPromise=new Promise((resolve,reject)=>{
    if(window.AMap){reject(new Error('页面已加载其他高德 SDK，请刷新页面'));return;}
    window._AMapSecurityConfig={securityJsCode:config.security_code};
    const s=document.createElement('script');
    const timer=setTimeout(()=>{s.remove();reject(new Error('SDK 加载超时'));},20000);
    s.src='https://webapi.amap.com/maps?v=2.0&key='+encodeURIComponent(config.map_key);
    s.onload=()=>{clearTimeout(timer);window.AMap?resolve(window.AMap):reject(new Error('SDK 对象不存在'));};
    s.onerror=()=>{clearTimeout(timer);s.remove();reject(new Error('SDK 网络加载失败'));};
    document.head.appendChild(s);
  }).catch(e=>{sdkPromise=null;throw e;});
  return sdkPromise;
}

const TABS=[['live','实时位置'],['history','历史轨迹'],['devices','设备管理'],['settings','设置']];
const NS='luxe_location_probe/';
const fmt=t=>t?new Date(t).toLocaleString('zh-CN',{hour12:false}):'—';
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
class LocationPanel extends HTMLElement{
  set hass(v){this._hass=v;if(this.isConnected&&!this.started)this.start();}
  connectedCallback(){this.page='live';this.render();if(this._hass)this.start();}
  disconnectedCallback(){this.epoch=(this.epoch||0)+1;this.started=false;clearInterval(this.timer);this.timer=null;this.destroyMap();}
  render(){
    this.innerHTML=`<style>
    luxe-location-probe{display:block;height:100%;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--primary-text-color,#e7eaf0);background:var(--primary-background-color,#131820);-webkit-text-size-adjust:100%;text-size-adjust:100%}
    .lx-shell{height:100%;box-sizing:border-box;display:flex;flex-direction:column;max-width:1280px;margin:auto;padding:16px;gap:12px;overflow:auto}
    .lx-head,.lx-tabs,.lx-row,.lx-actions{display:flex;align-items:center;gap:10px}
    .lx-head h1{font-size:22px;margin:0;font-weight:650}.lx-tabs{flex-wrap:wrap;gap:6px}.lx-tabs button{flex:1;white-space:nowrap}
    luxe-location-probe button{font:inherit;color:inherit;cursor:pointer;background:var(--card-background-color,#202733);border:1px solid var(--divider-color,#394453);border-radius:9px;padding:9px 12px}
    luxe-location-probe button[aria-selected=true]{background:#2563eb;color:white;border-color:#2563eb}
    luxe-location-probe button:disabled{opacity:.5;cursor:default}
    .lx-content{min-width:0;display:flex;flex-direction:column;gap:10px}
    .lx-card{background:var(--card-background-color,#202733);border:1px solid var(--divider-color,#394453);border-radius:12px;padding:14px;min-width:0}
    .lx-card h2{font-size:17px;margin:0 0 10px}.lx-muted{color:var(--secondary-text-color,#a6afbd);font-size:13px;overflow-wrap:anywhere}
    .lx-row{justify-content:space-between;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--divider-color,#394453)}.lx-row:last-child{border:0}.lx-actions{flex-wrap:wrap}
    .lx-map{height:55vh;height:55dvh;min-height:260px;position:relative;isolation:isolate;overflow:hidden;border-radius:12px}.lx-map-inner{position:absolute;inset:0;touch-action:none}
    .lx-error{color:#f59e0b;min-height:0}.lx-switch{display:flex;align-items:center;gap:8px}.lx-switch input{width:18px;height:18px;accent-color:#2563eb}
    @media(max-width:600px){.lx-shell{padding:10px;gap:10px}.lx-tabs button{padding:8px 5px;font-size:13px}.lx-card{padding:11px}.lx-head h1{font-size:20px}.lx-map{height:48dvh}}
    </style><div class="lx-shell"><header class="lx-head"><button id="menu" aria-label="打开侧边栏">☰</button><h1>位置中心</h1></header><nav class="lx-tabs" aria-label="位置中心页面"></nav><div class="lx-error" role="status"></div><main class="lx-content"></main></div>`;
    this.querySelector('#menu').onclick=()=>this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true}));
    for(const [id,label] of TABS){const b=el('button',label);b.dataset.page=id;b.onclick=()=>this.switchPage(id);this.querySelector('.lx-tabs').append(b);}
    this.switchPage(this.page);
  }
  async start(){
    if(this.started)return;this.started=true;
    if(!this._hass.user?.is_admin){this.status('仅管理员可访问');return;}
    if(this.page==='live'||this.page==='history')this.switchPage(this.page);
    await this.refresh();
    if(this.isConnected&&this.started)this.timer=setInterval(()=>{if(!document.hidden&&!this.busy)this.refresh();},60000);
  }
  status(s=''){const n=this.querySelector('.lx-error');if(n)n.textContent=s;}
  async refresh(action='list',entity_id,delete_history=false){
    if(this.busy||!this._hass?.user?.is_admin)return;
    this.busy=true;const epoch=this.epoch;
    try{
      const r=await this._hass.callWS({type:NS+'storage',action,...(entity_id?{entity_id}:{}),import_history:true,delete_history});
      if(!this.isConnected||epoch!==this.epoch)return;
      this.data=r;this.status();if(this.page==='devices'||this.page==='settings')this.drawData();
    }catch(e){if(this.isConnected&&epoch===this.epoch){this.status('操作失败：'+String(e.message||e));if(this.page==='devices')this.drawData();}}
    finally{this.busy=false;}
  }
  switchPage(page){
    this.page=page;this.destroyMap();
    for(const b of this.querySelectorAll('[data-page]'))b.setAttribute('aria-selected',String(b.dataset.page===page));
    const main=this.querySelector('.lx-content');main.replaceChildren();
    if(page==='live'||page==='history'){
      const card=el('section',undefined,'lx-card');card.append(el('h2',page==='live'?'实时位置':'历史轨迹'));
      card.append(el('p',page==='live'?'真实定位展示接口尚未接入，本阶段不显示模拟位置。':'历史轨迹查询接口尚未接入，已有历史数据继续保留。','lx-muted'));
      const map=el('div',undefined,'lx-map');map.append(el('div',undefined,'lx-map-inner'));card.append(map);main.append(card);
      const bar=el('div',undefined,'lx-actions');for(const [id,label] of [['standard','标准'],['satellite','卫星'],['dark','深色']]){const b=el('button',label);b.onclick=()=>this.layer(id);bar.append(b);}card.prepend(bar);
      if(this._hass?.user?.is_admin)this.buildMap(map.firstChild);
    }else this.drawData();
  }
  async buildMap(target){
    try{
      const c=await this._hass.callWS({type:NS+'config'});const A=await sdk(c);
      if(!this.isConnected||!target.isConnected)return;
      this.A=A;this.map=new A.Map(target,{zoom:5,viewMode:'2D',resizeEnable:true,dragEnable:true,zoomEnable:true,scrollWheel:true,doubleClickZoom:true,touchZoom:true});
    }catch(e){if(target.isConnected)this.status('地图加载失败：'+String(e.message||e));}
  }
  destroyMap(){if(this.map){this.map.destroy();this.map=null;}}
  layer(id){if(!this.map)return;const A=this.A;if(id==='satellite')this.map.setLayers([new A.TileLayer.Satellite(),new A.TileLayer.RoadNet()]);else{this.map.setLayers([new A.TileLayer()]);this.map.setMapStyle(id==='dark'?'amap://styles/dark':'amap://styles/normal');}}
  drawData(){
    const main=this.querySelector('.lx-content');main.replaceChildren();
    const data=this.data;if(!data){main.append(el('div','正在读取设备及存储信息…','lx-card'));return;}
    const btn=(label,fn)=>{const b=el('button',label);b.onclick=fn;return b;};
    if(this.page==='devices'){
      for(const managed of [true,false]){
        const card=el('section',undefined,'lx-card');card.append(el('h2',managed?'已管理设备':'已移除设备'));
        const devices=data.candidates.filter(d=>d.managed===managed);
        if(!devices.length)card.append(el('div','暂无设备','lx-muted'));
        for(const d of devices){
          const row=el('div',undefined,'lx-row'),info=el('div');info.append(el('strong',d.name),el('div',d.available?'定位可用':'暂无定位','lx-muted'));row.append(info);
          const actions=el('div',undefined,'lx-actions');
          if(managed){
            const label=el('label',undefined,'lx-switch'),toggle=el('input');toggle.type='checkbox';toggle.checked=d.enabled;toggle.setAttribute('aria-label',d.name+' 历史记录');
            toggle.onchange=()=>{const checked=toggle.checked;toggle.checked=d.enabled;this.refresh(checked?'enable':'disable',d.entity_id);};
            label.append(toggle,el('span','历史记录'));actions.append(label);
            actions.append(btn('移除',()=>this.refresh('remove',d.entity_id,false)),btn('移除并删除历史',()=>{if(confirm('确定删除该设备在本集成中的历史记录？'))this.refresh('remove',d.entity_id,true);}));
          }else actions.append(btn('重新添加',()=>this.refresh('add',d.entity_id)));
          row.append(actions);card.append(row);
        }main.append(card);
      }
      main.append(el('p','仅对已有位置共享许可的设备开启历史记录。首次开启自动导入可用历史，关闭后保留已有数据。','lx-muted'));
    }else{
      const d=data.diagnostics,card=el('section',undefined,'lx-card');card.append(el('h2','数据存储'));
      for(const [name,value] of [['历史保留','30天'],['数据库大小',(d.database_bytes/1024).toFixed(1)+' KB'],['历史定位点',String(d.devices.reduce((s,x)=>s+x.count,0))],['最近清理',fmt(d.last_cleanup)],['错误次数',String(d.errors)]]){const row=el('div',undefined,'lx-row');row.append(el('span',name),el('strong',value));card.append(row);}
      card.append(btn('复制诊断',async()=>{try{await navigator.clipboard.writeText(JSON.stringify(d,null,2));this.status('诊断已复制');}catch(e){this.status('复制失败');}}));main.append(card);
      const about=el('section',undefined,'lx-card');about.append(el('h2','关于'),el('div','LUXE Location · '+VERSION),el('p','被动读取 Home Assistant 已有定位，不主动请求设备定位。高德 JS 安全码仍由管理员页面加载，安全代理尚未接入。','lx-muted'));main.append(about);
    }
  }
}
if(!customElements.get('luxe-location-probe'))customElements.define('luxe-location-probe',LocationPanel);
