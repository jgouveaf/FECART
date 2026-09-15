'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {World}=require('../web/simulator-world.js');
const advance=(w,seconds,input)=>{for(let i=0;i<seconds*100;i++)w.step(.01,input);return w.output;};
test('forward drives equal wheels; turns preserve the approved one-wheel arc',()=>{
  const w=new World();w.peopleVisible=false;
  const x=w.robot.x;advance(w,1,{mode:'GESTOS',command:'FRENTE'});
  assert.ok(Math.abs(w.robot.x-x-38)<.01);assert.equal(w.robot.left,w.robot.right);assert.equal(w.robot.angle,0);
  advance(w,.2,{mode:'GESTOS',command:'DIREITA'});assert.equal(w.robot.right,0);assert.ok(w.robot.angle>0);assert.ok(w.robot.y>410);
  advance(w,.1,{mode:'GESTOS',command:'PARAR'});assert.equal(w.robot.left,0);assert.equal(w.robot.right,0);
});
test('autonomous mode avoids a fixed obstacle without penetrating its geometry',()=>{
  const w=new World();w.peopleVisible=false;w.robot.x=260;w.robot.y=220;
  const phases=new Set();for(let i=0;i<1500;i++){w.step(.01,{command:'FRENTE'});phases.add(w.output.command);assert.equal(w.collides(w.robot.x,w.robot.y),false);}
  assert.ok(w.events>0);assert.ok(phases.has('TRAS'));assert.ok(phases.has('DIREITA'));assert.ok(phases.has('FRENTE'));
});
test('follow mode tracks the chosen virtual person and stops on absence or occlusion',()=>{
  const w=new World(),x=w.robot.x;advance(w,2,{mode:'SEGUIR',virtualFollow:true});assert.ok(w.robot.x>x);
  w.peopleVisible=false;assert.equal(w.step(.02,{mode:'SEGUIR',virtualFollow:true}).command,'PARAR');
  w.peopleVisible=true;w.peopleMoving=false;w.people[0].x=500;w.people[0].y=200;w.robot.x=250;w.robot.y=200;w.robot.angle=0;
  assert.equal(w.visibleTarget(),null);assert.equal(w.step(.02,{mode:'SEGUIR',virtualFollow:true}).command,'PARAR');
});
test('reset produces the same fixed scene and removes added people',()=>{
  const a=new World(),b=new World();a.addPerson();a.addPerson();a.reset();assert.deepEqual(a.people,b.people);
  for(let i=0;i<100;i++){a.step(.01,{command:'FRENTE'});b.step(.01,{command:'FRENTE'});}assert.deepEqual(a.robot,b.robot);
});
test('a delayed render cannot jump through obstacles or outside the room',()=>{
  const w=new World();w.peopleVisible=false;const x=w.robot.x;w.step(50,{command:'FRENTE'});assert.ok(w.robot.x-x<2);
  w.robot.x=18;w.robot.angle=Math.PI;for(let i=0;i<100;i++)w.step(.01,{mode:'GESTOS',command:'TRAS'});
  assert.ok(w.robot.x>=w.robot.radius);assert.ok(w.robot.x<=w.width-w.robot.radius);
});

test('swept chassis collision stops before a furnishing instead of entering it',()=>{
  const w=new World();w.peopleVisible=false;w.robot.x=305;w.robot.y=220;w.robot.angle=0;
  let output;for(let i=0;i<100;i++) output=w.step(.05,{mode:'GESTOS',command:'FRENTE'});
  assert.equal(w.collides(w.robot.x,w.robot.y),false);assert.equal(output.command,'PARAR');
  assert.equal(output.safety,'COLISÃO EVITADA');assert.equal(output.collision.type,'OBSTÁCULO');
  assert.ok(w.robot.x<350-w.robot.radius);
});

test('people never advance through laboratory furniture',()=>{
  const w=new World();const p=w.people[0];p.x=330;p.y=220;p.route=[[330,220],[470,220]];p.leg=1;p.speed=90;
  for(let i=0;i<80;i++) w.advancePeople(.05);
  assert.equal(w.personBlocked(p.x,p.y),false);
});

test('following distance has hysteresis instead of alternating at one threshold',()=>{
  const w=new World();w.peopleMoving=false;
  for(const [distance,command] of [[150,'FRENTE'],[94,'PARAR'],[96,'PARAR'],[115,'PARAR'],[125,'FRENTE']]) {
    w.people[0].x=w.robot.x+distance;w.people[0].y=w.robot.y;
    assert.equal(w.step(.01,{mode:'SEGUIR',virtualFollow:true}).command,command);
  }
});

test('imported office replaces old obstacles atomically and survives reset',()=>{
  const w=new World();w.running=false;w.peopleMoving=false;
  const obstacles=[{x:420,y:120,w:80,h:100,height:90,kind:'desk'}];
  assert.equal(w.setEnvironment('office',obstacles),true);
  assert.equal(w.collides(400,220),false,'old bench must no longer collide');
  assert.equal(w.collides(460,170),true,'downloaded furniture must collide');
  assert.equal(w.running,false);assert.equal(w.peopleMoving,false);
  obstacles[0].x=900;assert.equal(w.obstacles[0].x,420,'owns its collision copy');
  w.reset();assert.equal(w.obstacles[0].x,420);assert.equal(w.environmentId,'office');
  assert.equal(w.people[1].y,430);assert.equal(w.personBlocked(w.robot.x,w.robot.y),false);
});

test('invalid imported collision data leaves the working world intact',()=>{
  const w=new World();const old=w.obstacles;
  assert.equal(w.setEnvironment('office',[{x:NaN,y:0,w:1,h:1,height:1}]),false);
  assert.equal(w.setEnvironment('office',[]),false);assert.equal(w.obstacles,old);
});

test('a pedestrian waits rather than walking into a stopped robot',()=>{
  const w=new World();w.people[0].x=w.robot.x+38;w.people[0].y=w.robot.y;
  w.people[0].route=[[w.robot.x-100,w.robot.y]];w.people[0].leg=0;
  for(let i=0;i<200;i++)w.advancePeople(.05);
  assert.ok(Math.hypot(w.people[0].x-w.robot.x,w.people[0].y-w.robot.y)>=w.robot.radius+19);
});
