'use strict';
// Controlled 1280x720 camera fixture; real face model, optional real body model.
// Reports timings for this machine, without asserting a universal FPS guarantee.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const site = process.env.QT_SITE_URL || 'http://127.0.0.1:9877/';
const runtime = fs.readFileSync(path.join(__dirname, '../web/vendor/human/human.js'), 'utf8');
const fixture = /V0=`([^`]+)`/.exec(runtime)[1];
(async () => {
 const browser = await chromium.launch({headless:true});
 try {
  const page = await browser.newPage();
  await page.route('**/__bench.jpg', route => route.fulfill({contentType:'image/jpeg',body:Buffer.from(fixture,'base64')}));
  await page.addInitScript(() => {
   localStorage.setItem('quantumAuth:v1','ok');
   const devices = new EventTarget(); devices.enumerateDevices = async()=>[];
   devices.getUserMedia=async()=>{
    const c=document.createElement('canvas'); c.width=1280;c.height=720;
    const ctx=c.getContext('2d'),img=new Image(); img.src='__bench.jpg';await img.decode();
    let frame=0;
    const paint=()=>{ctx.fillStyle='#273546';ctx.fillRect(0,0,1280,720);ctx.drawImage(img,360+Math.sin(frame++*.1)*12,80,560,560);};
    paint();const timer=setInterval(paint,42),s=c.captureStream(24),t=s.getVideoTracks()[0],stop=t.stop.bind(t);
    t.stop=()=>{clearInterval(timer);stop();};return s;
   };
   Object.defineProperty(navigator,'mediaDevices',{value:devices});
  });
  await page.goto(site);
  await page.evaluate(()=>{
   window.__bench={calls:[],gaps:[]};
   const prototype=window.QuantumFaceInference.FaceInferenceClient.prototype,detect=prototype.detect;
   prototype.detect=async function(...args){const start=performance.now(),r=await detect.apply(this,args);if(r.face[0]?.embedding)window.__bench.embedding=r.face[0].embedding;window.__bench.calls.push({ms:performance.now()-start,perf:r.performance,faces:r.face.length,confidence:r.face[0]?.faceScore,profile:args[1].face.liveness.enabled,backend:r.backend});return r;};
   let previous=performance.now();window.__tick=setInterval(()=>{const now=performance.now();window.__bench.gaps.push(now-previous);previous=now;},25);
   window.quantumRobot.requestMode(2,'benchmark');
  });
  await page.waitForFunction(()=>window.__bench.calls.length>=10,null,{timeout:120000});
  if(process.env.QT_BOTH_WORKERS==='1') {
   const embedding=await page.evaluate(()=>window.__bench.embedding);
   const record={id:'QT-001',name:'Teste local',engine:'human-faceres-3.3.6',embeddings:Array(5).fill(embedding),photo:'data:image/jpeg;base64,'+fixture,createdAt:new Date().toISOString()};
   page.on('dialog', d=>d.accept());
   await page.locator('#identityBackupFile').setInputFiles({name:'bench.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'quantum-tracker-face-identities',version:3,engine:record.engine,identities:[record]}))});
   await page.locator('.follow-person').click();
   await page.waitForFunction(()=>window.quantumPersonFollower.diagnostics.frameAgeMs!==null,null,{timeout:30000});
  }
  await page.evaluate(()=>{window.__bench.calls=[];window.__bench.gaps=[];});
  await page.waitForTimeout(8000);
  const result=await page.evaluate(()=>{const c=window.__bench.calls,g=window.__bench.gaps.sort((a,b)=>a-b),d=window.quantumPersonFollower.diagnostics;return {calls:c.length,meanMs:c.reduce((s,r)=>s+r.ms,0)/c.length,maxGapMs:Math.max(...g),p95GapMs:g[Math.floor(g.length*.95)],last:c.at(-1),bodyFrameAgeMs:d.frameAgeMs,bodyFrameIntervalMs:d.frameIntervalMs};});
  await page.evaluate(()=>{clearInterval(window.__tick);return window.quantumCameraController.stop();});
  console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
