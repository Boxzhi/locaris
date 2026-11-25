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
