/* Rendering only: world decisions never leave the virtual simulator. */
(() => {
  'use strict';
  async function create(container,world) {
    const T=await import('./vendor/three/three.module.min.js');
    const renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
    renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.15;
    const canvas=renderer.domElement;canvas.className='simulation-webgl';
    canvas.setAttribute('aria-label','Mundo tridimensional do Quantum Tracker');
    container.prepend(canvas);
    const scene=new T.Scene();scene.background=new T.Color(0xd5e1e5);scene.fog=new T.Fog(0xd5e1e5,17,33);
    const camera=new T.PerspectiveCamera(68,1,.035,60);
    const hemi=new T.HemisphereLight(0xd4efff,0x7b766c,2.25);scene.add(hemi);
    const sun=new T.DirectionalLight(0xffedd5,3.2);sun.position.set(4,8,5);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-9,right:9,top:9,bottom:-9,near:.5,far:22});
    sun.shadow.bias=-.0003;sun.shadow.normalBias=.015;sun.target.position.set(6,0,4);scene.add(sun,sun.target);
    const fill=new T.DirectionalLight(0xc3dfff,.8);fill.position.set(-3,3,-4);scene.add(fill);
    const mat=(color,roughness=.65,metalness=0)=>new T.MeshStandardMaterial({color,roughness,metalness});
    const materials={wall:mat(0xe5e5dd),metal:mat(0x5d6a71,.3,.7),dark:mat(0x25343d,.45,.3),wood:mat(0xb68a54,.65),
      black:mat(0x171d20,.9),orange:mat(0xe89d42,.5),white:mat(0xf1eee5,.4),blue:mat(0x237295,.4,.2),green:mat(0x346b50,.9)};
    const mesh=(geometry,material,parent=scene)=>{const m=new T.Mesh(geometry,material);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
    const box=(x,y,z,w,h,d,material,parent=scene)=>{const m=mesh(new T.BoxGeometry(w,h,d),material,parent);m.position.set(x,y,z);return m;};
    const sphere=(x,y,z,sx,sy,sz,material,parent=scene)=>{const m=mesh(new T.SphereGeometry(1,16,12),material,parent);m.scale.set(sx,sy,sz);m.position.set(x,y,z);return m;};
    function label(text,color='#eaf0ef',background='#253c48',width=512,height=128) {
      const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');
      ctx.fillStyle=background;ctx.fillRect(0,0,width,height);ctx.fillStyle=color;ctx.font=`600 ${height*.34}px system-ui`;
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,width/2,height/2,width*.93);
      const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;return texture;
    }
    // Deterministic concrete texture: no download or random scenario generation.
    const tile=document.createElement('canvas');tile.width=512;tile.height=512;const tx=tile.getContext('2d');
    tx.fillStyle='#b9b9b0';tx.fillRect(0,0,512,512);
    for(let i=0;i<11000;i++) {const x=(i*137)%512,y=(i*79+Math.floor(i/512)*37)%512;
      tx.fillStyle=i%2?'rgba(255,255,255,.08)':'rgba(48,57,55,.06)';tx.fillRect(x,y,2,2);}
    tx.strokeStyle='#939a94';tx.lineWidth=3;tx.strokeRect(1,1,510,510);
    const floorTexture=new T.CanvasTexture(tile);floorTexture.wrapS=floorTexture.wrapT=T.RepeatWrapping;
    floorTexture.repeat.set(10,7);floorTexture.colorSpace=T.SRGBColorSpace;
    const floor=mesh(new T.PlaneGeometry(12,8),new T.MeshStandardMaterial({map:floorTexture,roughness:.72,metalness:.05}));
    floor.rotation.x=-Math.PI/2;floor.position.set(6,-.005,4);floor.castShadow=false;
    box(6,-.11,4,12.3,.2,8.3,materials.dark);
    box(6,1.7,-.08,12.2,3.4,.16,materials.wall);
    box(-.08,1.7,4,.16,3.4,8,materials.wall);
    box(6,.13,.04,12,.26,.06,materials.dark);box(.04,.13,4,.06,.26,8,materials.dark);
    // Windowed east wall keeps a clear view in third person.
    box(12.06,.45,4,.12,.9,8,materials.wall);
    const glass=new T.MeshPhysicalMaterial({color:0xadcdd4,roughness:.1,metalness:.1,transparent:true,opacity:.18,depthWrite:false});
    for(let z=.65;z<8;z+=1.3) {box(12,2,z,.035,2.2,1.2,glass).castShadow=false;box(12,2,z-.64,.1,2.6,.06,materials.dark);}
    box(12,3.25,4,.15,.16,8,materials.dark);
    for(let x=1;x<12;x+=2.5) {box(x,3.4,4,.08,.13,8,materials.metal);box(x,3.3,3.5,.12,.03,1.2,new T.MeshStandardMaterial({color:0xffffff,emissive:0xf1f7ff,emissiveIntensity:2}));}
    const sign=mesh(new T.PlaneGeometry(3.3,.75),new T.MeshBasicMaterial({map:label('QUANTUM  /  LAB 01')}));sign.position.set(5.7,2.5,.015);sign.castShadow=false;
    const smallSign=mesh(new T.PlaneGeometry(1.4,.28),new T.MeshBasicMaterial({map:label('ÁREA DE ROBÓTICA','#283e45','#e9d1a0')}));smallSign.position.set(1.5,1.9,.016);
    for(const z of [3.6,4.65]) box(6,.004,z,10,.006,.025,materials.orange).castShadow=false;
    for(let x=.8;x<11.5;x+=.7) box(x,.004,7.35,.36,.006,.04,materials.white).castShadow=false;
    // Fixed obstacles use exactly the same bounds as collision and sensor logic.
    for(const o of world.obstacles) {
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
    // Detailed two-wheel chassis, board, battery and forward ultrasonic sensor.
    const robot=new T.Group();scene.add(robot);
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
    function makePerson(p) {
      const group=new T.Group(),shirt=mat(p.color,.88),pants=mat(0x33424c,.95),skin=mat(0xc69575,.82);scene.add(group);
      const torso=mesh(new T.CylinderGeometry(.205,.15,.44,20),shirt,group);torso.scale.z=.6;torso.position.y=1.15;
      sphere(0,.87,0,.17,.13,.12,pants,group);
      const limbs=[];
      for(const side of [-1,1]) {
        const leg=new T.Group();leg.position.set(side*.1,.87,0);group.add(leg);limbs.push(leg);
        const thigh=mesh(new T.CapsuleGeometry(.065,.29,4,10),pants,leg);thigh.position.y=-.19;
        const shin=mesh(new T.CapsuleGeometry(.052,.28,4,10),pants,leg);shin.position.y=-.54;
        box(0,-.765,.045,.12,.075,.24,materials.dark,leg);
        const arm=new T.Group();arm.position.set(side*.23,1.33,0);group.add(arm);limbs.push(arm);
        const sleeve=mesh(new T.CapsuleGeometry(.067,.16,4,10),shirt,arm);sleeve.position.y=-.11;
        const forearm=mesh(new T.CapsuleGeometry(.046,.2,4,10),skin,arm);forearm.position.set(side*.015,-.34,.015);
        sphere(side*.015,-.49,.018,.045,.07,.035,skin,arm);
      }
      sphere(0,1.48,0,.058,.08,.057,skin,group);sphere(0,1.64,0,.106,.143,.1,skin,group);
      sphere(0,1.72,-.015,.109,.079,.098,materials.dark,group);
      sphere(0,1.64,.101,.023,.031,.027,skin,group);
      for(const side of [-1,1]) sphere(side*.041,1.675,.089,.012,.009,.009,materials.dark,group);
      const badge=new T.Sprite(new T.SpriteMaterial({map:label(p.name,'#fff','#29474c',256,80),depthTest:true}));badge.position.set(0,1.99,0);badge.scale.set(.65,.2,1);group.add(badge);
      const ring=mesh(new T.RingGeometry(.24,.27,40),new T.MeshBasicMaterial({color:0x1dc69b,side:T.DoubleSide,transparent:true,opacity:.85}),group);
      ring.rotation.x=-Math.PI/2;ring.position.y=.006;ring.castShadow=false;
      return {group,limbs,ring};
    }
    const avatars=new Map();let view='third',orbit=0,elevation=.5,zoom=2.8,drag=null,disposed=false,healthy=true,lastFrame=0;
    const desired=new T.Vector3(),look=new T.Vector3(),lastLook=new T.Vector3();let cameraReady=false;
    function size() {const {width,height}=container.getBoundingClientRect();renderer.setSize(width,height,false);camera.aspect=width/Math.max(height,1);camera.updateProjectionMatrix();}
    const resize=new ResizeObserver(size);resize.observe(container);size();
    canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(!drag)return;orbit-=(e.clientX-drag.x)*.006;elevation=clamp(elevation+(e.clientY-drag.y)*.005,.2,1.4);drag={x:e.clientX,y:e.clientY};canvas.dispatchEvent(new Event('viewinput',{bubbles:true}));});
    const end=()=>{drag=null;};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
    canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=clamp(zoom+e.deltaY*.003,1.2,6);canvas.dispatchEvent(new Event('viewinput',{bubbles:true}));},{passive:false});
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();healthy=false;container.classList.remove('has-3d');container.dataset.view='map';document.getElementById('simGraphicsStatus').textContent='Visão superior · recuperando gráficos';});
    canvas.addEventListener('webglcontextrestored',()=>{healthy=true;container.classList.add('has-3d');container.dataset.view=view;cameraReady=false;document.getElementById('simGraphicsStatus').textContent='Laboratório · cenário fixo';canvas.dispatchEvent(new Event('viewinput',{bubbles:true}));});
    container.classList.add('has-3d');container.dataset.view='third';
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    return {
      get ready(){return healthy&&!disposed;},
      setView(value){view=value==='first'?'first':'third';orbit=0;cameraReady=false;camera.fov=view==='first'?78:68;camera.updateProjectionMatrix();container.dataset.view=view;},
      render(time,force=false){
        if(disposed||!healthy||!force&&time-lastFrame<1000/30) return;
        const dt=lastFrame?Math.min((time-lastFrame)/1000,.1):0;lastFrame=time;
        const r=world.robot;robot.position.set(r.x/100,0,r.y/100);robot.rotation.y=-r.angle;
        wheels[0].rotation.z-=r.left/100*dt/.074;wheels[1].rotation.z-=r.right/100*dt/.074;
        for(const avatar of avatars.values()) avatar.group.visible=false;
        for(const p of world.people) {
          if(!avatars.has(p.id)) avatars.set(p.id,makePerson(p));
          const avatar=avatars.get(p.id);avatar.group.visible=world.peopleVisible;avatar.group.position.set(p.x/100,0,p.y/100);avatar.group.rotation.y=Math.PI/2-p.angle;
          avatar.ring.visible=p.id===world.targetId;
          const stride=world.peopleMoving?Math.sin(world.time*p.speed/9)*.28:0;
          avatar.limbs[0].rotation.x=stride;avatar.limbs[2].rotation.x=-stride;avatar.limbs[1].rotation.x=-stride*.7;avatar.limbs[3].rotation.x=stride*.7;
        }
        const a=r.angle+orbit,x=r.x/100,z=r.y/100;
        if(view==='first') {desired.set(x+Math.cos(r.angle)*.12,.28,z+Math.sin(r.angle)*.12);look.set(desired.x+Math.cos(a)*3,1.45+(elevation-.5),desired.z+Math.sin(a)*3);}
        else {desired.set(x-Math.cos(a)*zoom,zoom*elevation+.6,z-Math.sin(a)*zoom);look.set(x+.3*Math.cos(r.angle),.85,z+.3*Math.sin(r.angle));}
        desired.x=clamp(desired.x,.12,11.88);desired.z=clamp(desired.z,.12,7.88);
        if(view==='third') desired.y=Math.hypot(desired.x-x,desired.z-z)*elevation+.6;
        if(!cameraReady||view==='first') {camera.position.copy(desired);lastLook.copy(look);cameraReady=true;}
        else {const ease=1-Math.exp(-dt*9);camera.position.lerp(desired,ease);lastLook.lerp(look,ease);}
        camera.lookAt(lastLook);renderer.render(scene,camera);
      },
      dispose(){if(disposed)return;disposed=true;resize.disconnect();const resources=new Set();scene.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]) {if(m.map)resources.add(m.map);resources.add(m);}});resources.forEach(r=>r.dispose());renderer.dispose();canvas.remove();}
    };
  }
  window.QuantumSimulator3D=Object.freeze({create});
})();
