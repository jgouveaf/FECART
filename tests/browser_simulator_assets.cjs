'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.QT_SITE_URL||'http://127.0.0.1:9878/';
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  async function pageForTest() {
   const page=await browser.newPage({viewport:{width:1200,height:950}});
   await page.addInitScript(()=>{
    localStorage.setItem('quantumAuth:v1','ok');window.__usbRequests=0;
    Object.defineProperty(navigator,'serial',{value:{requestPort(){window.__usbRequests++;throw Error('Physical IO disabled');}}});
    let worldAPI,graphicsAPI;
    Object.defineProperty(window,'QuantumSimulatorWorld',{get:()=>worldAPI,set(value){
     worldAPI={...value,World:class extends value.World{constructor(...args){super(...args);window.__world=this;}}};
    }});
    Object.defineProperty(window,'QuantumSimulator3D',{get:()=>graphicsAPI,set(value){
     graphicsAPI={...value,async create(...args){const view=await value.create(...args);window.__graphics=view;return view;}};
    }});
   });
   return page;
  }
  const page=await pageForTest(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'#simulador');await page.locator('#simulationViewport').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.getElementById('simulationViewport').dataset.peopleModel==='mixamo'&&document.getElementById('simulationViewport').dataset.peopleGenders==='female,male'&&window.__world.environmentId==='office',null,{timeout:60000});
  const result=await page.evaluate(()=>{
   const w=window.__world;w.running=false;
   const kinds=w.obstacles.map(o=>o.kind);
   const missing=kinds.filter(kind=>{const o=w.obstacles.find(x=>x.kind===kind);return !w.personBlocked(o.x+o.w/2,o.y+o.h/2);});
   const errors=[];
   for(const mode of ['AUTONOMO','SEGUIR','GESTOS']) {
    w.reset();w.peopleMoving=false;
    for(let i=0;i<1000;i++) {
     w.step(.02,{mode,command:'FRENTE',virtualFollow:mode==='SEGUIR'});
     if(w.collides(w.robot.x,w.robot.y)){errors.push(mode+' penetration');break;}
    }
   }
   w.reset();w.addPerson();w.addPerson();w.addPerson();
   for(let i=0;i<1500;i++) {
    w.advancePeople(.02);
    if(w.people.some(p=>w.personBlocked(p.x,p.y))){errors.push('pedestrian inside furniture');break;}
   }
   w.reset();w.running=false;
   const stopped=new Map();
   for(let i=0;i<9000;i++) {
    const before=w.people.map(p=>({x:p.x,y:p.y}));w.advancePeople(.02);
    for(let j=0;j<w.people.length;j++) {
     const p=w.people[j],still=Math.hypot(p.x-before[j].x,p.y-before[j].y)<.001;
     stopped.set(p.id,still?(stopped.get(p.id)||0)+.02:0);
     if(stopped.get(p.id)>5){errors.push(p.name+' stuck on route for 5 seconds');i=9000;break;}
    }
   }
   w.reset();w.running=false;
   return {count:kinds.length,kinds,missing,errors,usb:window.__usbRequests};
  });
  assert.ok(result.count>=2);assert.ok(result.kinds.some(name=>name.includes('reception-desk')));
  assert.deepEqual(result.missing,[]);assert.deepEqual(result.errors,[]);assert.equal(result.usb,0);
  assert.deepEqual(errors,[]);await page.close();

  const fallback=await pageForTest(),fallbackErrors=[];fallback.on('pageerror',error=>fallbackErrors.push(error.message));
  await fallback.route('**/assets/models/**',route=>route.abort());
  await fallback.goto(base+'#simulador');await fallback.locator('#simulationViewport').scrollIntoViewIfNeeded();
  await fallback.waitForFunction(()=>window.__graphics?.ready,null,{timeout:60000});
  await fallback.waitForFunction(()=>document.getElementById('simGraphicsStatus').textContent.includes('cenário local'));
  const failed=await fallback.evaluate(()=>({obstacles:window.__world.obstacles.length,environment:window.__world.environmentId||null,usb:window.__usbRequests}));
  assert.equal(failed.obstacles,12);assert.equal(failed.environment,null);assert.equal(failed.usb,0);assert.deepEqual(fallbackErrors,[]);
  await fallback.close();
  console.log('PASS - real GLB furniture collisions, three virtual modes, people routes, load-failure fallback and zero USB access');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
