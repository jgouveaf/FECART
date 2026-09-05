// Test-only firmware. No physical Arduino, camera or USB access.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { env } = require('./autonomous_isolated_logic.test.cjs');
const source = fs.readFileSync(path.join(__dirname, '../firmware/autonomo_ide_5cm/autonomo_ide_5cm.ino'), 'utf8');
const make = () => env(source);
const tests = {
  five_cm_only_in_the_ide_sketch() {
    assert.equal(make().LIMITE_CM, 5);
    assert.equal(env().LIMITE_CM, 35, 'published firmware must remain unchanged');
  },
  boot_stays_stopped_until_start() {
    const e=make(); e.tick(10,10000); assert.equal(e.motor,'PARAR');
    e.command('START\n'); e.tick(10,400); assert.equal(e.motor,'FRENTE');
  },
  measured_5_5_does_not_trigger_the_turn() {
    const e=make(); e.command('START\n'); e.tick(5.5,600000);
    assert.equal(e.motor,'FRENTE'); assert.equal(e.commands.includes('RE'),false);
  },
  stops_at_exactly_5_and_confirms_before_reverse() {
    const e=make(); e.command('START\n'); e.tick(10,400); e.tick(5,80);
    assert.equal(e.motor,'PARAR'); assert.equal(e.fase,e.VERIFICAR);
    e.tick(5,80); assert.equal(e.fase,e.VERIFICAR);
    e.tick(5,80); assert.equal(e.fase,e.PAUSA_RE);
    e.tick(5,160); assert.equal(e.motor,'RE');
  },
  hundred_obstacles_have_no_mission_timeout() {
    const e=make(); e.command('START\n'); e.tick(10,1000);
    for(let n=0;n<100;n++) {
      e.tick(4,240); assert.equal(e.fase,e.PAUSA_RE);
      e.tick(4,900); assert.ok(['DIREITA','ESQUERDA'].includes(e.motor));
      e.tick(10,2000); assert.equal(e.motor,'FRENTE');
    }
  },
  persistent_4_cm_still_turns_and_never_blindly_advances() {
    const e=make(); e.command('START\n'); e.tick(4,10000);
    assert.equal(e.commands.includes('FRENTE'),false);
    assert.equal(e.commands.filter(x=>x==='RE').length,1);
    assert.equal(e.habilitado,true);
  },
  a_single_5_cm_spike_does_not_maneuver() {
    const e=make(); e.command('START\n'); e.tick(10,400); e.tick(5,80); e.tick(10,240);
    assert.equal(e.motor,'FRENTE'); assert.equal(e.commands.includes('RE'),false);
  },
  missing_or_out_of_range_echo_stops_even_with_5_cm_limit() {
    for(const cm of [-1,1.9,401]) {
      const e=make(); e.command('START\n'); e.tick(10,400); e.tick(cm,1000);
      assert.equal(e.motor,'PARAR'); assert.equal(e.fase,e.SENSOR);
    }
  },
  curve_drives_one_wheel_forward_and_stops_the_other() {
    const e = make();
    e.direita = true;
    e.entrar(e.CURVA, 0);
    assert.deepEqual(Array.from(e.pins), [0, 1, 0, 0]);
    e.direita = false;
    e.entrar(e.CURVA, 0);
    assert.deepEqual(Array.from(e.pins), [0, 0, 0, 1]);
  },
  stop_is_latched_in_every_phase() {
    for(let phase=0;phase<8;phase++) {
      const e=make(); e.habilitado=true; e.entrar(phase,0); e.command('STOP\r\n'); e.tick(10,5000);
      assert.equal(e.motor,'PARAR'); assert.equal(e.habilitado,false);
    }
  },
  different_identity_prevents_mistaking_this_for_site_firmware() {
    const e=make(); e.command('HELLO\n');
    assert.ok(e.output.includes('AUTO:IDE:5CM:3'));
    assert.equal(e.output.includes('AUTO:READY:2'),false);
  },
};
for(const [name,test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} IDE 5 cm scenarios passed. IO and time simulated.`);
