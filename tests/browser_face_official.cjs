'use strict';
// Production page/storage with controlled descriptors; never camera or USB hardware.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const site=process.env.QT_SITE_URL || 'http://127.0.0.1:9877/';
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try {
  const context=await browser.newContext({permissions:['camera']});
  await context.addInitScript(()=>{
    localStorage.setItem('quantumAuth:v1','ok');
    window.__official={id:0,multiple:false,invalid:false,delay:0,loads:[],usb:0,fail:false};
    window.Human={Human:class {
      faceTriangulation=[0,1,2];tf={dispose(){}};match={similarity:(a,b)=>a[0]===b[0] ? .99 : .1};
    }};
    Object.defineProperty(navigator,'serial',{value:{requestPort(){window.__official.usb++;throw Error('No physical USB');}}});
  });
  await context.route('**/web/face-inference-client.js?*',r=>r.fulfill({contentType:'text/javascript',body:`
  window.QuantumFaceInference={FaceInferenceClient:class {
    ready=false;
    async load(cfg){this.engine=cfg.identityEngine;window.__official.loads.push(this.engine);this.ready=true;}
    close(){this.ready=false;}
    async detect(video,cfg){
      const t=window.__official,engine=this.engine,id=t.id;
      if(t.delay) await new Promise(r=>setTimeout(r,t.delay));
      if(t.fail) throw Error('Injected ONNX failure');
      const isNew=engine===window.QuantumFaceProfiles.ONNX;
      const embedding=isNew ? Array(128).fill(0) : Array(1024).fill(id+1);
      if(isNew) embedding[id]=1;
      if(t.invalid) embedding[5]=NaN;
      const w=cfg.filter.width,h=cfg.filter.height,size=180*w/video.videoWidth;
      const face={box:[w*.5-size/2,h*.25,size,size],faceScore:.99,embedding,engine,
        rotation:{angle:{yaw:0,pitch:0,roll:0}}};
      return {face:t.multiple ? [face,face] : [face],gesture:[],backend:isNew?'onnx-wasm':'wasm'};
    }
  }};` }));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const records=()=>page.evaluate(()=>new Promise(resolve=>{
    const request=indexedDB.open('quantum_tracker_biometrics',1);
    request.onsuccess=()=>{const db=request.result,q=db.transaction('identities').objectStore('identities').getAll();q.onsuccess=()=>{db.close();resolve(q.result);};};
  }));
  const enabled=()=>page.waitForFunction(()=>!document.getElementById('registerPerson').disabled);
  const enroll=async(name,count)=>{
    await page.locator('#personName').fill(name);await enabled();await page.locator('#registerPerson').click();
    await page.waitForFunction(count=>document.querySelectorAll('.person-card').length===count,count);
    await page.waitForFunction(()=>document.getElementById('personName').value==='');
  };
  await page.goto(site);await page.evaluate(()=>window.quantumCameraController.start());
  await enroll('Pessoa nova',1);
  let saved=(await records())[0];assert.equal(saved.sfaceEmbeddings.length,5);assert.equal(saved.embeddings.length,0);
  assert.equal(saved.engine,'scrfd-sface-2021dec-v1');assert.equal(saved.sfaceEmbeddings[0].length,128);
  console.log('ok - official enrollment saves five SFace samples without fabricated Human samples');
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.follow-person').length===1);
  assert.equal((await records())[0].id,saved.id);
  const downloadPromise=page.waitForEvent('download');await page.locator('#exportIdentities').click();
  const download=await downloadPromise,backup=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  assert.equal(backup.version,4);assert.equal(backup.identities[0].sfaceEmbeddings.length,5);
  const importBackup=async backup=>{
    await page.locator('#identityBackupFile').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await page.waitForFunction(()=>document.getElementById('faceHint').textContent.includes('atualizado(s)'));
  };
  await importBackup(backup);assert.equal((await records())[0].sfaceEmbeddings.length,5);
  const old={...saved,id:'QT-010',name:'Cadastro antigo',engine:'human-faceres-3.3.6',embeddings:Array(5).fill(Array(1024).fill(2))};delete old.sfaceEmbeddings;
  await importBackup({format:backup.format,version:3,identities:[old]});
  assert.equal((await records()).length,2);
  console.log('ok - reload/export/reimport preserve SFace samples and accept existing Human backup');
  await page.evaluate(()=>{window.__official.id=1;});
  const oldCard=page.locator('.person-card').filter({hasText:'Cadastro antigo'});
  await oldCard.locator('.follow-person').click();
  await page.waitForFunction(()=>window.quantumFacePerformance?.engine==='human-faceres-3.3.6');
  await page.waitForFunction(()=>document.getElementById('currentFaceId').textContent==='QT-010');
  assert.equal(await page.evaluate(()=>window.QuantumControl.state.mode.id),2);
  console.log('ok - selecting existing identity automatically uses compatible engine');
  await oldCard.locator('.upgrade-person').click();await enabled();
  assert.equal(await page.evaluate(()=>window.quantumPersonFollower.snapshot.id),null);
  await page.locator('#registerPerson').click();
  await page.waitForFunction(()=>document.getElementById('personName').value==='');
  const updated=(await records()).find(r=>r.id==='QT-010');
  assert.equal(updated.sfaceEmbeddings.length,5);assert.equal(updated.embeddings.length,5);assert.equal(updated.name,old.name);
  await importBackup({format:backup.format,version:3,identities:[old]});
  const preserved=(await records()).find(r=>r.id==='QT-010');assert.equal(preserved.sfaceEmbeddings.length,5);assert.equal(preserved.embeddings.length,5);
  console.log('ok - updating recognition preserves ID, photo record and old samples; old import cannot downgrade it');
  await page.locator('#personName').fill(old.name);await enabled();
  await page.evaluate(()=>{window.__official.multiple=true;});await page.waitForFunction(()=>document.getElementById('registerPerson').disabled);
  await page.evaluate(()=>{window.__official.multiple=false;window.__official.invalid=true;});
  await page.waitForTimeout(450);assert.equal(await page.locator('#registerPerson').isEnabled(),false);
  await page.evaluate(()=>{window.__official.invalid=false;});await enabled();
  await page.locator('#registerPerson').click();
  await page.evaluate(()=>window.quantumCameraController.stop());await page.waitForTimeout(400);
  assert.equal((await records()).find(r=>r.id==='QT-010').sfaceEmbeddings.length,5);
  assert.equal(await page.evaluate(()=>window.__official.usb),0);assert.deepEqual(errors,[]);
  console.log('PASS - official SFace enrollment, mixed gallery, upgrade, backup, invalid/multiple evidence and cancellation');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
