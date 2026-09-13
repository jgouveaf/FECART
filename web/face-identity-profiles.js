(() => {
  'use strict';
  const HUMAN='human-faceres-3.3.6', ONNX='scrfd-sface-2021dec-v1';
  const DEFAULT_ENGINE = ONNX;
  const profiles={
    [HUMAN]:{engine:HUMAN,length:1024,field:'embeddings',threshold:.80,ambiguityMargin:.05,continuationThreshold:.77,referenceThreshold:.90},
    [ONNX]:{engine:ONNX,length:128,field:'sfaceEmbeddings',threshold:.50,ambiguityMargin:.10,continuationThreshold:.45,referenceThreshold:.80},
  };
  function profile(engine) { return profiles[engine] || profiles[DEFAULT_ENGINE]; }
  function valid(vector,engine) {
    return Array.isArray(vector) && vector.length===profile(engine).length && vector.every(Number.isFinite) && Math.hypot(...vector)>1e-8;
  }
  function samples(record,engine) {
    return (Array.isArray(record?.[profile(engine).field]) ? record[profile(engine).field] : []).filter(v=>valid(v,engine)).slice(-15);
  }
  function engineFor(record) {
    if (samples(record,ONNX).length>=3) return ONNX;
    if (samples(record,HUMAN).length) return HUMAN;
    return ONNX;
  }
  const api=Object.freeze({HUMAN,ONNX,DEFAULT_ENGINE,profile,valid,samples,engineFor});
  if (typeof window!=='undefined') window.QuantumFaceProfiles=api;
  if (typeof module!=='undefined' && module.exports) module.exports=api;
})();
