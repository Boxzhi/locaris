const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../custom_components/locaris/panel.js'),'utf8');
const context={TIMING:{MAP_NEAR_MS:400,MAP_MEDIUM_MS:600,MAP_FAR_MS:800,MAP_LONG_MS:1000}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const cameraClamp='),source.indexOf('class LocationPanel extends HTMLElement{'))+'\nthis.geometry={cameraFit,cameraPadding,cameraPixel,cameraInside,cameraPlan,cameraFrame};',context);
const {cameraFit,cameraPadding,cameraPixel,cameraInside,cameraPlan,cameraFrame}=context.geometry;
const a=[118.63,32.04],b=[116.34,27.96],c=[110,40];
function viewport(width,height,tools=50){return {width,height,pad:cameraPadding(width,height,18,tools,0),minZoom:2,maxZoom:20};}
function assertFit(points,v,fit){
  for(const point of points)assert.ok(cameraInside(cameraPixel(point,fit.center,fit.zoom,v.width,v.height),v.width,v.height,v.pad),JSON.stringify({point,v,fit}));
}
test('portrait landscape and desktop fit all markers with safe padding and no unnecessary zoom-out',()=>{
  for(const [w,h] of [[340,380],[1000,300],[660,850],[900,600]]){
    const v=viewport(w,h),fit=cameraFit([a,b],w,h,v.pad,16,2);
    assertFit([a,b],v,fit);
    assert.ok(fit.zoom>4&&fit.zoom<12);
    const extra={center:fit.center,zoom:fit.zoom+.02};
    assert.ok([a,b].some(p=>!cameraInside(cameraPixel(p,extra.center,extra.zoom,w,h),w,h,v.pad)));
    assertFit([a,b,c],v,cameraFit([a,b,c],w,h,v.pad,16,2));
  }
});
test('asymmetric tool avoidance, small pane, coincident points and antimeridian',()=>{
  const v=viewport(180,130,65);
  assert.ok(v.pad.left+v.pad.right<180&&v.pad.top+v.pad.bottom<130);
  assertFit([a,b],v,cameraFit([a,b],v.width,v.height,v.pad,16,2));
  const wide=viewport(700,500,100);
  assert.ok(wide.pad.right>wide.pad.left);
  assertFit([a,a],wide,cameraFit([a,a],wide.width,wide.height,wide.pad,16,2));
  const cross=[[179.8,20],[-179.8,20]];
  const fit=cameraFit(cross,wide.width,wide.height,wide.pad,16,2);
  assert.ok(fit.zoom>8);assertFit(cross,wide,fit);
});
test('near, medium, far, long, visible target and cluster strategies',()=>{
  const v=viewport(550,650),base={from:a,startZoom:16,target:b,zoom:16,points:[a,b],viewport:v,targetVisible:false,allVisible:false};
  for(const [distance,kind,duration] of [[1000,'direct',400],[1001,'near',600],[30000,'near',600],[30001,'fit',800],[100000,'fit',800],[100001,'fit',1000]]){
    const p=cameraPlan({...base,distance});
    assert.equal(p.kind,kind);assert.equal(p.duration,duration);
    if(kind==='near')assert.ok(p.mid>=14);
  }
  assert.equal(cameraPlan({...base,distance:200000,targetVisible:true}).kind,'direct');
  assert.equal(cameraPlan({...base,distance:200000,allVisible:true}).kind,'direct');
  assert.equal(cameraPlan({...base,distance:200000,cluster:true}).kind,'direct');
});
test('far transition overview fits intended scope and ends at exact target',()=>{
  const v=viewport(420,700),base={from:a,startZoom:16,target:b,zoom:16,distance:500000,viewport:v,targetVisible:false,allVisible:false};
  const pair=cameraPlan({...base,points:[a,b]}),all=cameraPlan({...base,points:[a,b,c]});
  assert.ok(pair.fit.zoom>all.fit.zoom);
  assertFit([a,b],v,cameraFrame(pair,a,16,b,16,.35));
  assertFit([a,b,c],v,cameraFrame(all,a,16,b,16,.35));
  for(const t of [.35,.60]){
    const before=cameraFrame(pair,a,16,b,16,t-1e-7),after=cameraFrame(pair,a,16,b,16,t+1e-7);
    assert.ok(Math.abs(before.zoom-after.zoom)<1e-5);
    assert.ok(Math.abs(before.center[0]-after.center[0])<1e-5);
  }
  const end=cameraFrame(pair,a,16,b,16,1);assert.equal(end.zoom,16);assert.equal(end.center,b);
});
test('focus captures previous selection, reset uses coordinate fit and input cancels animation',()=>{
  assert.match(source,/const previous=this.markers\?\.get\(this.liveSelected\),m=this.markers\?\.get\(id\)/);
  assert.match(source,/previous&&m\?\[previous.xy,m.xy\]/);
  assert.match(source,/this.fitCameraPoints\(\[\.\.\.this.markers.values\(\)\]/);
  assert.match(source,/events=\['pointerdown','touchstart','mousedown','wheel','keydown'\]/);
  assert.match(source,/if\(seq!==this.cameraSeq\|\|map!==this.map\)return/);
  assert.doesNotMatch(source,/40075000\/Math.max\(distance/);
});
