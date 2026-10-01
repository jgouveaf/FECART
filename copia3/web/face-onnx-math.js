/* SCRFD decoding and SFace alignment. Coordinates are never mirrored here. */
(() => {
  'use strict';
  const ENGINE = 'scrfd-sface-2021dec-v1';
  const TEMPLATE = [[38.2946,51.6963],[73.5318,51.5014],[56.0252,71.7366],[41.5493,92.3655],[70.7299,92.2041]];
  function overlap(a, b) {
    const intersection = Math.max(0, Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0])) *
      Math.max(0, Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));
    return intersection / Math.max(1e-9, a[2]*a[3]+b[2]*b[3]-intersection);
  }
  function decode(outputs, width, height, scale, threshold = .5) {
    if (outputs.length !== 9 || !Number.isFinite(scale) || scale <= 0) throw Error('Saída SCRFD inválida.');
    const found = [];
    for (let layer = 0; layer < 3; layer++) {
      const stride = [8,16,32][layer], columns = 320 / stride;
      const scores = outputs[layer].data, boxes = outputs[layer+3].data, points = outputs[layer+6].data;
      if (scores.length !== columns*columns*2 || boxes.length !== scores.length*4 || points.length !== scores.length*10) throw Error('Dimensões SCRFD inválidas.');
      for (let i = 0; i < scores.length; i++) {
        if (!Number.isFinite(scores[i]) || scores[i] < threshold) continue;
        const cell = Math.floor(i/2), x = (cell % columns)*stride, y = Math.floor(cell/columns)*stride;
        const x1 = Math.max(0,(x-boxes[i*4]*stride)/scale), y1 = Math.max(0,(y-boxes[i*4+1]*stride)/scale);
        const x2 = Math.min(width,(x+boxes[i*4+2]*stride)/scale), y2 = Math.min(height,(y+boxes[i*4+3]*stride)/scale);
        const box = [x1,y1,x2-x1,y2-y1];
        const keypoints = Array.from({length:5}, (_,j) => [(x+points[i*10+j*2]*stride)/scale,(y+points[i*10+j*2+1]*stride)/scale]);
        if (box.every(Number.isFinite) && box[2] >= 20 && box[3] >= 20 && keypoints.flat().every(Number.isFinite)) found.push({box,keypoints,faceScore:scores[i]});
      }
    }
    found.sort((a,b)=>b.faceScore-a.faceScore);
    const selected = [];
    for (const face of found) if (selected.every(other=>overlap(face.box,other.box)<.4)) selected.push(face);
    return selected;
  }
  function alignment(points, template = TEMPLATE) {
    if (points?.length !== 5 || !points.flat().every(Number.isFinite)) throw Error('Pontos faciais inválidos.');
    const mean = values => values.reduce((sum,p)=>[sum[0]+p[0]/5,sum[1]+p[1]/5],[0,0]);
    const src = mean(points), dst = mean(template);
    let dot = 0, cross = 0, variance = 0;
    for (let i=0;i<5;i++) {
      const x=points[i][0]-src[0], y=points[i][1]-src[1], u=template[i][0]-dst[0], v=template[i][1]-dst[1];
      dot+=x*u+y*v; cross+=x*v-y*u; variance+=x*x+y*y;
    }
    if (variance < 1e-6) throw Error('Rosto sem geometria válida.');
    const a=dot/variance,b=cross/variance,tx=dst[0]-a*src[0]+b*src[1],ty=dst[1]-b*src[0]-a*src[1];
    if (a*a+b*b < 1e-8) throw Error('Alinhamento facial inválido.');
    return {a,b,tx,ty};
  }
  function alignedRGB(pixels, points) {
    const {a,b,tx,ty}=alignment(points), determinant=a*a+b*b;
    const {data,width,height}=pixels, result=new Float32Array(3*112*112);
    for (let y=0;y<112;y++) for (let x=0;x<112;x++) {
      const sx=(a*(x-tx)+b*(y-ty))/determinant, sy=(-b*(x-tx)+a*(y-ty))/determinant;
      const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
      for (let c=0;c<3;c++) {
        let value=0;
        for (let dy=0;dy<2;dy++) for (let dx=0;dx<2;dx++) {
          const xx=ix+dx,yy=iy+dy;
          if (xx>=0 && yy>=0 && xx<width && yy<height) value+=data[(yy*width+xx)*4+c]*(dx?fx:1-fx)*(dy?fy:1-fy);
        }
        // SFace contains normalization in the graph and expects RGB 0..255.
        result[c*112*112+y*112+x]=value;
      }
    }
    return result;
  }
  function projectMesh(mesh, previousPoints, currentPoints) {
    if(!Array.isArray(mesh)||mesh.length<468||!mesh.every(p=>p.length>=3&&p.every(Number.isFinite))) return null;
    try {
      const {a,b,tx,ty}=alignment(previousPoints,currentPoints),scale=Math.hypot(a,b);
      if(scale<.5||scale>2) return null;
      return mesh.map(([x,y,z])=>[a*x-b*y+tx,b*x+a*y+ty,z*scale]);
    } catch { return null; }
  }
  function sameAlignedFace(current, reference) {
    // Small, fixed photometric gate. Compare against the last actual SFace
    // input, never against another reused frame (which would allow drift).
    if(current?.length!==3*112*112 || reference?.length!==current.length) return false;
    let absolute=0,squared=0,count=0;
    for(let c=0;c<3;c++) for(let y=20;y<92;y+=2) for(let x=24;x<88;x+=2) {
      const i=c*112*112+y*112+x,d=current[i]-reference[i];
      if(!Number.isFinite(d)) return false;
      absolute+=Math.abs(d);squared+=d*d;count++;
    }
    return absolute/count<=3 && squared/count<=36;
  }
  function normalized(values, length = 128) {
    if (values?.length !== length || !Array.from(values).every(Number.isFinite)) return null;
    const norm=Math.hypot(...values);
    return norm>1e-8 ? Array.from(values,v=>v/norm) : null;
  }
  function cosine(a,b) {
    const left=normalized(a),right=normalized(b);
    return left && right ? Math.max(-1,Math.min(1,left.reduce((s,v,i)=>s+v*right[i],0))) : -1;
  }
  const api=Object.freeze({ENGINE,TEMPLATE,overlap,decode,alignment,alignedRGB,projectMesh,sameAlignedFace,normalized,cosine});
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  if (typeof self!=='undefined') self.QuantumFaceONNXMath=api;
})();
