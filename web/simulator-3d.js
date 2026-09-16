/* Rendering only: world decisions never leave the virtual simulator. */
(() => {
  'use strict';
  const assetBase=new URL('./assets/models/',document.currentScript.src);
  async function create(container,world) {
    const [T,{GLTFLoader},{clone:cloneSkeleton},{RoomEnvironment}]=await Promise.all([
      import('./vendor/three/three.module.min.js'),
      import('./vendor/three/GLTFLoader.js'),
      import('./vendor/three/SkeletonUtils.js'),
      import('./vendor/three/RoomEnvironment.js')
    ]);
    const renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
    renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.15;
    const canvas=renderer.domElement;canvas.className='simulation-webgl';
    canvas.setAttribute('aria-label','Mundo tridimensional do Quantum Tracker');
    container.prepend(canvas);
    const scene=new T.Scene();scene.background=new T.Color(0xc9dde3);scene.fog=new T.Fog(0xc9dde3,18,35);
    const environment=new RoomEnvironment(),pmrem=new T.PMREMGenerator(renderer);
    const environmentMap=pmrem.fromScene(environment,.04);
    scene.environment=environmentMap.texture;scene.environmentIntensity=.65;
    environment.dispose();pmrem.dispose();
    let disposed=false;
    // Commit the imported scene and its matching collision footprints together.
    const builtInEnvironment=new T.Group(),officeEnvironment=new T.Group();
    scene.add(builtInEnvironment,officeEnvironment);
    const assetLoader=new GLTFLoader();
    const humanPromises=new Map();
    const humanResources=new T.Group();humanResources.visible=false;scene.add(humanResources);
    const camera=new T.PerspectiveCamera(68,1,.035,60);
    const roomWidth=world.width/100,roomDepth=world.height/100;
    const hemi=new T.HemisphereLight(0xdff5ff,0x5c6265,1.3);scene.add(hemi);
    const sun=new T.DirectionalLight(0xffedd5,2.3);sun.position.set(4,8,5);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-9,right:9,top:9,bottom:-9,near:.5,far:22});
    sun.shadow.bias=-.0003;sun.shadow.normalBias=.015;sun.target.position.set(6,0,4);scene.add(sun,sun.target);
    const fill=new T.DirectionalLight(0xc3dfff,1.05);fill.position.set(-3,3,-4);scene.add(fill);
    const practical=new T.PointLight(0x86d9ff,5.5,8,2);practical.position.set(5.8,2.8,3.8);scene.add(practical);
    const mat=(color,roughness=.65,metalness=0)=>new T.MeshStandardMaterial({color,roughness,metalness});
    const materials={wall:new T.MeshStandardMaterial({color:0xe9ede8,roughness:.78,side:T.DoubleSide}),ceiling:mat(0xf4f2eb,.84),metal:mat(0x64727a,.27,.74),dark:mat(0x203039,.38,.42),wood:mat(0xb98550,.58,.05),
      black:mat(0x12191d,.82,.08),orange:mat(0xf0a44a,.38,.08),white:mat(0xf7f4e9,.28,.06),blue:mat(0x267b9a,.34,.25),green:mat(0x2e7254,.78)};
    const mesh=(geometry,material,parent=builtInEnvironment)=>{const m=new T.Mesh(geometry,material);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
    const box=(x,y,z,w,h,d,material,parent=builtInEnvironment)=>{const m=mesh(new T.BoxGeometry(w,h,d),material,parent);m.position.set(x,y,z);return m;};
    const sphere=(x,y,z,sx,sy,sz,material,parent=builtInEnvironment)=>{const m=mesh(new T.SphereGeometry(1,16,12),material,parent);m.scale.set(sx,sy,sz);m.position.set(x,y,z);return m;};
    function label(text,color='#eaf0ef',background='#253c48',width=512,height=128) {
      const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');
      ctx.fillStyle=background;ctx.fillRect(0,0,width,height);ctx.fillStyle=color;ctx.font=`600 ${height*.34}px system-ui`;
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,width/2,height/2,width*.93);
      const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;return texture;
    }
    // Deterministic floor texture: no download or random scenario generation.
    const tile=document.createElement('canvas');tile.width=512;tile.height=512;const tx=tile.getContext('2d');
    const floorGradient=tx.createLinearGradient(0,0,512,512);floorGradient.addColorStop(0,'#d2d0c5');floorGradient.addColorStop(1,'#a9afa9');tx.fillStyle=floorGradient;tx.fillRect(0,0,512,512);
    for(let i=0;i<11000;i++) {const x=(i*137)%512,y=(i*79+Math.floor(i/512)*37)%512;
      tx.fillStyle=i%2?'rgba(255,255,255,.08)':'rgba(48,57,55,.06)';tx.fillRect(x,y,2,2);}
    tx.strokeStyle='rgba(74,83,83,.35)';tx.lineWidth=3;tx.strokeRect(1,1,510,510);
    tx.strokeStyle='rgba(255,255,255,.18)';tx.lineWidth=1;for(let i=0;i<=512;i+=64){tx.beginPath();tx.moveTo(i,0);tx.lineTo(i,512);tx.moveTo(0,i);tx.lineTo(512,i);tx.stroke();}
    const floorTexture=new T.CanvasTexture(tile);floorTexture.wrapS=floorTexture.wrapT=T.RepeatWrapping;
    floorTexture.repeat.set(roomWidth/1.2,roomDepth/1.14);floorTexture.colorSpace=T.SRGBColorSpace;
    const floor=mesh(new T.PlaneGeometry(roomWidth,roomDepth),new T.MeshStandardMaterial({map:floorTexture,roughness:.72,metalness:.05}));
    floor.rotation.x=-Math.PI/2;floor.position.set(roomWidth/2,-.005,roomDepth/2);floor.castShadow=false;floor.name='office-floor';
    box(roomWidth/2,-.11,roomDepth/2,roomWidth+.3,.2,roomDepth+.3,materials.dark);
    box(roomWidth/2,1.7,-.08,roomWidth+.2,3.4,.16,materials.wall);
    box(-.08,1.7,roomDepth/2,.16,3.4,roomDepth,materials.wall);
    box(roomWidth/2,.13,.04,roomWidth,.26,.06,materials.dark);box(.04,.13,roomDepth/2,.06,.26,roomDepth,materials.dark);
    // All four walls and the ceiling match the world boundaries. Both camera
    // views remain inside this shell, including at maximum zoom/elevation.
    box(roomWidth+.06,.45,roomDepth/2,.12,.9,roomDepth,materials.wall);
    const glass=new T.MeshPhysicalMaterial({color:0xadcdd4,roughness:.1,metalness:.1,transparent:true,opacity:.18,depthWrite:false});
    for(let z=.65;z<roomDepth-.6;z+=1.3) {box(roomWidth,2,z,.035,2.2,1.2,glass).castShadow=false;box(roomWidth,2,z-.64,.1,2.6,.06,materials.dark);}
    box(roomWidth,3.25,roomDepth/2,.15,.16,roomDepth,materials.dark);
    for(let x=1;x<roomWidth;x+=2.5) {box(x,3.4,roomDepth/2,.08,.13,roomDepth,materials.metal);box(x,3.3,roomDepth/2,.12,.03,1.2,new T.MeshStandardMaterial({color:0xffffff,emissive:0xf1f7ff,emissiveIntensity:2}));}
    const rightWall=box(roomWidth+.08,1.7,roomDepth/2,.16,3.4,roomDepth+.2,materials.wall,scene);rightWall.castShadow=false;
    const frontWall=box(roomWidth/2,1.7,roomDepth+.08,roomWidth+.3,3.4,.16,materials.wall,scene);frontWall.castShadow=false;
    const ceiling=box(roomWidth/2,3.48,roomDepth/2,roomWidth+.3,.08,roomDepth+.3,materials.ceiling,scene);ceiling.castShadow=false;ceiling.receiveShadow=false;ceiling.name='office-ceiling';
    // The downloaded lobby supplies furniture; retain the room shell and floor.
    for(const object of [...builtInEnvironment.children]) scene.add(object);
    const sign=mesh(new T.PlaneGeometry(3.3,.75),new T.MeshBasicMaterial({map:label('QUANTUM  /  LAB 01')}));sign.position.set(5.7,2.5,.015);sign.castShadow=false;
    const smallSign=mesh(new T.PlaneGeometry(1.4,.28),new T.MeshBasicMaterial({map:label('ÁREA DE ROBÓTICA','#283e45','#e9d1a0')}));smallSign.position.set(1.5,1.9,.016);
    for(const z of [3.6,4.65]) box(6,.004,z,10,.006,.025,materials.orange).castShadow=false;
    for(let x=.8;x<11.5;x+=.7) box(x,.004,7.35,.36,.006,.04,materials.white).castShadow=false;
    // Lab details add depth without changing the fixed collision geometry.
    const accent=new T.MeshStandardMaterial({color:0x68cbe0,emissive:0x174b5b,emissiveIntensity:.45,roughness:.3,metalness:.28});
    for(let z=.9;z<3.5;z+=.78) {box(.2,.9,z,.22,1.5,.56,materials.dark);box(.32,1.35,z,.035,.018,.43,accent);}
    box(10.75,1.05,6.95,.85,1.9,.22,materials.dark);for(let y=.42;y<1.82;y+=.42) box(10.75,y,6.82,.7,.018,.05,materials.metal);
    const door=box(9.45,1.2,.025,1.05,2.35,.035,materials.dark);door.castShadow=false;box(9.82,1.2,.048,.02,2.2,.025,materials.metal).castShadow=false;
    assetLoader.load(new URL('office-lobby.glb',assetBase).href,gltf=>{
      const office=gltf.scene;
      if(disposed){disposeTree(office);return;}
      office.scale.setScalar(.9);office.position.set(6.075,0,4.32);
      const retainedFurniture=/^(000|001|002)-/;
      office.traverse(object=>{
        if(/^\d{3}-/.test(object.name)&&!retainedFurniture.test(object.name)) object.visible=false;
        if(!object.isMesh)return;
        object.castShadow=true;object.receiveShadow=true;
        const mats=Array.isArray(object.material)?object.material:[object.material];
        mats.forEach(material=>{if(material) material.envMapIntensity=1.1;});
      });
      office.updateMatrixWorld(true);
      const obstacles=[];
      // Furniture group footprints are conservative, including chair/table
      // overhangs. Rugs and ceiling fixtures do not obstruct the flat floor.
      office.traverse(object=>{
        if(!object.visible||!/^\d{3}-/.test(object.name)||object.isMesh)return;
        const bounds=new T.Box3().setFromObject(object);
        if(bounds.min.y>.1||bounds.max.y<.05)return;
        obstacles.push({x:bounds.min.x*100,y:bounds.min.z*100,w:(bounds.max.x-bounds.min.x)*100,
          h:(bounds.max.z-bounds.min.z)*100,height:bounds.max.y*100,kind:object.name});
      });
      if(!world.setEnvironment('office',obstacles)){disposeTree(office);return;}
      officeEnvironment.add(office);
      builtInEnvironment.visible=false;
      container.dataset.environment='office';
      const status=document.getElementById('simGraphicsStatus');if(status)status.textContent='Laboratório Quantum · pista de testes';
    },undefined,()=>{
      if(disposed)return;
      // Keep the existing procedural room as an offline/failure fallback.
      const status=document.getElementById('simGraphicsStatus');if(status)status.textContent='Laboratório · cenário local';
    });
    // Shared lab furnishings remain present with either the downloaded office
    // or the fallback room. Their footprint is also used by the virtual sensor.
    const lab=new T.Group();lab.name='technology-lab';scene.add(lab);
    const cyan=new T.MeshStandardMaterial({color:0x52d9ee,emissive:0x159ab8,emissiveIntensity:1.2,roughness:.35});
    const violet=new T.MeshStandardMaterial({color:0x9983ff,emissive:0x5845b8,emissiveIntensity:.8});
    for(const o of world.labObstacles) {
      const x=(o.x+o.w/2)/100,z=(o.y+o.h/2)/100,w=o.w/100,d=o.h/100;
      if(o.kind==='workstation') {
        box(x,.83,z,w,.08,d,materials.dark,lab);
        for(const dx of [-w/2+.08,w/2-.08])box(x+dx,.4,z,.08,.8,d-.12,materials.metal,lab);
        box(x,1.12,z-.17,.08,.55,.08,materials.metal,lab);
        box(x,1.36,z-.17,1.15,.58,.06,materials.black,lab);
        const screen=mesh(new T.PlaneGeometry(1.04,.46),new T.MeshBasicMaterial({map:label('QUANTUM  /  ONLINE','#70ecff','#102536')}),lab);
        screen.position.set(x,1.36,z-.13);
        box(x,.89,z+.19,.5,.025,.18,materials.black,lab);
        box(x,.78,z+d/2+.005,w-.12,.025,.02,cyan,lab);
      } else if(o.kind==='server') {
        box(x,1.1,z,w,2.2,d,materials.dark,lab);
        for(let y=.28;y<2.1;y+=.22) {
          box(x,y,z+d/2+.005,w-.1,.13,.02,materials.black,lab);
          box(x-w*.3,y,z+d/2+.02,.025,.035,.02,cyan,lab);
        }
      }
    }
    for(const ramp of world.ramps) {
      const run=ramp.run/100,width=ramp.w/100,rise=ramp.rise/100,depth=ramp.h/100;
      const shape=new T.Shape();shape.moveTo(0,0);shape.lineTo(width,0);shape.lineTo(width-run,rise);shape.lineTo(run,rise);shape.closePath();
      const deck=mesh(new T.ExtrudeGeometry(shape,{depth,bevelEnabled:false}),materials.metal,lab);
      deck.name='traversable-ramp';deck.position.set(ramp.x/100,.002,ramp.y/100);
      for(const z of [(ramp.y-5)/100,(ramp.y+ramp.h+5)/100]) {
        for(let x=ramp.x;x<=ramp.x+ramp.w;x+=100)box(x/100,.37,z,.04,.74,.08,materials.dark,lab);
        box((ramp.x+ramp.w/2)/100,.75,z,width,.035,.09,cyan,lab);
      }
      for(const end of [ramp.x-45,ramp.x+ramp.w+45]) {
        const marker=mesh(new T.PlaneGeometry(.5,depth),new T.MeshBasicMaterial({color:0x48cbdc}),lab);
        marker.rotation.x=-Math.PI/2;marker.position.set(end/100,.007,(ramp.y+ramp.h/2)/100);
      }
    }
    // Wall strips and room signage are above the drivable floor.
    box(roomWidth/2,2.8,.012,roomWidth-.4,.035,.03,cyan,lab);
    box(.012,2.8,roomDepth/2,.03,.035,roomDepth-.4,violet,lab);
    box(roomWidth-.012,2.8,roomDepth/2,.03,.035,roomDepth-.4,cyan,lab);
    box(8.3,.008,3.6,15,.012,.035,cyan,lab);
    const dashboard=mesh(new T.PlaneGeometry(3.8,1.25),new T.MeshBasicMaterial({map:label('01 AUTO   /   02 SEGUIR   /   03 GESTOS','#7df2ff','#102333',1024,256)}),lab);
    dashboard.rotation.y=-Math.PI/2;dashboard.position.set(roomWidth-.014,1.85,4.4);
    const labSign=mesh(new T.PlaneGeometry(4,.65),new T.MeshBasicMaterial({map:label('QUANTUM  /  ROBOTICS LAB','#75ecff','#172934')}),lab);
    labSign.position.set(11.4,2.32,.02);
    const rampSign=mesh(new T.PlaneGeometry(3,.42),new T.MeshBasicMaterial({map:label('02  /  PISTA DE TESTES','#93ecff','#172934')}),lab);
    rampSign.rotation.y=-Math.PI/2;rampSign.position.set(roomWidth-.012,2.3,7.4);
    // Fixed fallback obstacles use the same bounds as collision and sensor logic.
    for(const o of world.obstacles.filter(o=>!['workstation','server','ramp-rail'].includes(o.kind))) {
      const x=(o.x+o.w/2)/100,z=(o.y+o.h/2)/100,w=o.w/100,d=o.h/100,h=o.height/100;
      if(o.kind==='bench') {
        box(x,h,z,w,.075,d,materials.wood);
        for(const dx of [-w/2+.09,w/2-.09]) for(const dz of [-d/2+.09,d/2-.09]) box(x+dx,h/2,z+dz,.055,h,.055,materials.metal);
        box(x,h+.04,z,.34,.02,.25,materials.blue);
        box(x,h+.24,z-d*.27,.06,.37,.45,materials.dark);
        box(x+.04,h+.24,z-d*.27,.01,.29,.36,new T.MeshStandardMaterial({color:0x4aa7bd,emissive:0x1b5665,emissiveIntensity:.7}));
        box(x+.15,h+.07,z+.4,.27,.12,.3,materials.orange);
      } else if(o.kind==='cabinet') {
        box(x,h/2,z,w,h,d,materials.dark);
        for(let dx=-w/2+.29;dx<w/2;dx+=.56) {box(x+dx,h/2,z+d/2+.01,.51,h-.1,.025,materials.metal);box(x+dx+.16,h*.6,z+d/2+.045,.018,.17,.025,materials.black);}
      } else {
        box(x,h/2,z,w,h,d,materials.wall);box(x,h+.015,z,w-.08,.025,d-.08,materials.dark);
        for(let i=0;i<7;i++) sphere(x-w*.4+i*w*.13,h+.2+(i%2)*.1,z,.2,.28,.22,materials.green);
      }
      for(const dz of [-d/2-.04,d/2+.04]) box(x,.005,z+dz,w+.08,.006,.035,materials.orange).castShadow=false;
    }
    const collisionMarker=new T.Group();scene.add(collisionMarker);collisionMarker.visible=false;
    const collisionRing=mesh(new T.RingGeometry(.18,.25,40),new T.MeshBasicMaterial({color:0xff4f63,side:T.DoubleSide,transparent:true,opacity:.9}),collisionMarker);collisionRing.rotation.x=-Math.PI/2;collisionRing.castShadow=false;
    const collisionLight=new T.PointLight(0xff5267,0,2);collisionMarker.add(collisionLight);
    // Detailed two-wheel chassis, board, battery and forward ultrasonic sensor.
    const robot=new T.Group();robot.name='virtual-robot';scene.add(robot);
    box(0,.095,0,.32,.035,.265,materials.orange,robot);
    box(-.005,.13,0,.22,.018,.19,materials.dark,robot);
    box(.015,.15,-.035,.085,.009,.06,materials.blue,robot);
    for(let i=0;i<8;i++) box(-.016+i*.009,.159,-.003,.003,.009,.009,materials.metal,robot);
    box(.02,.16,-.04,.025,.01,.028,materials.black,robot);
    for(const z of [.042,.075]) {const battery=mesh(new T.CylinderGeometry(.014,.014,.09,16),materials.green,robot);battery.rotation.z=Math.PI/2;battery.position.set(-.035,.156,z);}
    box(.157,.153,0,.012,.059,.115,materials.blue,robot);
    for(const z of [-.032,.032]) {const sensor=mesh(new T.CylinderGeometry(.022,.022,.018,24),materials.metal,robot);sensor.rotation.z=Math.PI/2;sensor.position.set(.17,.161,z);
      const dark=mesh(new T.CylinderGeometry(.017,.017,.001,24),materials.black,robot);dark.rotation.z=Math.PI/2;dark.position.set(.18,.161,z);}
    const wheels=[];
    for(const z of [-.15,.15]) {
      const wheel=new T.Group();wheel.position.set(0,.074,z);robot.add(wheel);
      const tire=mesh(new T.CylinderGeometry(.074,.074,.044,28),materials.black,wheel);tire.rotation.x=Math.PI/2;
      const hub=mesh(new T.CylinderGeometry(.039,.039,.049,20),materials.orange,wheel);hub.rotation.x=Math.PI/2;
      for(let a=0;a<16;a++) {const t=a*Math.PI/8,track=box(Math.sin(t)*.073,Math.cos(t)*.073,0,.022,.009,.048,materials.dark,wheel);track.rotation.z=-t;}
      wheels.push(wheel);
    }
    sphere(-.12,.034,0,.03,.03,.03,materials.metal,robot);
    function loadHuman(gender) {
      const kind=gender==='male'?'male':'female';
      if(humanPromises.has(kind))return humanPromises.get(kind);
      const modelUrl=new URL(kind==='male'?'person-male-mixamo.glb':'person-mixamo.glb',assetBase).href;
      const promise=(async()=>{
        for(let attempt=0;attempt<3;attempt++) {
          if(disposed)return null;
          let gltf;
          try {
            gltf=await assetLoader.loadAsync(modelUrl);
            if(kind==='female') {
              const response=await fetch(new URL('person-motion.json',assetBase));
              if(!response.ok)throw Error('Animações indisponíveis');
              const motion=await response.json();gltf.animations=motion.clips.map(clip=>T.AnimationClip.parse(clip));
            }
            if(disposed){disposeTree(gltf.scene);return null;}
            if(!['Idle','Walk'].every(name=>gltf.animations.some(clip=>clip.name===name)))throw Error('Animações incompletas');
            humanResources.add(gltf.scene);return gltf;
          } catch(error) {
            if(gltf)disposeTree(gltf.scene);
            if(attempt===2){humanPromises.delete(kind);throw error;}
            await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
          }
        }
      })();
      humanPromises.set(kind,promise);return promise;
    }
    function makePerson(p) {
      const skinTone=p.id==='p2'?0x8a5b45:p.id==='p3'?0xc58d69:0xe1b18d;
      const hairTone=p.id==='p2'?0x17110f:p.id==='p3'?0x633d27:0x30241f;
      const group=new T.Group(),legacy=new T.Group(),shirt=mat(p.color,.7,.04),pants=mat(0x293945,.86,.05),skin=mat(skinTone,.78),hair=mat(hairTone,.9);scene.add(group);group.add(legacy);
      const torso=mesh(new T.CylinderGeometry(.205,.15,.44,20),shirt,legacy);torso.scale.z=.6;torso.position.y=1.15;
      sphere(0,.87,0,.17,.13,.12,pants,legacy);
      const limbs=[];
      for(const side of [-1,1]) {
        const leg=new T.Group();leg.position.set(side*.1,.87,0);legacy.add(leg);limbs.push(leg);
        const thigh=mesh(new T.CapsuleGeometry(.065,.29,4,10),pants,leg);thigh.position.y=-.19;
        const shin=mesh(new T.CapsuleGeometry(.052,.28,4,10),pants,leg);shin.position.y=-.54;
        box(0,-.765,.045,.12,.075,.24,materials.dark,leg);
        const arm=new T.Group();arm.position.set(side*.23,1.33,0);legacy.add(arm);limbs.push(arm);
        const sleeve=mesh(new T.CapsuleGeometry(.067,.16,4,10),shirt,arm);sleeve.position.y=-.11;
        const forearm=mesh(new T.CapsuleGeometry(.046,.2,4,10),skin,arm);forearm.position.set(side*.015,-.34,.015);
        sphere(side*.015,-.49,.018,.045,.07,.035,skin,arm);
      }
      sphere(0,1.48,0,.058,.08,.057,skin,legacy);sphere(0,1.64,0,.106,.143,.1,skin,legacy);
      sphere(0,1.72,-.015,.109,.079,.098,hair,legacy);
      sphere(0,1.64,.101,.023,.031,.027,skin,legacy);
      for(const side of [-1,1]) sphere(side*.041,1.675,.089,.012,.009,.009,materials.dark,legacy);
      const badge=new T.Sprite(new T.SpriteMaterial({map:label(p.name,'#fff','#29474c',256,80),depthTest:true}));badge.position.set(0,1.99,0);badge.scale.set(.65,.2,1);group.add(badge);
      const ring=mesh(new T.RingGeometry(.24,.27,40),new T.MeshBasicMaterial({color:0x32e4b0,side:T.DoubleSide,transparent:true,opacity:.9}),group);
      ring.rotation.x=-Math.PI/2;ring.position.y=.006;ring.castShadow=false;
      const avatar={group,legacy,limbs,ring,mixer:null,actions:null,motion:'',x:p.x,y:p.y};
      // Each person gets its own armature; therefore the independent walk and
      // idle animations never share bones or state.
      const gender=p.gender==='male'?'male':'female';
      loadHuman(gender).then(gltf=>{
        if(disposed||!gltf)return;
        const character=cloneSkeleton(gltf.scene);
        const mixer=new T.AnimationMixer(character);
        const idle=mixer.clipAction(gltf.animations.find(clip=>clip.name==='Idle'));
        idle.play();mixer.update(0);
        // Evaluate the bind hierarchy before measuring skinned vertices.
        character.updateMatrixWorld(true);
        character.traverse(object=>{if(object.isSkinnedMesh){object.skeleton.update();object.computeBoundingBox();}});
        const bounds=new T.Box3().setFromObject(character);
        const scale=1.75/(bounds.max.y-bounds.min.y);
        character.scale.multiplyScalar(scale);character.position.y=-bounds.min.y*scale;
        if(gender==='male') character.rotation.y=Math.PI;
        character.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}});
        character.name='person-model-'+gender;
        group.add(character);legacy.visible=false;
        avatar.mixer=mixer;
        avatar.actions={
          walk:avatar.mixer.clipAction(gltf.animations.find(animation=>/walk/i.test(animation.name))||gltf.animations[0]),
          idle
        };
        avatar.actions.idle.play();avatar.motion='idle';
        container.dataset.peopleModel='mixamo';
        container.dataset.peopleGenders=[...new Set([...avatars.values()].filter(item=>item.mixer).map(item=>item.gender))].sort().join(',');
      }).catch(()=>{if(!disposed)group.userData.assetFailed=true;});
      avatar.gender=gender;
      return avatar;
    }
    const avatars=new Map();let view='third',orbit=0,elevation=.5,zoom=2.8,drag=null,healthy=true,lastFrame=0;
    const desired=new T.Vector3(),look=new T.Vector3(),lastLook=new T.Vector3();let cameraReady=false;
    function size() {const {width,height}=container.getBoundingClientRect();renderer.setSize(width,height,false);camera.aspect=width/Math.max(height,1);camera.updateProjectionMatrix();}
    const resize=new ResizeObserver(size);resize.observe(container);size();
    canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(!drag)return;orbit-=(e.clientX-drag.x)*.006;elevation=clamp(elevation+(e.clientY-drag.y)*.005,.2,1.4);drag={x:e.clientX,y:e.clientY};canvas.dispatchEvent(new Event('viewinput',{bubbles:true}));});
    const end=()=>{drag=null;};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
    canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=clamp(zoom+e.deltaY*.003,1.2,6);canvas.dispatchEvent(new Event('viewinput',{bubbles:true}));},{passive:false});
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();healthy=false;container.classList.remove('has-3d');container.dataset.view='map';document.getElementById('simGraphicsStatus').textContent='Visão superior · recuperando gráficos';});
    canvas.addEventListener('webglcontextrestored',()=>{healthy=true;container.classList.add('has-3d');container.dataset.view=view;cameraReady=false;document.getElementById('simGraphicsStatus').textContent=world.environmentId==='office'?'Recepção 3D · cenário realista':'Laboratório · cenário fixo';canvas.dispatchEvent(new Event('viewinput',{bubbles:true}));});
    container.classList.add('has-3d');container.dataset.view='third';
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    return {
      get ready(){return healthy&&!disposed;},
      setView(value){view=value==='first'?'first':'third';orbit=0;cameraReady=false;camera.fov=view==='first'?78:68;camera.updateProjectionMatrix();container.dataset.view=view;},
      render(time,force=false){
        if(disposed||!healthy||!force&&time-lastFrame<1000/30) return;
        const dt=lastFrame?Math.min((time-lastFrame)/1000,.1):0;lastFrame=time;
        const r=world.robot,ground=world.groundPose(r.x,r.y,r.angle),groundY=ground.height/100;
        robot.position.set(r.x/100,groundY,r.y/100);robot.rotation.order='YXZ';robot.rotation.set(0,-r.angle,ground.pitch);
        wheels[0].rotation.z-=r.left/100*dt/.074;wheels[1].rotation.z-=r.right/100*dt/.074;
        for(const avatar of avatars.values()) avatar.group.visible=false;
        for(const p of world.people) {
          if(!avatars.has(p.id)) avatars.set(p.id,makePerson(p));
          const avatar=avatars.get(p.id);avatar.group.visible=world.peopleVisible;avatar.group.position.set(p.x/100,world.groundHeight(p.x,p.y)/100,p.y/100);avatar.group.rotation.y=Math.PI/2-p.angle;
          avatar.ring.visible=p.id===world.targetId;
          const stride=world.peopleMoving?Math.sin(world.time*p.speed/9)*.28:0;
          avatar.limbs[0].rotation.x=stride;avatar.limbs[2].rotation.x=-stride;avatar.limbs[1].rotation.x=-stride*.7;avatar.limbs[3].rotation.x=stride*.7;
          if(avatar.mixer) {
            const motion=Math.hypot(p.x-avatar.x,p.y-avatar.y)>.001?'walk':'idle';
            if(avatar.motion!==motion) {avatar.actions[avatar.motion].fadeOut(.16);avatar.actions[motion].reset().fadeIn(.16).play();avatar.motion=motion;}
            avatar.mixer.update(dt*(motion==='walk'?Math.max(.2,p.speed/140):1));
          }
          avatar.x=p.x;avatar.y=p.y;
        }
        const impact=world.lastCollision;
        collisionMarker.visible=Boolean(impact);
        if(impact) {collisionMarker.position.set(impact.x/100,world.groundHeight(impact.x,impact.y)/100+.012,impact.y/100);const pulse=.92+.12*Math.sin(time*.018);collisionRing.scale.setScalar(pulse);collisionRing.material.opacity=.55+.3*Math.sin(time*.018);collisionLight.intensity=1.5;}
        const a=r.angle+orbit,x=r.x/100,z=r.y/100;
        if(view==='first') {desired.set(x+Math.cos(r.angle)*.12,.28,z+Math.sin(r.angle)*.12);look.set(desired.x+Math.cos(a)*3,1.45+(elevation-.5),desired.z+Math.sin(a)*3);}
        else {desired.set(x-Math.cos(a)*zoom,zoom*elevation+.6,z-Math.sin(a)*zoom);look.set(x+.3*Math.cos(r.angle),.85,z+.3*Math.sin(r.angle));}
        desired.y+=groundY;look.y+=groundY;
        desired.x=clamp(desired.x,.12,roomWidth-.12);desired.z=clamp(desired.z,.12,roomDepth-.12);
        if(view==='third') desired.y=Math.min(3.05,Math.hypot(desired.x-x,desired.z-z)*elevation+.6+groundY);
        if(!cameraReady||view==='first') {camera.position.copy(desired);lastLook.copy(look);cameraReady=true;}
        else {const ease=1-Math.exp(-dt*9);camera.position.lerp(desired,ease);lastLook.lerp(look,ease);}
        camera.lookAt(lastLook);renderer.render(scene,camera);
      },
      dispose(){if(disposed)return;disposed=true;resize.disconnect();for(const avatar of avatars.values())avatar.mixer?.stopAllAction();disposeTree(scene);environmentMap.dispose();renderer.dispose();canvas.remove();}
    };
  }
  function disposeTree(root){const resources=new Set();root.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.skeleton)resources.add(o.skeleton);
    for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){for(const value of Object.values(m))if(value?.isTexture)resources.add(value);resources.add(m);}});
    resources.forEach(r=>r.dispose());}
  window.QuantumSimulator3D=Object.freeze({create});
})();
