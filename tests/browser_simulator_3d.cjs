'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],assetErrors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.url().includes('/assets/models/')&&!r.ok())assetErrors.push(r.url());});
  await page.addInitScript(()=>{localStorage.setItem('quantumAuth:v1','ok');window.__hardware=0;
    Object.defineProperty(navigator,'serial',{value:{requestPort(){window.__hardware++;throw Error('No physical port allowed');}}});});
  await page.goto((process.env.QT_SITE_URL||'http://127.0.0.1:9877/')+'#simulador');
  await page.locator('#simulationViewport').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>window.QuantumSimulator?.snapshot().graphicsReady,null,{timeout:30000});
  await page.waitForFunction(()=>{const el=document.getElementById('simulationViewport');return el.dataset.environment==='office'&&el.dataset.peopleModel==='mixamo';},null,{timeout:30000});
  const snapshot=()=>page.evaluate(()=>window.QuantumSimulator.snapshot());
  await page.locator('#toggleSimulation').click();
  await page.locator('#simulationViewport').screenshot({path:'tests/artifacts/simulator-third-person.png'});
  await page.locator('#simViewFirst').click();await page.waitForFunction(()=>window.QuantumSimulator.snapshot().view==='first');
  await page.locator('#simulationViewport').screenshot({path:'tests/artifacts/simulator-first-person.png'});
  await page.locator('#simViewThird').click();
  await page.locator('#resetSimulation').click();await page.locator('#simFollowMode').click();
  const before=await snapshot();await page.waitForTimeout(800);const following=await snapshot();
  assert.ok(following.robot.x>before.robot.x);assert.equal(following.scene.targetVisible,true);
  await page.locator('#simPeopleVisibility').click();await page.waitForFunction(()=>window.QuantumSimulator.snapshot().command==='PARAR');
  await page.locator('#simPeopleVisibility').click();await page.locator('#simAddPerson').click();assert.equal((await snapshot()).people.length,7);
  await page.locator('#resetSimulation').click();assert.equal((await snapshot()).people.length,6);
  await page.locator('#simGestureMode').click();await page.locator('#simulationViewport').scrollIntoViewIfNeeded();await page.locator('#simulationViewport').focus();
  const manual=await snapshot();await page.keyboard.press('ArrowUp');
  await page.waitForFunction(x=>window.QuantumSimulator.snapshot().robot.x>x,manual.robot.x);
  assert.ok((await snapshot()).robot.x>manual.robot.x);
  await page.keyboard.press('Space');assert.equal((await snapshot()).command,'PARAR');
  await page.keyboard.press('ArrowUp');await page.waitForTimeout(1000);assert.equal((await snapshot()).command,'PARAR');
  await page.locator('#simAutonomousMode').click();await page.waitForTimeout(300);assert.equal((await snapshot()).mode,'AUTONOMO');
  for(const width of [360,768,1440]) {await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`layout ${width}`);}
  await page.locator('#cameraStage').evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));
  await page.waitForFunction(()=>{const r=document.getElementById('simulationViewport').getBoundingClientRect();return r.top>=innerHeight||r.bottom<=0;});
  await page.waitForFunction(()=>window.QuantumSimulator.snapshot().visible===false);
  const offscreen=await snapshot();await page.waitForTimeout(250);assert.deepEqual((await snapshot()).robot,offscreen.robot,'Offscreen 3D releases CPU');
  assert.equal(await page.evaluate(()=>window.__hardware),0);assert.deepEqual(errors,[]);assert.deepEqual(assetErrors,[]);
  console.log('PASS - 3D first/third view, virtual people, all three modes, collision world, responsive layout and no physical USB');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
