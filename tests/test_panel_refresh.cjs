const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../custom_components/locaris/panel.js'),'utf8');
const snippet=source.slice(source.indexOf('function boundedRead('),source.indexOf('class LocationPanel extends HTMLElement{'));
const sandbox={setTimeout,clearTimeout,TIMING:{READ_TIMEOUT_MS:30}};
vm.createContext(sandbox);
vm.runInContext(snippet,sandbox);
test('state signature changes even if HA mutates its state object in place',()=>{
  const d={entity_id:'device_tracker.a',managed:true};
  const hass={states:{[d.entity_id]:{state:'home',last_updated:'t1',attributes:{latitude:1,longitude:2,gps_accuracy:10}}}};
  const before=sandbox.liveStateSignature(hass,[d]);
  hass.states[d.entity_id].attributes.latitude=3;
  assert.notEqual(sandbox.liveStateSignature(hass,[d]),before);
  const after=sandbox.liveStateSignature(hass,[d]);
  hass.states[d.entity_id].attributes.gps_accuracy=20;
  assert.notEqual(sandbox.liveStateSignature(hass,[d]),after);
});
test('hung read rejects and the next request can succeed',async()=>{
  await assert.rejects(sandbox.boundedRead({callWS:()=>new Promise(()=>{})},{},15),e=>e.code==='read_timeout');
  assert.equal(await sandbox.boundedRead({callWS:()=>Promise.resolve('fresh')},{},100),'fresh');
});
test('server errors and synchronous exceptions propagate',async()=>{
  await assert.rejects(sandbox.boundedRead({callWS:()=>Promise.reject(new Error('server'))},{},100),/server/);
  await assert.rejects(sandbox.boundedRead({callWS:()=>{throw new Error('sync')}},{},100),/sync/);
});


test('history timeline uses compact vertical spacing; mobile selected icons have no background',()=>{
  assert.match(source,/#history-timeline\{padding-block:10px\}/);
  assert.match(source,/#history-timeline>\.lx-title\{margin-bottom:5px\}/);
  assert.match(source,/\.lx-point-card\{[^}]*padding:1px 0\}/);
  assert.match(source,/\.lx-point-row\{[^}]*padding:6px 6px!important\}/);
  assert.match(source,/\.lx-tabs button\[aria-selected=true\]\{background:transparent\}/);
  assert.doesNotMatch(source,/\.lx-tabs button\[aria-selected=true\] svg\{[^}]*background/);
  assert.match(source,/\.lx-tabs button svg\{box-sizing:content-box;padding:5px 12px\}/);
});
test('removed devices section appears only for nonzero count and preserves open state',()=>{
  class Node {
    constructor(tag,text,cls){this.tag=tag;this.text=text;this.cls=cls;this.children=[];this.dataset={};this.open=false;this.scrollTop=0;this.classList={add(){}};}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(){this.children=[];}
    setAttribute(){}
    querySelector(selector){return this.findAll().find(n=>selector==='[data-excluded]'&&n.dataset.excluded)||null;}
    querySelectorAll(){return [];}
    findAll(){return this.children.flatMap(n=>[n,...n.findAll()]);}
  }
  const main=new Node('main');
  const context={el:(...args)=>new Node(...args),button:(text,fn)=>Object.assign(new Node('button',text),{onclick:fn}),icon:()=>new Node('svg'),document:{activeElement:null}};
  vm.createContext(context);
  const start=source.indexOf('  drawData(){'), end=source.indexOf('\n  }',start);
  assert.ok(start>=0&&end>start);
  vm.runInContext('class TestPanel {\n'+source.slice(start,end+4)+'\n};this.TestPanel=TestPanel;',context);
  const panel=new context.TestPanel();
  Object.assign(panel,{page:'devices',querySelector:()=>main,menuButton:()=>new Node('button'),color:()=>'',refresh(){}});
  const managed={entity_id:'device_tracker.a',name:'A',managed:true,available:true,enabled:true};
  const removed={entity_id:'device_tracker.b',name:'B',managed:false};
  panel.data={candidates:[managed]};
  panel.drawData();
  assert.equal(main.querySelector('[data-excluded]'),null);
  assert.ok(!main.findAll().some(n=>typeof n.text==='string'&&n.text.includes('首次开启历史记录')));
  panel.data={candidates:[managed,removed]};
  panel.drawData();
  let section=main.querySelector('[data-excluded]');
  assert.ok(section);
  assert.equal(section.open,false);
  assert.equal(section.children[0].text,'已移除设备 · 1 台');
  section.open=true;
  panel.drawData();
  assert.equal(main.querySelector('[data-excluded]').open,true);
  panel.data={candidates:[managed]};
  panel.drawData();
  assert.equal(main.querySelector('[data-excluded]'),null);
});
