'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  await page.addInitScript(()=>localStorage.setItem('quantumAuth:v1','ok'));
  await page.route('**/simulator-3d.js*',route=>route.fulfill({contentType:'text/javascript',body:
   fs.readFileSync(path.join(__dirname,'../web/simulator-3d.js'),'utf8').replace('renderer.render(scene,camera);','window.__room={scene,camera,world};renderer.render(scene,camera);')}));
  await page.goto((process.env.QT_SITE_URL||'http://127.0.0.1:9878/')+'#simulador');
  await page.locator('#simulationViewport').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>window.__room&&document.getElementById('simulationViewport').dataset.peopleGenders==='female,male',null,{timeout:60000});
  await page.locator('#toggleSimulation').click();
  await page.evaluate(()=>Object.assign(window.__room.world.robot,{x:1400,y:900}));
  const canvas=page.locator('.simulation-webgl');
  await canvas.dispatchEvent('wheel',{deltaY:4000});
  await canvas.dispatchEvent('pointerdown',{pointerId:1,clientX:400,clientY:100});
  await canvas.dispatchEvent('pointermove',{pointerId:1,clientX:400,clientY:900});
  await canvas.dispatchEvent('pointerup',{pointerId:1});
  await page.waitForTimeout(600);
  const result=await page.evaluate(()=>{
   const {world,camera,scene}=window.__room,floor=scene.getObjectByName('office-floor'),ceiling=scene.getObjectByName('office-ceiling');
   return {width:world.width,depth:world.height,floor:floor.geometry.parameters,camera:camera.position.toArray(),bottom:ceiling.position.y-ceiling.geometry.parameters.height/2};
  });
  assert.equal(result.width,1800);assert.equal(result.depth,1200);
  assert.equal(result.floor.width,18);assert.equal(result.floor.height,12);
  assert.ok(result.camera[1]<=3.05&&result.camera[1]<result.bottom-.3);
  assert.ok(result.camera[0]>0&&result.camera[0]<18&&result.camera[2]>0&&result.camera[2]<12);
  await page.locator('#simulationViewport').screenshot({path:'tests/artifacts/simulator-expanded-room.png'});
  console.log('PASS - larger floor matches world; third-person camera stays below ceiling at maximum elevation/zoom');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
