// Real sketch function bodies, mocked Arduino IO and virtual time.
// Not a hardware/AVR simulator: numeric rollover and electrical behavior excluded.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../firmware/autonomo_isolado/autonomo_isolado.ino'), 'utf8');
function body(name) {
  const found = source.indexOf(`void ${name}(`);
  assert.ok(found >= 0, name);
  const start = source.indexOf('{', found);
  let depth = 1, end = start + 1;
  while (depth) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
  return source.slice(start + 1, end - 1)
    .replace(/\bconst char /g, 'const ').replace(/\bbyte /g, 'let ')
    .replace(/\b(\d+)UL\b/g, '$1').replace(/sizeof\(linha\)/g, '20');
}
function env() {
  const e = { now: 0, pulse: 5800, fase: 0, habilitado: false, direita: true,
    permitirRe: true, leiturasValidas: 0, leiturasPerto: 0, leiturasLivres: 0, faseDesde: 0, sensorDesde: 0,
    telemetriaDesde: 0, ecoUs: 0, amostra: 0, distanciaCm: -1, motor: 'PARAR',
    linha: [], tamanho: 0, descartar: false, input: [], output: [], commands: [],
    LOW: 0, HIGH: 1, TRIG: 3, ECHO: 2, F: x => x };
  for (const m of source.matchAll(/const (?:unsigned long|float) (\w+) = ([\d.]+)(?:UL)?;/g)) e[m[1]] = Number(m[2]);
  source.match(/enum Fase \{([^}]+)\}/)[1].split(',').forEach((s, i) => { e[s.trim()] = i; });
  e.millis = () => e.now;
  e.digitalWrite = () => {};
  e.delayMicroseconds = () => {};
  e.pulseIn = () => e.pulse;
  e.motores = (a, b, c, d, cmd) => { e.motor = cmd; e.pins = [a,b,c,d]; e.commands.push(cmd); };
  e.status = () => {};
  e.strcmp = (a,b) => (Array.isArray(a) ? a.slice(0, a.indexOf(0)).join('') : a) === b ? 0 : 1;
  e.Serial = { println: x => e.output.push(x), available: () => e.input.length, read: () => e.input.shift() };
  vm.createContext(e);
  for (const name of ['entrar', 'parar', 'medir', 'atualizar', 'processar', 'lerSerial']) {
    vm.runInContext(`function ${name}(${name === 'entrar' ? 'nova, agora' : 'agora'}) {${body(name)}}`, e);
  }
  e.tick = (cm, ms = 80) => {
    e.pulse = cm < 0 ? 0 : Math.round(cm * 58);
    for (let t = 0; t < ms; t += 10) { e.now += 10; e.lerSerial(e.now); e.medir(e.now); e.atualizar(e.now); }
  };
  e.command = text => { e.input.push(...text); while (e.input.length) e.lerSerial(e.now); };
  return e;
}
const tests = {
  a_single_near_reading_stops_but_does_not_reverse() {
    const e=env(); e.command('START\n'); e.tick(100,400);
    e.tick(5,80);
    assert.equal(e.motor,'PARAR'); assert.equal(e.fase,e.VERIFICAR);
    e.tick(100,240);
    assert.equal(e.motor,'FRENTE'); assert.equal(e.commands.includes('RE'),false);
    assert.equal(e.commands.includes('DIREITA') || e.commands.includes('ESQUERDA'),false);
  },
  only_new_samples_can_confirm_an_obstacle() {
    const e=env(); e.command('START\n'); e.tick(100,400); e.tick(5,80);
    for(let n=0;n<1000;n++) e.atualizar(e.now);
    assert.equal(e.motor,'PARAR'); assert.equal(e.fase,e.VERIFICAR);
  },
  needs_two_near_readings_after_stopping() {
    const e=env(); e.command('START\n'); e.tick(100,400); e.tick(5,80);
    e.tick(5,80); assert.equal(e.fase,e.VERIFICAR);
    e.tick(5,80); assert.equal(e.fase,e.PAUSA_RE);
    e.tick(5,160); assert.equal(e.motor,'RE');
  },
  alternating_near_and_clear_stays_stopped_not_blind() {
    const e=env(); e.command('START\n');
    for(let n=0;n<100;n++) { e.tick(5,80); e.tick(100,80); }
    assert.equal(e.motor,'PARAR'); assert.equal(e.habilitado,true);
    assert.equal(e.commands.some(c=>c!=='PARAR'),false);
  },
  all_user_readings_10_20_30_5_are_obstacles_not_free_space() {
    const e=env(); e.command('START\n');
    for(let n=0;n<100;n++) for(const cm of [10,20,30,5]) e.tick(cm,80);
    assert.equal(e.commands.includes('FRENTE'),false);
    assert.equal(e.habilitado,true);
  },
  a_far_outlier_cannot_release_a_confirmed_obstacle() {
    const e=env(); e.command('START\n'); e.tick(5,80); e.tick(100,80); e.tick(5,80);
    assert.equal(e.motor,'PARAR'); assert.equal(e.commands.includes('FRENTE'),false);
  },
  cancelled_spike_does_not_change_the_next_turn_direction() {
    const e=env(); e.command('START\n'); e.tick(100,400); const before=e.direita;
    e.tick(5,80); e.tick(100,240); assert.equal(e.direita,before);
    e.tick(5,240); assert.equal(e.direita,!before);
  },
  invalid_reading_resets_obstacle_confirmation() {
    const e=env(); e.command('START\n'); e.tick(5,80); e.tick(-1,80); e.tick(5,80);
    assert.equal(e.motor,'PARAR'); assert.equal(e.commands.includes('RE'),false);
  },
  fresh_readings_are_required_after_turn() {
    const e=env(); e.tick(100,160); e.habilitado=true; e.entrar(e.CURVA,e.now);
    e.tick(100,650); assert.equal(e.fase,e.VERIFICAR);
    assert.equal(e.leiturasLivres,0);
    e.tick(100,70); assert.equal(e.motor,'PARAR');
    e.tick(100,80); assert.equal(e.motor,'FRENTE');
  },
  disappeared_obstacle_does_not_trigger_delayed_reverse() {
    const e=env(); e.tick(100,160); e.command('START\n'); e.tick(5,160);
    assert.equal(e.fase,e.PAUSA_RE);
    e.tick(100,240);
    assert.equal(e.commands.includes('RE'),false);
    assert.equal(e.motor,'FRENTE');
  },
  boot_remains_stopped() { const e=env(); e.tick(100,10000); assert.equal(e.motor,'PARAR'); },
  continuous_without_usb_10_minutes() { const e=env(); e.command('START\n'); e.tick(100,600000); assert.equal(e.motor,'FRENTE'); },
  hundred_obstacles_resume() {
    const e=env(); e.command('START\n'); e.tick(100,1000);
    for(let n=0;n<100;n++) {
      e.tick(10,240); assert.equal(e.fase,e.PAUSA_RE);
      e.tick(10,900); assert.ok(['DIREITA','ESQUERDA'].includes(e.motor));
      e.tick(100,2000); assert.equal(e.motor,'FRENTE');
    }
  },
  repeated_near_readings_do_not_repeat_reverse() {
    const e=env(); e.command('START\n'); e.tick(100,300); e.tick(10,80);
    e.tick(10,3000);
    for(let n=0;n<300;n++) { e.tick(10); assert.notEqual(e.motor,'RE'); assert.notEqual(e.motor,'FRENTE'); }
  },
  stop_is_latched_in_every_phase() {
    for(let phase=0;phase<8;phase++) { const e=env(); e.habilitado=true; e.entrar(phase,0); e.command('STOP\n'); e.tick(100,5000); assert.equal(e.motor,'PARAR'); assert.equal(e.habilitado,false); }
  },
  invalid_sensor_stops_and_recovers_without_repeating_reverse() {
    for(let phase=1;phase<7;phase++) { const e=env(); e.habilitado=true; e.permitirRe=false; e.entrar(phase,0); e.tick(-1,1000); assert.equal(e.motor,'PARAR'); assert.equal(e.fase,e.SENSOR); e.tick(100,400); assert.equal(e.motor,'FRENTE'); }
  },
  start_is_idempotent() { const e=env(); e.command('START\n'); e.tick(100,500); const before=e.faseDesde; e.command('START\n'); assert.equal(e.fase,e.FRENTE); assert.equal(e.faseDesde,before); },
  no_dead_zone_just_above_threshold() { const e=env(); e.command('START\n'); e.tick(35.1,1000); assert.equal(e.motor,'FRENTE'); },
  zero_echo_is_invalid_not_clear() { const e=env(); e.command('START\n'); e.tick(-1,10000); assert.equal(e.distanciaCm,-1); assert.equal(e.motor,'PARAR'); },
  echo_is_reported_without_saturation() { const e=env(); e.tick(20); assert.equal(e.distanciaCm,20); assert.equal(e.ecoUs,1160); e.tick(51.4); assert.ok(Math.abs(e.distanciaCm-51.4)<.02); },
  oversized_command_does_not_execute_suffix() { const e=env(); e.command('START\n'); e.tick(100,300); e.command('X'.repeat(50)+'START\n'); e.tick(100,500); assert.equal(e.habilitado,false); e.command('START\r\n'); e.tick(100,500); assert.equal(e.motor,'FRENTE'); },
  mode_and_gesture_commands_are_rejected() { const e=env(); e.command('MODE:1\nRESET_ESTOP\nCMD:FRENTE\n'); e.tick(100,1000); assert.equal(e.motor,'PARAR'); assert.equal(e.output.filter(x=>x==='ERR:COMMAND').length,3); },
  serial_processing_is_bounded() { const e=env(); e.input.push(...'X'.repeat(200)); e.lerSerial(0); assert.equal(e.input.length,152); },
  opposite_motor_signals_for_turns() { const e=env(); for(const right of [true,false]) { e.direita=right; e.entrar(e.CURVA,0); assert.notEqual(e.pins[0],e.pins[2]); assert.notEqual(e.pins[1],e.pins[3]); } },
};
for(const [name,test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} isolated autonomous logic scenarios passed.`);
