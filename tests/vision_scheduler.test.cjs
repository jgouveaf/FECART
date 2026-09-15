'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {InferenceScheduler}=require('../web/vision-scheduler.js');
test('inference slots are fair and an old release cannot overlap a newer task',async()=>{
  const queue=new InferenceScheduler(),order=[];
  const first=await queue.acquire();
  const body=queue.acquire().then(release=>{order.push('body');return release;});
  const face=queue.acquire().then(release=>{order.push('face');return release;});
  await Promise.resolve();assert.deepEqual(order,[]);
  first();const releaseBody=await body;assert.deepEqual(order,['body']);
  first();await Promise.resolve();assert.deepEqual(order,['body']);
  releaseBody();(await face)();assert.deepEqual(order,['body','face']);assert.equal(queue.active,false);
});
