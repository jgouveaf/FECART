'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../firmware/quantum_tracker_arduino/quantum_tracker_arduino.ino'), 'utf8');
function body(name) {
  const signature=name.startsWith('TIMER1_')?`ISR(${name})`:`void ${name}(`;
  assert.ok(source.includes(signature),signature);
  const start = source.indexOf('{', source.indexOf(signature));
  let end=start+1, depth=1;
  while(depth) { if(source[end]==='{') depth++; if(source[end]==='}') depth--; end++; }
  return source.slice(start+1,end-1).replace(/\bconst byte /g,'const ').replace(/\bbyte /g,'let ');
}
function rig() {
  const e={LOW:0,HIGH:1,IN1:7,IN2:6,IN3:5,IN4:4,saidaIn1:255,saidaIn2:255,saidaIn3:255,saidaIn4:255,
    CMD_PARAR:0,CMD_FRENTE:1,CMD_TRAS:2,CMD_DIREITA:3,CMD_ESQUERDA:4,CMD_GIRAR:5,comandoAplicado:0,modo:1,MODO_SEGUIR:2,
    pins:{7:0,6:0,5:0,4:0},writes:[],portWrites:[],otherPins:0b1010,
    TCNT1:0,SREG:128,TCCR1A:0,TCCR1B:0,TIMSK1:0,TIFR1:0,OCR1A:0,OCR1B:0,
    TOV1:0,OCF1A:1,OCF1B:2,WGM10:0,WGM12:3,CS11:1,CS10:0,TOIE1:0,OCIE1A:1,OCIE1B:2,
    MASCARA_ESQUERDA:0xc0,MASCARA_DIREITA:0x30,direcaoPwmEsquerda:0,direcaoPwmDireita:0,_BV:pin=>1<<pin};
  for(const match of source.matchAll(/const byte (POTENCIA_MOTOR_\w+) = (\d+);/g))e[match[1]]=Number(match[2]);
  Object.defineProperty(e,'PORTD',{get:()=>e.otherPins|Object.entries(e.pins).reduce((bits,[pin,value])=>bits|(value<<pin),0),set(value){
    e.otherPins=value&15;for(const pin of [4,5,6,7])e.pins[pin]=(value>>pin)&1;e.portWrites.push(value&255);
  }});
  e.cli=()=>{e.SREG&=~128;};
  e.digitalWrite=(pin,value)=>{ e.pins[pin]=value; e.writes.push({...e.pins,pin,value}); };
  vm.createContext(e);
  for(const name of ['iniciarControlePotencia','atualizarPotenciasMotores','TIMER1_OVF_vect','TIMER1_COMPA_vect','TIMER1_COMPB_vect','aplicarMotores','pararMotores','andarParaFrente','andarParaTras','girarDireita','girarEsquerda','girarNoLugar','aplicarComando']) {
    const args=name==='aplicarMotores'?'in1,in2,in3,in4':name==='aplicarComando'?'comando':'';
    vm.runInContext(`function ${name}(${args}) { ${body(name)} }`,e);
  }
  e.pararMotores();e.iniciarControlePotencia();e.writes=[];e.portWrites=[];return e;
}
test('Mode 2 slows both wheels equally and curves with both moving forward',()=>{
  const r=rig();r.modo=2;r.andarParaFrente();
  assert.equal(r.OCR1A,170);assert.equal(r.OCR1B,170);
  r.girarDireita();assert.equal(r.OCR1A,170);assert.equal(r.OCR1B,136);
  assert.deepEqual(r.pins,{7:0,6:1,5:0,4:1});
  r.girarEsquerda();assert.equal(r.OCR1A,136);assert.equal(r.OCR1B,170);
  r.andarParaFrente();assert.equal(r.OCR1A,170);assert.equal(r.OCR1B,170);
  r.pararMotores();r.TIMER1_OVF_vect();assert.equal(r.PORTD&240,0);
  for(const mode of [1,3]) {r.modo=mode;r.andarParaFrente();assert.equal(r.OCR1A,200);assert.equal(r.OCR1B,200);r.girarDireita();assert.equal(r.direcaoPwmDireita,0);}
});

test('FRENTE drives both bridges continuously through repeated commands',()=>{
  const r=rig(); r.aplicarComando(r.CMD_FRENTE);
  assert.deepEqual(r.pins,{7:0,6:1,5:0,4:1});
  r.writes=[];
  for(let i=0;i<1000;i++) { r.aplicarComando(r.CMD_FRENTE); r.andarParaFrente(); }
  assert.equal(r.writes.length,0,'Repeated forward must not interrupt either motor');
  assert.equal(r.portWrites.length,1,'Only the initial direction update writes PORTD');
});

test('PWM uses the existing direction pins, separate power and no ENA/ENB rewiring',()=>{
  const r=rig();assert.equal(r.OCR1A,200);assert.equal(r.OCR1B,200);
  assert.equal(r.TCCR1A,1);assert.equal(r.TCCR1B,11);assert.equal(r.TIMSK1,7);
  assert.equal(r.SREG,128);assert.ok(!/const byte EN[AB]\s*=/.test(source));
  r.andarParaFrente();r.TIMER1_OVF_vect();assert.equal(r.pins[6],1);assert.equal(r.pins[4],1);
  r.TIMER1_COMPB_vect();assert.equal(r.pins[6],1);assert.equal(r.pins[4],0);
  r.TIMER1_COMPA_vect();assert.equal(r.PORTD&240,0);assert.equal(r.otherPins,10);
  r.andarParaTras();r.TIMER1_OVF_vect();assert.equal(r.pins[7],1);assert.equal(r.pins[5],1);
});

test('PARAR stays stopped through every subsequent PWM interrupt',()=>{
  const r=rig();r.andarParaFrente();r.pararMotores();
  for(let i=0;i<1000;i++) {
    r.TIMER1_OVF_vect();r.TIMER1_COMPA_vect();r.TIMER1_COMPB_vect();
    assert.equal(r.PORTD&240,0);assert.equal(r.otherPins,10);
  }
});

test('direction transitions at each PWM phase preserve UART and sensor bits',()=>{
  const r=rig(),commands=['pararMotores','andarParaFrente','andarParaTras','girarDireita','girarEsquerda','girarNoLugar'];
  for(let phase=0;phase<256;phase++)for(const from of commands)for(const to of commands) {
    r.TCNT1=phase;r[from]();r.atualizarPotenciasMotores();r.writes=[];r.portWrites=[];r[to]();
    assert.ok(r.writes.every(p=>!(p[7]&&p[6])&&!(p[5]&&p[4])),`${from} -> ${to}, phase ${phase}`);
    assert.ok(r.portWrites.every(bits=>(bits&0xc0)!==0xc0&&(bits&0x30)!==0x30));
    assert.equal(r.PORTD&0xc0,phase<200?r.direcaoPwmEsquerda:0);
    assert.equal(r.PORTD&0x30,phase<200?r.direcaoPwmDireita:0);
    assert.equal(r.otherPins,10);assert.equal(r.SREG,128);
  }
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
