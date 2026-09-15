'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../firmware/quantum_tracker_arduino/quantum_tracker_arduino.ino'), 'utf8');
function body(name) {
  const start = source.indexOf('{', source.indexOf(`void ${name}(`));
  let end=start+1, depth=1;
  while(depth) { if(source[end]==='{') depth++; if(source[end]==='}') depth--; end++; }
  return source.slice(start+1,end-1);
}
function rig() {
  const e={LOW:0,HIGH:1,IN1:7,IN2:6,IN3:5,IN4:4,saidaIn1:255,saidaIn2:255,saidaIn3:255,saidaIn4:255,
    CMD_PARAR:0,CMD_FRENTE:1,CMD_TRAS:2,CMD_DIREITA:3,CMD_ESQUERDA:4,CMD_GIRAR:5,comandoAplicado:0,
    pins:{7:0,6:0,5:0,4:0},writes:[]};
  e.digitalWrite=(pin,value)=>{ e.pins[pin]=value; e.writes.push({...e.pins,pin,value}); };
  vm.createContext(e);
  for(const name of ['aplicarMotores','pararMotores','andarParaFrente','andarParaTras','girarDireita','girarEsquerda','girarNoLugar','aplicarComando']) {
    const args=name==='aplicarMotores'?'in1,in2,in3,in4':name==='aplicarComando'?'comando':'';
    vm.runInContext(`function ${name}(${args}) { ${body(name)} }`,e);
  }
  e.pararMotores(); e.writes=[]; return e;
}
test('FRENTE drives both bridges continuously through repeated commands',()=>{
  const r=rig(); r.aplicarComando(r.CMD_FRENTE);
  assert.deepEqual(r.pins,{7:0,6:1,5:0,4:1});
  r.writes=[];
  for(let i=0;i<1000;i++) { r.aplicarComando(r.CMD_FRENTE); r.andarParaFrente(); }
  assert.equal(r.writes.length,0,'Repeated forward must not interrupt either motor');
});
test('changing the right wheel never interrupts an unchanged left wheel',()=>{
  const r=rig(); r.andarParaFrente(); r.writes=[];
  r.girarDireita(); r.andarParaFrente();
  assert.ok(r.writes.length>0);
  assert.ok(r.writes.every(write=>write.pin!==r.IN1 && write.pin!==r.IN2));
  assert.ok(r.writes.every(write=>write[r.IN2]===1));
});
test('changing the left wheel never interrupts an unchanged right wheel',()=>{
  const r=rig(); r.andarParaFrente(); r.writes=[];
  r.girarEsquerda(); r.andarParaFrente();
  assert.ok(r.writes.every(write=>write.pin!==r.IN3 && write.pin!==r.IN4));
  assert.ok(r.writes.every(write=>write[r.IN4]===1));
});
test('every command transition breaks the old direction before energizing the new direction',()=>{
  const commands=['pararMotores','andarParaFrente','andarParaTras','girarDireita','girarEsquerda','girarNoLugar'];
  for(const from of commands) for(const to of commands) {
    const r=rig(); r[from](); r.writes=[]; r[to]();
    assert.ok(r.writes.every(p=>!(p[7]&&p[6]) && !(p[5]&&p[4])),`${from} -> ${to}`);
    r.pararMotores(); assert.deepEqual(r.pins,{7:0,6:0,5:0,4:0});
  }
});
