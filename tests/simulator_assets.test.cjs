'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=path.join(__dirname,'../web/assets/models');
test('bundled models are intact self-contained glTF 2 files',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
 for(const [name,entry] of Object.entries(manifest.files)) {
  const bytes=fs.readFileSync(path.join(dir,name));
  assert.equal(bytes.length,entry.bytes,name);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256,name);
  if(!name.endsWith('.glb'))continue;
  assert.equal(bytes.toString('ascii',0,4),'glTF');assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
  const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
  for(const resource of [...json.buffers,...(json.images||[])])assert.equal(resource.uri,undefined,'external resource in '+name);
 }
});
test('walking animation has finite normalized rotations and no horizontal root drift',async()=>{
 const T=await import('../web/vendor/three/three.module.min.js');
 const bytes=fs.readFileSync(path.join(dir,'person-mixamo.glb'));
 const model=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
 const parents=new Map();model.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parents.set(c,i)));
 function worldMatrix(index) {
  if(index===undefined)return new T.Matrix4();
  const n=model.nodes[index],local=n.matrix?new T.Matrix4().fromArray(n.matrix):new T.Matrix4().compose(
   new T.Vector3().fromArray(n.translation||[0,0,0]),new T.Quaternion().fromArray(n.rotation||[0,0,0,1]),new T.Vector3().fromArray(n.scale||[1,1,1]));
  return worldMatrix(parents.get(index)).multiply(local);
 }
 const {clips}=JSON.parse(fs.readFileSync(path.join(dir,'person-motion.json')));
 assert.deepEqual(clips.map(c=>c.name),['Idle','Walk']);
 for(const clip of clips) {
  assert.ok(clip.duration>0);
  for(const track of clip.tracks) {
   assert.ok(track.values.every(Number.isFinite));assert.ok(track.times.every(Number.isFinite));
   const size=track.type==='quaternion'?4:3;
   assert.equal(track.values.length,track.times.length*size);
   for(let i=0;i<track.values.length;i+=size) {
    if(size===4)assert.ok(Math.abs(Math.hypot(...track.values.slice(i,i+4))-1)<.001);
    else {
     const boneName=track.name.replace(/\.position$/,'');
     const bone=model.nodes.findIndex(n=>(n.name||'').replace(':','')===boneName);assert.ok(bone>=0);
     const parent=worldMatrix(parents.get(bone));
     const origin=new T.Vector3().fromArray(track.values).applyMatrix4(parent);
     const current=new T.Vector3().fromArray(track.values,i).applyMatrix4(parent);
     assert.ok(Math.abs(current.x-origin.x)<.0001);assert.ok(Math.abs(current.z-origin.z)<.0001);
    }
   }
  }
 }
});
