'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],attempts={};
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{localStorage.setItem('quantumAuth:v1','ok');window.__usb=0;
   Object.defineProperty(navigator,'serial',{value:{requestPort(){window.__usb++;throw Error('Physical IO disabled');}}});});
  await page.route('**/simulator-3d.js*',async route=>{
   const source=fs.readFileSync(path.join(__dirname,'../web/simulator-3d.js'),'utf8');
   await route.fulfill({contentType:'text/javascript',body:source.replace('renderer.render(scene,camera);','window.__scene=scene;renderer.render(scene,camera);')});
  });
  await page.route('**/assets/models/person*',route=>{
   const name=new URL(route.request().url()).pathname.split('/').pop();
   attempts[name]=(attempts[name]||0)+1;
   if(attempts[name]===1)return route.abort();
   return route.continue();
  });
  await page.goto((process.env.QT_SITE_URL||'http://127.0.0.1:9878/')+'#simulador');
  await page.locator('#simulationViewport').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.getElementById('simulationViewport').dataset.peopleGenders==='female,male',null,{timeout:60000});
  await page.waitForFunction(()=>{let loaded=0;window.__scene?.traverse(o=>{if(o.name.startsWith('person-model-'))loaded++;});return loaded===6;},null,{timeout:60000});
  const models=await page.evaluate(()=>{
   const output=[];
   window.__scene.traverse(object=>{
    if(!object.name.startsWith('person-model-'))return;
    let visible=true,ancestor=object;while(ancestor){visible=visible&&ancestor.visible;ancestor=ancestor.parent;}
    let skinned=0;object.traverse(child=>{if(child.isSkinnedMesh)skinned++;});
    output.push({name:object.name,visible,skinned,scale:object.scale.y});
   });return output;
  });
  assert.equal(models.length,6);assert.deepEqual([...new Set(models.map(m=>m.name))].sort(),['person-model-female','person-model-male']);
  for(const model of models){assert.equal(model.visible,true);assert.ok(model.skinned>0);assert.ok(Number.isFinite(model.scale)&&model.scale>0);}
  for(const name of ['person-mixamo.glb','person-male-mixamo.glb','person-motion.json'])assert.ok(attempts[name]>=2,name+' retried');
  await page.locator('#toggleSimulation').click();
  await page.locator('#simulationViewport').screenshot({path:'tests/artifacts/simulator-people-recovered.png'});
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.__usb),0);
  console.log('PASS - both visible skinned models recover after failed model and animation requests; no USB');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
