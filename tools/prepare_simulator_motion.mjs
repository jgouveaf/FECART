// Offline only. Adapt Mixamo locomotion to the Michelle skeleton in world space.
// Usage: node tools/prepare_simulator_motion.mjs SOURCE.glb TARGET.glb OUTPUT.json
import fs from 'node:fs';
import * as T from '../web/vendor/three/three.module.min.js';
import { GLTFLoader } from '../web/vendor/three/GLTFLoader.js';
globalThis.ProgressEvent ??= class { constructor(type,values){Object.assign(this,{type},values);} };
async function loadGeometry(path) {
  const bytes=fs.readFileSync(path),jsonLength=bytes.readUInt32LE(12);
  const json=JSON.parse(bytes.subarray(20,20+jsonLength));
  const binary=bytes.subarray(28+jsonLength);
  json.buffers[0].uri='data:application/octet-stream;base64,'+binary.toString('base64');
  // Conversion needs bones only; no image decode or GPU is required.
  json.materials=(json.materials||[]).map(()=>({pbrMetallicRoughness:{metallicFactor:0}}));
  delete json.images;delete json.textures;
  return new GLTFLoader().parseAsync(json,'');
}
const [sourcePath,targetPath,outputPath]=process.argv.slice(2);
if(!outputPath)throw Error('Expected source GLB, target GLB and output JSON paths');
const source=await loadGeometry(sourcePath),target=await loadGeometry(targetPath);
// Soldier faces -Z while Michelle faces +Z; align their world-space bases.
source.scene.rotation.y=Math.PI;
// Some exported files open in a dance pose. Both reference skeletons must
// be sampled in their named T-pose before computing animation deltas.
for(const model of [source,target]) {
  const pose=model.animations.find(clip=>/tpose/i.test(clip.name));
  if(!pose)throw Error('Reference T-pose is missing');
  const referenceMixer=new T.AnimationMixer(model.scene);
  referenceMixer.clipAction(pose).play();referenceMixer.update(0);
}
source.scene.updateMatrixWorld(true);target.scene.updateMatrixWorld(true);
const bones=[];target.scene.traverse(b=>{if(b.isBone)bones.push(b);});
const bind=new Map(bones.map(b=>[b.name,{position:b.position.clone(),rotation:b.quaternion.clone(),world:b.getWorldQuaternion(new T.Quaternion())}]));
const sourceBones=new Map();source.scene.traverse(b=>{if(b.isBone)sourceBones.set(b.name,{bone:b,world:b.getWorldQuaternion(new T.Quaternion())});});
const hip=bones.find(b=>/Hips$/.test(b.name)),sourceHip=sourceBones.get(hip.name).bone;
const sourceHipOrigin=sourceHip.getWorldPosition(new T.Vector3());
const heightRatio=hip.getWorldPosition(new T.Vector3()).y/sourceHipOrigin.y;
const mixer=new T.AnimationMixer(source.scene),clips=[];
for(const name of ['Idle','Walk']) {
  const clip=source.animations.find(c=>c.name===name);if(!clip)throw Error('Missing '+name);
  const action=mixer.clipAction(clip);mixer.stopAllAction();action.reset().play();
  const count=Math.ceil(clip.duration*30),times=[],values=new Map(bones.map(b=>[b.name,[]])),positions=[];
  for(let frame=0;frame<=count;frame++) {
    const time=frame*clip.duration/count;times.push(time);mixer.setTime(time);source.scene.updateMatrixWorld(true);
    for(const bone of bones) {
      const rest=bind.get(bone.name),entry=sourceBones.get(bone.name);
      bone.position.copy(rest.position);bone.quaternion.copy(rest.rotation);
      if(entry) {
        const world=entry.bone.getWorldQuaternion(new T.Quaternion()).multiply(entry.world.clone().invert()).multiply(rest.world);
        bone.quaternion.copy(bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(world));
      }
      if(bone===hip) {
        const bob=(sourceHip.getWorldPosition(new T.Vector3()).y-sourceHipOrigin.y)*heightRatio;
        const origin=bone.parent.localToWorld(rest.position.clone());origin.y+=bob;
        bone.position.copy(bone.parent.worldToLocal(origin));positions.push(...bone.position.toArray());
      }
      bone.updateMatrixWorld(true);values.get(bone.name).push(...bone.quaternion.toArray());
    }
  }
  const tracks=bones.map(b=>new T.QuaternionKeyframeTrack(b.name+'.quaternion',times,values.get(b.name)));
  tracks.push(new T.VectorKeyframeTrack(hip.name+'.position',times,positions));
  clips.push(T.AnimationClip.toJSON(new T.AnimationClip(name,clip.duration,tracks)));
}
fs.writeFileSync(outputPath,JSON.stringify({source:'Three.js r180 Soldier / Mixamo',target:'Three.js r180 Michelle / Mixamo',clips}));
console.log('Prepared Idle and Walk:',outputPath);
