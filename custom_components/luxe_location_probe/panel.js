const VERSION='0.0.5';
const POINT=[116.397428,39.90923];
let sdkPromise;
function sdk(config){
  if(sdkPromise)return sdkPromise;
  sdkPromise=new Promise((resolve,reject)=>{
    if(window.AMap){reject(new Error('页面已加载其他高德 SDK，请刷新后测试'));return;}
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
class Probe extends HTMLElement{
  set hass(v){this._hass=v;if(this.isConnected&&!this.started&&!this.failed)this.start();}
  set narrow(v){this._narrow=v;}
  connectedCallback(){this.failed=false;this.render();if(this._hass)this.start();}
  render(){this.innerHTML=`<style>
  luxe-location-probe{display:block;height:100%;color:var(--primary-text-color);-webkit-text-size-adjust:100%;text-size-adjust:100%} luxe-location-probe .lp{height:100%;display:flex;flex-direction:column;box-sizing:border-box;gap:10px;padding:12px;overflow:auto;min-height:0} luxe-location-probe .lp-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap} luxe-location-probe button{font:inherit;padding:8px 12px;border:1px solid var(--divider-color);border-radius:9px;background:var(--card-background-color);color:var(--primary-text-color);cursor:pointer} luxe-location-probe .lp-map{flex:none;height:58vh;height:58dvh;min-height:260px;max-height:720px;min-width:0;border-radius:12px;overflow:hidden;position:relative;isolation:isolate}.lp-map-inner{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;touch-action:none;pointer-events:auto} luxe-location-probe pre{white-space:pre-wrap;overflow-wrap:anywhere;height:110px;flex:none;overflow:auto;margin:0;font-size:12px} luxe-location-probe .lp-title{font-size:20px;font-weight:600}
  </style><div class="lp"><div class="lp-bar"><button id="menu" aria-label="打开侧边栏">☰</button><span class="lp-title">位置地图测试</span><span>v${VERSION}</span></div><div class="lp-bar"><button data-action="standard">标准</button><button data-action="satellite">卫星</button><button data-action="dark">深色</button><button data-action="center">居中</button><button data-action="plus">+</button><button data-action="minus">−</button><button data-action="pan">平移测试</button><button data-action="convert">坐标转换</button><button data-action="geocode">地址解析</button><button data-action="destroy">销毁 / 重建</button><button data-action="copy">复制诊断</button></div><div class="lp-map"><div class="lp-map-inner" id="map"></div></div><div>地图仅使用公开地标模拟数据；设备管理读取 HA 已有实体。测试模式 JS 安全密钥在浏览器可见。</div><pre id="log"></pre><section><h3>定位设备管理</h3><button data-action="storage">刷新设备及统计</button><div id="devices"></div><pre id="storage-log"></pre></section></div>`;
    this.querySelector('#menu').onclick=()=>this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true}));
    this.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>this.action(b.dataset.action));
  }
  log(message){this.logs=this.logs||[];this.logs.push(new Date().toISOString()+' '+message);if(this.logs.length>160)this.logs.splice(0,this.logs.length-160);const el=this.querySelector('#log');if(el){el.textContent=this.logs.join('\n');el.scrollTop=el.scrollHeight;}}
  async start(){if(this.started)return;this.started=true;const generation=this.generation=(this.generation||0)+1;try{
    if(!this._hass.user?.is_admin)throw new Error('仅管理员可访问');
    this.log('初始化；WebGL '+Boolean(document.createElement('canvas').getContext('webgl'))+'；UA '+navigator.userAgent);
    const config=await this._hass.callWS({type:'luxe_location_probe/config'});const begin=performance.now();const A=await sdk(config);
    if(!this.isConnected||generation!==this.generation)return;
    this.storage('list');this.A=A;this.log('SDK 加载耗时 '+Math.round(performance.now()-begin)+' ms');this.build();
  }catch(e){if(this.isConnected&&generation===this.generation){this.log('初始化失败：'+String(e.message||e));this.destroy();this.started=false;this.failed=true;}}}
  build(){this.destroy();const A=this.A;const begin=performance.now();this.buildCount=(this.buildCount||0)+1;this.events={move:0,moveend:0,zoomchange:0,resize:0};this.map=new A.Map(this.querySelector('#map'),{zoom:14,center:POINT,viewMode:'2D',resizeEnable:true,dragEnable:true,zoomEnable:true,scrollWheel:true,doubleClickZoom:true,touchZoom:true});this.map.setStatus({dragEnable:true,zoomEnable:true,scrollWheel:true,doubleClickZoom:true,touchZoom:true});this.map.on('complete',()=>{this.log('地图 complete 事件 '+Math.round(performance.now()-begin)+' ms（请目视确认瓦片）');this.snapshot('complete');});this.map.on('error',()=>this.log('地图 error 事件'));this.base=new A.TileLayer();this.satellite=new A.TileLayer.Satellite();this.road=new A.TileLayer.RoadNet();this.marker=new A.Marker({position:POINT,title:'模拟位置'});this.circle=new A.Circle({center:POINT,radius:80,strokeColor:'#4285ed',fillColor:'#4285ed',fillOpacity:0.15});this.line=new A.Polyline({path:[[116.385,39.906],[116.391,39.908],POINT,[116.405,39.914]],strokeColor:'#4285ed',strokeWeight:5});this.map.add([this.marker,this.circle,this.line]);const map=this.map;const el=this.querySelector('#map');this.inputEvents={};this.lastInput=null;this.inputHandlers=[];for(const type of ['pointerdown','pointermove','pointerup','mousedown','mouseup','wheel','touchstart','touchmove','touchend','dblclick']){const handler=e=>{this.inputEvents[type]=(this.inputEvents[type]||0)+1;const t=e.composedPath()[0];this.lastInput={type,tag:t?.tagName||null,cls:typeof t?.className==='string'?t.className.slice(0,100):null,defaultPrevented:e.defaultPrevented};};el.addEventListener(type,handler,{capture:true,passive:true});this.inputHandlers.push([el,type,handler]);}for(const [event,key] of [['mapmove','move'],['moveend','moveend'],['zoomchange','zoomchange'],['resize','resize']])map.on(event,()=>{if(this.map===map)this.events[key]++;});this.snapshot('build');this.lastSnapshot='';this.monitor=setInterval(()=>{if(this.map!==map)return;const data=JSON.stringify(this.metrics());if(data!==this.lastSnapshot){this.lastSnapshot=data;this.log('采样 '+data);}},2000);this.log('地图实例已创建；模拟标记、80m 精度圈和轨迹已添加');}
  metrics(){const el=this.querySelector('#map');const rect=el.getBoundingClientRect();const p=this.map.getCenter();return {instances:this.buildCount,center:[Number(p.getLng().toFixed(6)),Number(p.getLat().toFixed(6))],zoom:this.map.getZoom(),width:Math.round(rect.width),height:Math.round(rect.height),events:{...this.events},input:{...this.inputEvents},lastInput:this.lastInput,root:el.getRootNode() instanceof ShadowRoot?'shadow':'document',status:this.map.getStatus?.()||null};}
  snapshot(label){if(this.map)this.log(label+' '+JSON.stringify(this.metrics()));}
  destroy(){for(const [el,type,handler] of this.inputHandlers||[])el.removeEventListener(type,handler,true);this.inputHandlers=[];if(this.monitor){clearInterval(this.monitor);this.monitor=null;}if(this.map){this.map.destroy();this.map=null;this.log('已调用地图 destroy');}}
  async action(a){try{if(a==='storage'){await this.storage('list');return;}if(a==='copy'){this.snapshot('copy');await navigator.clipboard.writeText((this.logs||[]).join('\n'));this.log('已复制诊断');return;}if(a==='geocode'){const r=await this._hass.callWS({type:'luxe_location_probe/geocode_test'});this.log('Web 服务测试 '+JSON.stringify(r));return;}if(a==='destroy'){if(this.map)this.destroy();else if(this.A)this.build();else {this.failed=false;this.start();}return;}if(!this.map)throw new Error('地图尚未就绪');switch(a){case 'standard':this.map.setLayers([this.base]);this.map.setMapStyle('amap://styles/normal');break;case 'satellite':this.map.setLayers([this.satellite,this.road]);break;case 'dark':this.map.setLayers([this.base]);this.map.setMapStyle('amap://styles/dark');break;case 'center':this.map.setZoomAndCenter(14,POINT);break;case 'plus':this.map.setZoom(this.map.getZoom()+1);break;case 'minus':this.map.setZoom(this.map.getZoom()-1);break;case 'pan':{const p=this.map.getCenter();this.map.setCenter([p.getLng()+0.01,p.getLat()]);break;}case 'convert':this.A.convertFrom([116.391,39.907],'gps',(status,result)=>{if(status==='complete'&&result.locations?.length){const p=result.locations[0];this.log('模拟 WGS84 转换结果 '+p.getLng()+','+p.getLat());}else this.log('坐标转换失败 '+status);});break;}this.log('操作 '+a);}catch(e){this.log('操作失败：'+String(e.message||e));}}
  async storage(action,entity_id,import_history=false,delete_history=false){
    if(this.storageBusy)return;
    this.storageBusy=true;
    const out=this.querySelector('#storage-log');
    try{
      const r=await this._hass.callWS({type:'luxe_location_probe/storage',action,...(entity_id?{entity_id}:{}),import_history,delete_history});
      if(!this.isConnected)return;
      const list=this.querySelector('#devices');list.replaceChildren();
      const button=(row,label,fn)=>{const b=document.createElement('button');b.textContent=label;b.onclick=fn;row.append(b);};
      for(const managed of [true,false]){
        const heading=document.createElement('h4');heading.textContent=managed?'已添加设备':'已移除设备';list.append(heading);
        for(const d of r.candidates.filter(x=>x.managed===managed)){
          const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0';
          const label=document.createElement('span');label.textContent=d.name+' · '+(d.available?'定位实体可用':'暂无定位')+' · '+(d.enabled?'记录中':'未记录');row.append(label);
          if(!managed){button(row,'重新添加',()=>this.storage('add',d.entity_id));}
          else{
            if(d.enabled)button(row,'停止记录',()=>this.storage('disable',d.entity_id));
            else{
              button(row,'开始记录',()=>this.storage('enable',d.entity_id,false));
              button(row,'记录并导入历史',()=>this.storage('enable',d.entity_id,true));
            }
            button(row,'移除并保留历史',()=>this.storage('remove',d.entity_id,false,false));
            button(row,'移除并删除历史',()=>{if(confirm('删除该设备在本集成中的全部历史记录？'))this.storage('remove',d.entity_id,false,true);});
          }
          list.append(row);
        }
      }
      out.textContent=JSON.stringify(r.diagnostics,null,2);
    }catch(e){out.textContent='设备管理失败：'+String(e.message||e);}
    finally{this.storageBusy=false;}
  }
  disconnectedCallback(){this.generation=(this.generation||0)+1;this.destroy();this.started=false;}
}
if(!customElements.get('luxe-location-probe'))customElements.define('luxe-location-probe',Probe);
