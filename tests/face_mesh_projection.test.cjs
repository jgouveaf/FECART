'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {projectMesh}=require('../web/face-onnx-math.js'),{restore}=require('../web/face-processing.js');
test('visual mesh follows measured landmarks without altering descriptors or timestamps',()=>{
  const points=[[0,0],[10,0],[5,5],[1,10],[9,10]],mesh=Array.from({length:468},()=>[3,4,-2]);
  const next=points.map(([x,y])=>[2*x+20,2*y+30]),copy=structuredClone(mesh);
  const projected=projectMesh(mesh,points,next);assert.deepEqual(projected[0],[26,38,-4]);assert.deepEqual(mesh,copy);
  const restored=restore({box:[1,1,10,10],keypoints:points,embedding:[1],capturedAt:100},2,2);
  assert.deepEqual(restored.keypoints[1],[20,0]);assert.equal(restored.capturedAt,100);assert.deepEqual(restored.embedding,[1]);
});
test('missing or degenerate geometry does not fabricate a mesh',()=>{
  const mesh=Array.from({length:468},()=>[3,4,-2]),points=[[0,0],[10,0],[5,5],[1,10],[9,10]];
  assert.equal(projectMesh(mesh,null,points),null);assert.equal(projectMesh([],points,points),null);
  assert.equal(projectMesh(mesh,points,points.map(([x,y])=>[x*10,y*10])),null);
});
