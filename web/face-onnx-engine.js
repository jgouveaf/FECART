/* Local-only inference; this module has no access to the USB controller. */
(() => {
  'use strict';
  async function verifiedModel(base,path,hash) {
    const response=await fetch(new URL(path,base),{cache:'force-cache'});
    if(!response.ok) throw Error(`Modelo facial indisponível: HTTP ${response.status}.`);
    const bytes=await response.arrayBuffer();
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    if(digest!==hash) throw Error('Integridade do modelo facial não confere. Atualize a página e tente novamente.');
    return new Uint8Array(bytes);
  }
  class FaceONNXEngine {
    async load(base) {
      ort.env.wasm.numThreads=1; // GitHub Pages does not enable cross-origin isolation.
      ort.env.wasm.wasmPaths={mjs:new URL('vendor/onnxruntime/ort-wasm-simd-threaded.js',base).href,
        wasm:new URL('vendor/onnxruntime/ort-wasm-simd-threaded.wasm',base).href};
      ort.env.logLevel='fatal';
      const options={executionProviders:['wasm'],graphOptimizationLevel:'all'};
      const detector=await verifiedModel(base,'vendor/face-onnx/scrfd_500m.onnx','320057e8223314633f76f8083025021c0d7540eff9a32fd31b70da9d0feaa97f');
      this.detector=await ort.InferenceSession.create(detector,options);
      const recognizer=await verifiedModel(base,'vendor/face-onnx/sface_2021dec.onnx','ae6a6ac44d2bdc87924e75fb23d8212430dd24f037f5e035c21deff99afc8b61');
      this.recognizer=await ort.InferenceSession.create(recognizer,options);
      this.detectorCanvas=new OffscreenCanvas(320,320);
      const {FilesetResolver,FaceLandmarker}=await import(new URL('vendor/mediapipe/vision_bundle.js',base).href);
      const files=await FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm',base).href);
      const mesh=await verifiedModel(base,'vendor/mediapipe/models/face_landmarker.task','64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff');
      this.mesh=await FaceLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetBuffer:mesh,delegate:'CPU'},
        runningMode:'IMAGE',numFaces:3,minFaceDetectionConfidence:.45,minFacePresenceConfidence:.45,
        outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false,
      });
    }
    async detect(bitmap, onIdentity = null, options = {}) {
      const started=performance.now(), {width,height}=bitmap;
      if (!this.surface || this.surface.width!==width || this.surface.height!==height) this.surface=new OffscreenCanvas(width,height);
      const ctx=this.surface.getContext('2d',{willReadFrequently:true}); ctx.drawImage(bitmap,0,0);
      const pixels=ctx.getImageData(0,0,width,height);
      const scale=320/Math.max(width,height), dctx=this.detectorCanvas.getContext('2d',{willReadFrequently:true});
      dctx.fillStyle='black';dctx.fillRect(0,0,320,320);
      dctx.drawImage(bitmap,0,0,Math.round(width*scale),Math.round(height*scale));
      const data=dctx.getImageData(0,0,320,320).data, input=new Float32Array(3*320*320);
      for (let i=0;i<320*320;i++) for (let c=0;c<3;c++) input[c*320*320+i]=(data[i*4+c]-127.5)/128;
      const tensor=new ort.Tensor('float32',input,[1,3,320,320]);
      const output=await this.detector.run({[this.detector.inputNames[0]]:tensor});
      let faces;
      try { faces=QuantumFaceONNXMath.decode(this.detector.outputNames.map(name=>output[name]),width,height,scale); }
      finally { tensor.dispose(); Object.values(output).forEach(t=>t.dispose()); }
      const detected=performance.now();
      if(!onIdentity || !options.allowDescriptorReuse || faces.length!==1) this.descriptorCache=null;
      // Keep detections of additional people, but bound expensive descriptions.
      for (const face of faces.slice(0,3)) {
        const aligned=QuantumFaceONNXMath.alignedRGB(pixels,face.keypoints);
        const cached=this.descriptorCache,age=cached?detected-cached.at:Infinity;
        const reuse=onIdentity && options.allowDescriptorReuse && faces.length===1 && face.faceScore>=.58
          && age>=0 && age<=450 && QuantumFaceONNXMath.overlap(face.box,cached.box)>=.65
          && QuantumFaceONNXMath.sameAlignedFace(aligned,cached.pixels);
        if(reuse) {
          face.embedding=cached.embedding.slice();face.embeddingReused=true;face.embeddingAgeMs=age;
        } else {
          this.descriptorCache=null;
          const sample=new ort.Tensor('float32',aligned,[1,3,112,112]);
          let result;
          try {
            result=await this.recognizer.run({[this.recognizer.inputNames[0]]:sample});
            face.embedding=QuantumFaceONNXMath.normalized(result[this.recognizer.outputNames[0]].data) || [];
          } finally { sample.dispose();if(result) Object.values(result).forEach(t=>t.dispose()); }
          if(onIdentity && faces.length===1 && face.embedding.length===128) this.descriptorCache={
            pixels:aligned,embedding:face.embedding.slice(),box:face.box.slice(),at:started};
        }
        const [left,right,nose]=face.keypoints;
        const eyeDistance=Math.hypot(right[0]-left[0],right[1]-left[1]);
        face.rotation={angle:{yaw:eyeDistance>1 ? (nose[0]-(left[0]+right[0])/2)/eyeDistance : 1,
          pitch:0,roll:Math.atan2(right[1]-left[1],right[0]-left[0])}};
        face.engine=QuantumFaceONNXMath.ENGINE;
      }
      const recognized=performance.now();
      // Heavy identity frames have priority over decorative mesh inference.
      // A fast position frame can refresh the full mesh on the next turn.
      const meshDue=!onIdentity || recognized-started<=120
        && (this.lastMeshAt == null || recognized-this.lastMeshAt >= 450);
      // Identity is control evidence; the mesh is display work. Let tracking
      // consume the measured identity before spending time drawing landmarks.
      onIdentity?.({face:faces,gesture:[],engine:QuantumFaceONNXMath.ENGINE,backend:'onnx-wasm',
        performance:{total:recognized-started,detectionMs:detected-started,recognitionMs:recognized-detected}});
      if (faces.length && meshDue) {
        this.lastMeshAt=recognized;
        const meshes=this.mesh.detect(bitmap).faceLandmarks.map(points=>{
          const mesh=points.map(p=>[p.x*width,p.y*height,p.z*width]);
          const xs=mesh.map(p=>p[0]),ys=mesh.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys);
          return {mesh,box:[x,y,Math.max(...xs)-x,Math.max(...ys)-y]};
        });
        // Mesh is visual geometry only. Its presence never authorizes movement.
        for (const face of faces) {
          const best=meshes.map(m=>({...m,iou:QuantumFaceONNXMath.overlap(face.box,m.box)})).sort((a,b)=>b.iou-a.iou)[0];
          if (best?.iou>.25) face.mesh=best.mesh;
        }
      }
      return {face:faces,gesture:[],meshUpdated:meshDue,engine:QuantumFaceONNXMath.ENGINE,backend:'onnx-wasm',performance:{total:performance.now()-started,
        detectionMs:detected-started,recognitionMs:recognized-detected,meshMs:performance.now()-recognized}};
    }
  }
  self.QuantumFaceONNXEngine=FaceONNXEngine;
})();
