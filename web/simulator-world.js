/* Deterministic virtual world. Centimetres, seconds, differential drive.
   This module has no camera, Serial API, DOM events or physical robot access. */
(() => {
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const wrap=v=>Math.atan2(Math.sin(v),Math.cos(v));
  const NAMES={PARAR:'PARADO',FRENTE:'AVANÇANDO',TRAS:'RECUANDO',DIREITA:'CURVA À DIREITA',ESQUERDA:'CURVA À ESQUERDA',GIRAR:'GIRANDO'};
  function rayBox(x,y,dx,dy,box,max=400) {
    let near=0,far=max;
    for(const [p,d,low,high] of [[x,dx,box.x,box.x+box.w],[y,dy,box.y,box.y+box.h]]) {
      if(Math.abs(d)<1e-9) { if(p<low||p>high) return max; continue; }
      let a=(low-p)/d,b=(high-p)/d;
      if(a>b) [a,b]=[b,a]; near=Math.max(near,a);far=Math.min(far,b);
      if(near>far) return max;
    }
    return near;
  }
  class World {
    constructor() {
      this.width=1200; this.height=800;
      this.obstacles=[{x:350,y:130,w:95,h:195,height:92,kind:'bench'},
        {x:640,y:80,w:230,h:80,height:125,kind:'cabinet'},
        {x:730,y:520,w:100,h:170,height:95,kind:'bench'},
        {x:160,y:630,w:210,h:65,height:50,kind:'planter'}];
      this.reset();
    }
    reset() {
      this.robot={x:130,y:410,angle:0,speed:38,radius:17,left:0,right:0,avoidance:null};
      this.people=[{id:'p1',name:'Ana',x:280,y:410,angle:0,speed:25,color:0xe8864c,
        route:[[280,410],[570,410],[570,625],[445,625],[445,410]],leg:1},
        {id:'p2',name:'Lucas',x:970,y:240,angle:Math.PI/2,speed:29,color:0x45859b,
          route:[[970,240],[970,635],[1040,635],[1040,240]],leg:1}];
      this.targetId='p1'; this.peopleVisible=true;this.peopleMoving=true;
      this.running=true;this.events=0;this.collisions=0;this.lastCollision=null;this.time=0;this.lastTime=0;
      this.resetControl();
      this.output={command:'PARAR',state:'PRONTO',distance:400,safety:'MONITORANDO',targetVisible:false};
    }
    resetControl() { this.robot.avoidance=null;this.reverseAllowed=true;this.turnRight=true;this.sensorAt=-Infinity;
      this.near=0;this.clear=0;this.confirming=false;this.distance=400;this.followDistanceHeld=false; }
    selectPerson(id) { if(this.people.some(p=>p.id===id)) this.targetId=id; }
    addPerson() {
      this.peopleVisible=true;
      if(this.people.length>=5) return false;
      const i=this.people.length;
      this.people.push({id:`p${i+1}`,name:`Visitante ${i-1}`,x:1040-i*65,y:400,angle:0,speed:20+i,
        color:[0x758b61,0x806fa9,0xd2b567][i-2],route:[[1040-i*65,400],[1040-i*65,710]],leg:1});
      return true;
    }
    personBlocked(x,y,radius=19) {
      if(x<radius||y<radius||x>this.width-radius||y>this.height-radius) return true;
      return this.obstacles.some(o=>Math.hypot(x-clamp(x,o.x,o.x+o.w),y-clamp(y,o.y,o.y+o.h))<radius);
    }
    advancePeople(dt) {
      if(!this.peopleVisible||!this.peopleMoving) return;
      for(const p of this.people) {
        const to=p.route[p.leg],dx=to[0]-p.x,dy=to[1]-p.y,length=Math.hypot(dx,dy),travel=p.speed*dt;
        p.angle=Math.atan2(dy,dx);
        const next=length<=travel?{x:to[0],y:to[1]}:{x:p.x+dx/length*travel,y:p.y+dy/length*travel};
        // People belong to the same fixed laboratory as the robot: their
        // route advances rather than letting an avatar walk through furniture.
        if(this.personBlocked(next.x,next.y)) { p.leg=(p.leg+1)%p.route.length; continue; }
        p.x=next.x;p.y=next.y;
        if(length<=travel) p.leg=(p.leg+1)%p.route.length;
      }
    }
    ray(angle,ignorePerson=null,max=400,origin=this.robot) {
      const dx=Math.cos(angle),dy=Math.sin(angle),x=origin.x,y=origin.y;
      let result=max;
      if(dx>1e-9) result=Math.min(result,(this.width-x)/dx);
      if(dx< -1e-9) result=Math.min(result,-x/dx);
      if(dy>1e-9) result=Math.min(result,(this.height-y)/dy);
      if(dy< -1e-9) result=Math.min(result,-y/dy);
      for(const box of this.obstacles) result=Math.min(result,rayBox(x,y,dx,dy,box,max));
      if(this.peopleVisible) for(const p of this.people) {
        if(p.id===ignorePerson) continue;
        const px=p.x-x,py=p.y-y,along=px*dx+py*dy,across=px*dy-py*dx;
        if(along>=0 && Math.abs(across)<=18) result=Math.min(result,Math.max(0,along-Math.sqrt(18*18-across*across)));
      }
      return clamp(result,0,max);
    }
    sensor() {
      const r=this.robot,origin={x:r.x+Math.cos(r.angle)*r.radius,y:r.y+Math.sin(r.angle)*r.radius};
      return Math.min(...[-.12,0,.12].map(offset=>this.ray(r.angle+offset,null,400,origin)));
    }
    visibleTarget() {
      const p=this.peopleVisible&&this.people.find(p=>p.id===this.targetId);
      if(!p) return null;
      const dx=p.x-this.robot.x,dy=p.y-this.robot.y,distance=Math.hypot(dx,dy),angle=Math.atan2(dy,dx);
      const bearing=wrap(angle-this.robot.angle);
      if(distance>500||Math.abs(bearing)>Math.PI/3||this.ray(angle,p.id,distance)<distance-20) return null;
      return {person:p,distance,bearing};
    }
    collisionAt(x,y) {
      const radius=this.robot.radius;
      if(x<radius||y<radius||x>this.width-radius||y>this.height-radius) return {type:'PAREDE'};
      const obstacle=this.obstacles.find(o=>Math.hypot(x-clamp(x,o.x,o.x+o.w),y-clamp(y,o.y,o.y+o.h))<radius);
      if(obstacle) return {type:'OBSTÁCULO',id:obstacle.kind};
      const person=this.peopleVisible&&this.people.find(p=>Math.hypot(x-p.x,y-p.y)<radius+19);
      return person?{type:'PESSOA',id:person.id}:null;
    }
    collides(x,y) { return Boolean(this.collisionAt(x,y)); }
    move(command,dt) {
      const r=this.robot,v=r.speed;
      [r.left,r.right]=({FRENTE:[v,v],TRAS:[-v,-v],DIREITA:[v,0],ESQUERDA:[0,v],GIRAR:[v,-v]})[command]||[0,0];
      const linear=(r.left+r.right)/2,omega=(r.left-r.right)/28;
      // Sweep the chassis rather than testing just its final point. It avoids
      // visible tunnelling and leaves the robot outside the colliding object.
      const steps=Math.max(1,Math.ceil(Math.abs(linear*dt)/(r.radius*.28)));
      const slice=dt/steps;
      for(let index=0;index<steps;index++) {
        const angle=r.angle+omega*slice/2,x=r.x+Math.cos(angle)*linear*slice,y=r.y+Math.sin(angle)*linear*slice;
        const hit=this.collisionAt(x,y);
        if(hit) { r.left=0;r.right=0;this.collisions++;this.lastCollision={...hit,x:r.x,y:r.y,at:this.time};return false; }
        r.x=x;r.y=y;r.angle=wrap(r.angle+omega*slice);
      }
      this.lastCollision=null;return true;
    }
    avoid() {
      const r=this.robot,t=this.time,phase=r.avoidance;
      if(!phase) return null;
      if(phase.name==='PAUSA' && this.clear>=2) { r.avoidance=null;this.confirming=false;this.reverseAllowed=true;return 'PARAR'; }
      if(t>=phase.until) {
        if(phase.name==='PAUSA') {this.reverseAllowed=false;r.avoidance={name:'RE',until:t+.4};}
        else if(phase.name==='RE') r.avoidance={name:'PAUSA_RE',until:t+.15};
        else if(phase.name==='PAUSA_RE') {r.avoidance={name:'CURVA',until:t+.65};this.clear=0;this.near=0;}
        else if(phase.name==='CURVA') {r.avoidance={name:'AVALIAR',until:t};this.clear=0;this.near=0;}
        else if(this.clear>=2) {r.avoidance=null;this.confirming=false;this.reverseAllowed=true;return 'PARAR';}
        else if(this.near>=2) {r.avoidance={name:'CURVA',until:t+.65};this.near=0;}
      }
      return r.avoidance?.name==='RE'?'TRAS':r.avoidance?.name==='CURVA'?(this.turnRight?'DIREITA':'ESQUERDA'):'PARAR';
    }
    step(dt,{mode='AUTONOMO',command='PARAR',virtualFollow=false}={}) {
      if(!Number.isFinite(dt)||dt<=0) return this.output;
      dt=Math.min(dt,.05);this.time+=dt;this.advancePeople(dt);
      if(this.time-this.sensorAt>=.08-1e-8) {
        this.sensorAt=this.time;this.distance=this.sensor();
        if(this.robot.avoidance?.name==='CURVA') {this.near=0;this.clear=0;}
        else if(this.distance<=20) {this.near++;this.clear=0;} else {this.clear++;this.near=0;}
      }
      const target=virtualFollow?this.visibleTarget():null;
      let desired=command,state='',safety='MONITORANDO';
      if(virtualFollow) {
        this.followDistanceHeld=Boolean(target) && (this.followDistanceHeld?target.distance<120:target.distance<=95);
        desired=!target||this.followDistanceHeld?'PARAR':target.bearing>.12?'DIREITA':target.bearing<-.12?'ESQUERDA':'FRENTE';
        state=!target?'ALVO FORA DE VISTA':this.followDistanceHeld?'DISTÂNCIA MANTIDA':'SEGUINDO '+target.person.name.toUpperCase();
      }
      let applied=desired;
      if(desired==='PARAR') {this.robot.avoidance=null;safety='PARADA';}
      else if(desired==='TRAS' && mode!=='AUTONOMO') this.robot.avoidance=null;
      else if(this.robot.avoidance) {applied=this.avoid();state='DESVIANDO';safety='OBSTÁCULO';}
      else if(desired!=='TRAS' && (this.distance<=20||this.confirming)) {
        applied='PARAR';state='VERIFICANDO CAMINHO';safety='OBSTÁCULO';
        if(!this.confirming) {this.confirming=true;this.near=0;this.clear=0;}
        else if(this.near>=2) {
          if(this.reverseAllowed) this.turnRight=this.events%2===0;
          this.robot.avoidance={name:this.reverseAllowed?'PAUSA':'PAUSA_RE',until:this.time+.15};this.events++;
        } else if(this.clear>=2) {this.confirming=false;this.reverseAllowed=true;}
      }
      if(!this.move(applied,dt)) {applied='PARAR';state='ESPAÇO INSUFICIENTE';safety='COLISÃO EVITADA';}
      this.output={command:applied,state:state||NAMES[applied]||'PARADO',distance:this.distance,safety,
        targetVisible:Boolean(target),targetName:target?.person.name||'',left:this.robot.left,right:this.robot.right};
      if(this.lastCollision) this.output.collision={...this.lastCollision};
      return this.output;
    }
  }
  const api=Object.freeze({World,rayBox,wrap});
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  if(typeof window!=='undefined') window.QuantumSimulatorWorld=api;
})();
