/* One CPU inference at a time. Queue before capturing, never queue old images. */
(() => {
  'use strict';
  class InferenceScheduler {
    constructor() { this.active=false;this.queue=[]; }
    acquire() {
      return new Promise((resolve,reject)=>{
        const item={resolve,reject};
        item.timer=setTimeout(()=>{
          const index=this.queue.indexOf(item);
          if(index>=0) {this.queue.splice(index,1);reject(Error('Processamento de visão ocupado por tempo demais.'));}
        },6500);
        this.queue.push(item);this.next();
      });
    }
    next() {
      if(this.active || !this.queue.length) return;
      this.active=true;const item=this.queue.shift();clearTimeout(item.timer);let released=false;
      item.resolve(()=>{if(released)return;released=true;this.active=false;this.next();});
    }
  }
  if(typeof module!=='undefined'&&module.exports) module.exports={InferenceScheduler};
  if(typeof window!=='undefined') window.QuantumVisionScheduler=new InferenceScheduler();
})();
