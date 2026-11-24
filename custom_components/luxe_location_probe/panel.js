const VERSION='0.0.1';
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
  set hass(v){this._hass=v;if(this.isConnected&&!this.started)this.start();}
  set narrow(v){this._narrow=v;}
  connectedCallback(){this.render();if(this._hass)this.start();}
  render(){this.innerHTML=`<style>
  luxe-location-probe{display:block;height:100%;color:var(--primary-text-color);-webkit-text-size-adjust:100%;text-size-adjust:100%} luxe-location-probe .lp{height:100%;display:flex;flex-direction:column;box-sizing:border-box;gap:10px;padding:12px;overflow:auto} luxe-location-probe .lp-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap} luxe-location-probe button{font:inherit;padding:8px 12px;border:1px solid var(--divider-color);border-radius:9px;background:var(--card-background-color);color:var(--primary-text-color);cursor:pointer} luxe-location-probe .lp-map{flex:1;min-height:280px;border-radius:12px;overflow:hidden;position:relative} luxe-location-probe pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:130px;overflow:auto;margin:0;font-size:12px} luxe-location-probe .lp-title{font-size:20px;font-weight:600}
  </style><div class="lp"><div class="lp-bar"><button id="menu" aria-label="打开侧边栏">☰</button><span class="lp-title">位置地图测试</span><span>v${VERSION}</span></div><div class="lp-bar"><button data-action="standard">标准</button><button data-action="satellite">卫星</button><button data-action="dark">深色</button><button data-action="center">居中</button><button data-action="convert">坐标转换</button><button data-action="geocode">地址解析</button><button data-action="destroy">销毁 / 重建</button><button data-action="copy">复制诊断</button></div><div class="lp-map" id="map"></div><div>仅使用公开地标模拟数据；不读取 GPS 实体。测试模式 JS 安全密钥在浏览器可见。</div><pre id="log"></pre></div>`;
    this.querySelector('#menu').onclick=()=>this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true}));
    this.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>this.action(b.dataset.action));
  }
  log(message){this.logs=this.logs||[];this.logs.push(new Date().toISOString()+' '+message);const el=this.querySelector('#log');if(el){el.textContent=this.logs.join('\n');el.scrollTop=el.scrollHeight;}}
  async start(){if(this.started)return;this.started=true;const generation=this.generation=(this.generation||0)+1;try{
    if(!this._hass.user?.is_admin)throw new Error('仅管理员可访问');
    this.log('初始化；WebGL '+Boolean(document.createElement('canvas').getContext('webgl'))+'；UA '+navigator.userAgent);
    const config=await this._hass.callWS({type:'luxe_location_probe/config'});const begin=performance.now();const A=await sdk(config);
    if(!this.isConnected||generation!==this.generation)return;
    this.A=A;this.log('SDK 加载耗时 '+Math.round(performance.now()-begin)+' ms');this.build();
  }catch(e){if(this.isConnected&&generation===this.generation){this.log('初始化失败：'+String(e.message||e));this.started=false;}}}
  build(){const A=this.A;const begin=performance.now();this.map=new A.Map(this.querySelector('#map'),{zoom:14,center:POINT,viewMode:'2D',resizeEnable:true});this.map.on('complete',()=>this.log('地图 complete 事件 '+Math.round(performance.now()-begin)+' ms（请目视确认瓦片）'));this.map.on('error',()=>this.log('地图 error 事件'));this.base=new A.TileLayer();this.satellite=new A.TileLayer.Satellite();this.road=new A.TileLayer.RoadNet();this.marker=new A.Marker({position:POINT,title:'模拟位置'});this.circle=new A.Circle({center:POINT,radius:80,strokeColor:'#4285ed',fillColor:'#4285ed',fillOpacity:0.15});this.line=new A.Polyline({path:[[116.385,39.906],[116.391,39.908],POINT,[116.405,39.914]],strokeColor:'#4285ed',strokeWeight:5});this.map.add([this.marker,this.circle,this.line]);if(window.ResizeObserver){this.ro=new ResizeObserver(()=>{if(this.map&&typeof this.map.resize==='function')this.map.resize();});this.ro.observe(this.querySelector('#map'));}this.log('地图实例已创建；模拟标记、80m 精度圈和轨迹已添加');}
  destroy(){if(this.ro){this.ro.disconnect();this.ro=null;}if(this.map){this.map.destroy();this.map=null;this.log('已调用地图 destroy');}}
  async action(a){try{if(a==='copy'){await navigator.clipboard.writeText((this.logs||[]).join('\n'));this.log('已复制诊断');return;}if(a==='geocode'){const r=await this._hass.callWS({type:'luxe_location_probe/geocode_test'});this.log('Web 服务测试 '+JSON.stringify(r));return;}if(a==='destroy'){if(this.map)this.destroy();else if(this.A)this.build();else this.start();return;}if(!this.map)throw new Error('地图尚未就绪');switch(a){case 'standard':this.map.setLayers([this.base]);this.map.setMapStyle('amap://styles/normal');break;case 'satellite':this.map.setLayers([this.satellite,this.road]);break;case 'dark':this.map.setLayers([this.base]);this.map.setMapStyle('amap://styles/dark');break;case 'center':this.map.setZoomAndCenter(14,POINT);break;case 'convert':this.A.convertFrom([116.391,39.907],'gps',(status,result)=>{if(status==='complete'&&result.locations?.length){const p=result.locations[0];this.log('模拟 WGS84 转换结果 '+p.getLng()+','+p.getLat());}else this.log('坐标转换失败 '+status);});break;}this.log('操作 '+a);}catch(e){this.log('操作失败：'+String(e.message||e));}}
  disconnectedCallback(){this.generation=(this.generation||0)+1;this.destroy();this.started=false;}
}
if(!customElements.get('luxe-location-probe'))customElements.define('luxe-location-probe',Probe);
