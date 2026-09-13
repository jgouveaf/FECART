importScripts('./vendor/onnxruntime/ort.wasm.min.js', './face-onnx-math.js?v=1', './face-onnx-engine.js?v=2');
let engine=null,busy=false;
self.onmessage=async ({data})=>{
  if (busy) { data.bitmap?.close(); self.postMessage({id:data.id,error:'Leitura facial já em andamento.'}); return; }
  busy=true;
  try {
    if (data.type==='init') {
      engine=new QuantumFaceONNXEngine(); await engine.load(self.location.href);
      self.postMessage({id:data.id,type:'ready'});
    } else if (data.type==='frame') {
      if (!engine) throw Error('Detector facial não está pronto.');
      const identityFirst=data.config?.identityFirst === true;
      const result=await engine.detect(data.bitmap,identityFirst
        ? result=>self.postMessage({id:data.id,type:'result',result}) : null);
      if (identityFirst && result.meshUpdated) self.postMessage({id:data.id,type:'mesh',faces:result.face.map(face=>({mesh:face.mesh}))});
      else if (!identityFirst) self.postMessage({id:data.id,type:'result',result});
    }
  } catch (error) { self.postMessage({id:data.id,error:error.message || String(error)}); }
  finally { data.bitmap?.close(); busy=false; }
};
