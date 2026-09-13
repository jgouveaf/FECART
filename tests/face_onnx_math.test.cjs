'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const m=require('../web/face-onnx-math.js'),profiles=require('../web/face-identity-profiles.js'),identity=require('../web/face-identity-math.js');
test('alignment recovers translation, scale and rotation without mirroring',()=>{
  for (const angle of [-.3,0,.3]) for (const scale of [.5,1,2]) {
    const a=scale*Math.cos(angle),b=scale*Math.sin(angle),tx=80,ty=40;
    const points=m.TEMPLATE.map(([x,y])=>[a*x-b*y+tx,b*x+a*y+ty]);
    const transform=m.alignment(points);
    points.forEach(([x,y],i)=>{
      assert.ok(Math.abs(transform.a*x-transform.b*y+transform.tx-m.TEMPLATE[i][0])<1e-8);
      assert.ok(Math.abs(transform.b*x+transform.a*y+transform.ty-m.TEMPLATE[i][1])<1e-8);
    });
  }
});
test('invalid geometry and malformed model outputs fail before recognition',()=>{
  assert.throws(()=>m.alignment(Array(5).fill([0,0])),/geometria/);
  assert.throws(()=>m.alignment(Array(5).fill([NaN,0])),/inválidos/);
  assert.throws(()=>m.decode([],640,360,.5),/inválida/);
  assert.equal(m.normalized(Array(128).fill(0)),null);
  assert.equal(m.cosine(Array(1024).fill(1),Array(128).fill(1)),-1);
});
test('NMS removes duplicate boxes but preserves extra people without embeddings',()=>{
  const layers=[8,16,32].map(s=>320/s*320/s*2),scores=layers.map(n=>new Float32Array(n)),boxes=layers.map(n=>new Float32Array(n*4)),kps=layers.map(n=>new Float32Array(n*10));
  for (const i of [410,411,430,1210,1230]) {
    scores[0][i]=.9;boxes[0].set([2,2,2,2],i*4);
  }
  const result=m.decode([...scores,...boxes,...kps].map(data=>({data})),640,360,.5);
  assert.equal(result.length,4);
});
test('SFace and Human galleries remain separate during imports and updates',()=>{
  const h=Array(1024).fill(1),s=Array(128).fill(1);
  const old={embeddings:[h,h,h]},newer={...old,sfaceEmbeddings:[s,s,s]};
  assert.equal(profiles.engineFor(old),profiles.HUMAN);
  assert.equal(profiles.engineFor(newer),profiles.ONNX);
  assert.equal(profiles.samples({embeddings:[s]},profiles.HUMAN).length,0);
  assert.equal(identity.mergeSamples([],Array(5).fill(s),15,128).length,5);
  assert.equal(identity.mergeSamples(Array(5).fill(s),Array(5).fill(s),15,128).length,5);
});
test('SFace decisions reject insufficient, weak and ambiguous evidence',()=>{
  const cfg=profiles.profile(profiles.ONNX), candidate=scores=>({identity:{id:'A'},scores});
  assert.equal(identity.chooseIdentity([candidate([.9,.9])],cfg).accepted,false);
  assert.equal(identity.chooseIdentity([candidate([.49,.49,.49])],cfg).accepted,false);
  assert.equal(identity.chooseIdentity([candidate([.9,.9,.9]),{identity:{id:'B'},scores:[.85,.85,.85]}],cfg).reason,'AMBIGUOUS');
  assert.equal(identity.chooseIdentity([candidate([.8,.85,.9])],cfg).identity.id,'A');
});
