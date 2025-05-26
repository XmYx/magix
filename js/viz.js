/*
 * main.js – wired-together playground for seven visuals (3 mycelium + 4 geometry)
 * Each layer is isolated in its own <canvas>, stacked full-screen. Visibility,
 * speed multiplier and trail fade are controlled from the UI rendered in index.html.
 */

// ———————————————————————————————————————————————————
// GLOBAL PARAMS (mutated by UI)
// ———————————————————————————————————————————————————
export const CFG = {
  speed: 1.0,   // global speed multiplier
  trail: 0.08   // global trail opacity for geometry canvases
};

// Convenience helpers --------------------------------------------------
const $ = sel => /** @type {HTMLElement} */ (document.querySelector(sel));

function fullCanvas(id) {
  const c = document.createElement('canvas');
  c.id = id;
  document.body.appendChild(c);
  return c;
}

// Utility: size canvases to viewport & devicePixelRatio ---------------
function resizeCanvas(cnv) {
  const dpr = window.devicePixelRatio || 1;
  cnv.width  = innerWidth  * dpr;
  cnv.height = innerHeight * dpr;
  cnv.style.width  = innerWidth + 'px';
  cnv.style.height = innerHeight + 'px';
  const ctx = cnv.getContext('2d');
  ctx && ctx.scale(dpr, dpr);
}

// ———————————————————————————————————————————————————
// 1️⃣  Mushroom-Network Growth (pulse) – instance-mode p5
// ———————————————————————————————————————————————————
function makeMushroomPulseLayer(checkboxId) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.inset = '0';
  document.body.appendChild(wrapper);

  let sketchRef; // for pause/resume

  const Sketch = (p) => {
    // CONST (slightly tweaked to respect CFG.speed)
    const MAX_DEPTH = 6;
    const SPAWN_PROB = 0.035;
    const BG_FADE = 10;
    const GROW_SPEED_ORIG = 2.0;
    const SHRINK_SPEED_ORIG = 0.8;
    const CYCLE_SECONDS = 20;
    // VARS
    let center;
    let branches = [];
    let cycleFrames;

    class Branch {
      constructor(pos, vel, depth) {
        this.pos = pos.copy();
        this.prev = pos.copy();
        this.vel = vel.copy();
        this.depth = depth;
        this.alive = true;
      }
      update(expanding) {
        this.prev.set(this.pos);
        if (expanding) {
          this.vel.rotate(p.random(-0.09, 0.09));
          this.pos.add(this.vel.copy().mult(CFG.speed));
          if (p.random() < SPAWN_PROB && this.depth < MAX_DEPTH) {
            const newVel = this.vel.copy()
              .mult(p.random(0.6, 0.9))
              .rotate(p.random(-0.5, 0.5));
            branches.push(new Branch(this.pos.copy(), newVel, this.depth + 1));
          }
        } else {
          const dir = p5.Vector.sub(center, this.pos)
                               .setMag(SHRINK_SPEED_ORIG * CFG.speed);
          this.pos.add(dir);
          if (p5.Vector.dist(this.pos, center) < 2) this.alive = false;
        }
        const pulse = 1.2 + 0.6 * Math.sin(p.frameCount * 0.05);
        p.strokeWeight(pulse);
        p.line(this.prev.x, this.prev.y, this.pos.x, this.pos.y);
      }
    }

    p.setup = () => {
      p.createCanvas(window.innerWidth, window.innerHeight);
      center = p.createVector(p.width / 2, p.height / 2);
      cycleFrames = CYCLE_SECONDS * 60;
      reset();
      p.stroke(255);
      p.noFill();
      p.frameRate(60);
    };

    function reset() {
      branches = [];
      const initialVel = p5.Vector.random2D().mult(GROW_SPEED_ORIG * CFG.speed);
      branches.push(new Branch(center.copy(), initialVel, 0));
    }

    p.windowResized = () => {
      p.resizeCanvas(window.innerWidth, window.innerHeight);
      center.set(p.width / 2, p.height / 2);
    };

    p.draw = () => {
      p.background(0, BG_FADE);
      const expanding = (p.frameCount % cycleFrames) < cycleFrames / 2;
      for (const b of branches) b.update(expanding);
      branches = branches.filter(b => b.alive);
      if (!expanding && branches.length === 0) reset();
    };

    // expose for outer world
    sketchRef = p;
  };

  const pInst = new p5(Sketch, wrapper);

  // API for layer mgmt
  const checkbox = $("#" + checkboxId);
  checkbox.addEventListener('change', () => {
    wrapper.style.display = checkbox.checked ? 'block' : 'none';
    checkbox.checked ? pInst.loop() : pInst.noLoop();
  });
  return {
    checkbox,
    setSpeed: () => {}, // handled internally via CFG
  };
}

// ———————————————————————————————————————————————————
// 2️⃣  Convergent-Evolving Mycelial Matrix – p5 instance
// ———————————————————————————————————————————————————
function makeConvergentLayer(checkboxId) {
  const holder = document.createElement('div');
  holder.style.position = 'absolute';
  holder.style.inset = '0';
  document.body.appendChild(holder);

  const Sketch = (p) => {
    // ——— CONSTS ———
    const MAX_DEPTH = 6;
    const BASE_SPAWN_PROB = 0.03;
    const BG_FADE = 15;
    const MAX_BRANCHES = 950;
    const BRANCH_LIFE_FR = [260, 460];
    const COLLIDE_DIST = 12;
    const REPRO_RATE = 0.4;
    const ELITE_BIAS = 0.9;
    const NODE_COUNT = 4;
    const NODE_SPEED = 0.12;
    const NOISE_SCALE = 0.005;
    const GROW_SPEED_BASE = 2.0;
    const SHRINK_SPEED_BASE = 1.0;
    const CYCLE_SECONDS = 30;

    let startPt, endPt, branches = [], attractors = [], cycleFrames, noiseZ = 0;

    class Branch {
      constructor(pos, vel, depth) {
        this.pos = pos.copy();
        this.prev = pos.copy();
        this.vel = vel.copy();
        this.depth = depth;
        this.life = p.int(p.random(...BRANCH_LIFE_FR));
        this.alive = true;
      }
      update(expanding) {
        this.prev.set(this.pos);
        this.life--;
        if (this.life <= 0) { this.alive = false; return; }
        if (expanding) {
          const nearest = nearestAttractor(this.pos);
          const steer = p5.Vector.sub(nearest, this.pos).setMag(0.25);
          const nAng = p.noise(this.pos.x * NOISE_SCALE, this.pos.y * NOISE_SCALE, noiseZ) * p.TWO_PI * 2;
          const noiseVec = p5.Vector.fromAngle(nAng).setMag(0.4);
          this.vel.add(steer).add(noiseVec).limit(GROW_SPEED_BASE * CFG.speed);
          this.pos.add(this.vel);
          if (branches.length < MAX_BRANCHES && this.depth < MAX_DEPTH) {
            const dist = p5.Vector.dist(this.pos, nearest);
            const fitness = 1.0 - p.constrain(dist / p.width, 0, 1);
            const spawnProb = p.lerp(BASE_SPAWN_PROB, BASE_SPAWN_PROB * 4, fitness * ELITE_BIAS);
            if (p.random() < spawnProb) {
              const newVel = this.vel.copy().rotate(p.random(-0.6,0.6)).mult(p.random(0.5,0.9));
              branches.push(new Branch(this.pos.copy(), newVel, this.depth + 1));
            }
          }
        } else {
          const dir = p5.Vector.sub(endPt, this.pos).setMag(SHRINK_SPEED_BASE * CFG.speed);
          this.pos.add(dir);
          if (p5.Vector.dist(this.pos, endPt) < 2) this.alive = false;
        }
        const pulse = 1.1 + 0.6 * Math.sin(p.frameCount * 0.04);
        p.strokeWeight(pulse);
        p.line(this.prev.x, this.prev.y, this.pos.x, this.pos.y);
      }
    }

    function initPoints() {
      startPt = p.createVector(p.width * 0.1, p.height * 0.5);
      endPt   = p.createVector(p.width * 0.9, p.height * 0.5);
      attractors = [];
      for (let i = 1; i <= NODE_COUNT; i++) {
        const amt = i / (NODE_COUNT + 1);
        attractors.push(p5.Vector.lerp(startPt, endPt, amt));
      }
    }
    function nearestAttractor(pt) {
      let md = Infinity, closest;
      for (const a of attractors) {
        const d = p5.Vector.dist(pt,a);
        if (d < md) { md = d; closest = a; }
      }
      return closest || endPt;
    }
    function moveAttractors() {
      for (let i = 0; i < attractors.length; i++) {
        const target = (i === attractors.length-1) ? endPt : attractors[i+1];
        const step = p5.Vector.sub(target, attractors[i]).limit(NODE_SPEED * CFG.speed);
        attractors[i].add(step);
      }
      attractors = attractors.filter(a => p5.Vector.dist(a,endPt) > 4);
    }
    function collideAndReproduce() {
      for (let i=0;i<branches.length;i++){
        const a=branches[i];
        for(let j=i+1;j<branches.length;j++){
          const b=branches[j];
          if(p5.Vector.dist(a.pos,b.pos)<COLLIDE_DIST && p.random()<REPRO_RATE){
            const newDir=p5.Vector.random2D().lerp(p5.Vector.sub(endPt,a.pos).normalize(),0.5).setMag(GROW_SPEED_BASE*CFG.speed);
            branches.push(new Branch(a.pos.copy(),newDir,Math.min(a.depth,b.depth)+1));
            if(branches.length>=MAX_BRANCHES) return;
          }
        }
      }
    }
    function resetNet(){
      branches=[];
      const iv = p.createVector(GROW_SPEED_BASE*CFG.speed,0);
      branches.push(new Branch(startPt.copy(),iv,0));
    }

    p.setup=()=>{
      p.createCanvas(window.innerWidth,window.innerHeight);
      p.noFill(); p.stroke(255); p.frameRate(60);
      initPoints(); resetNet();
      cycleFrames = CYCLE_SECONDS*60;
    };

    p.draw=()=>{
      p.background(0,BG_FADE);
      const expanding = (p.frameCount%cycleFrames)<cycleFrames/2;
      if(expanding) moveAttractors();
      for(const b of branches) b.update(expanding);
      branches = branches.filter(b=>b.alive);
      if(expanding && branches.length<MAX_BRANCHES) collideAndReproduce();
      if(!expanding && branches.length===0){ initPoints(); resetNet(); }
      noiseZ += 0.003*CFG.speed;
    };

    p.windowResized = () => {
      p.resizeCanvas(window.innerWidth, window.innerHeight);
      initPoints();
    };
  };

  const inst = new p5(Sketch, holder);
  const checkbox = $("#"+checkboxId);
  checkbox.addEventListener('change', ()=>{
    holder.style.display = checkbox.checked?'block':'none';
    checkbox.checked ? inst.loop() : inst.noLoop();
  });
  return { checkbox };
}

// ———————————————————————————————————————————————————
// 3️⃣  Infinite Tribes Mycelium – p5 instance
// ———————————————————————————————————————————————————
function makeTribesLayer(checkboxId) {
  const wrap=document.createElement('div');
  wrap.style.position='absolute';wrap.style.inset='0';document.body.appendChild(wrap);
  const Sketch = (p)=>{
    const MAX_DEPTH=6;const BASE_SPAWN_PROB=0.03;const BG_FADE=18;const MAX_BRANCHES=1100;
    const BRANCH_LIFE=[320,580];const COLLIDE_DIST=12;const REPRO_RATE=0.4;const ELITE_BIAS=0.9;
    const TRIBE_INTERVAL=[900,1500];const NODE_COUNT=4;const NODE_DRIFT=0.35;const NOISE_SCALE=0.004;
    let startPt,branches=[],attractors=[],noiseZ=0,nextTribe;
    class Branch{
      constructor(pos,vel,depth,hue){this.pos=pos.copy();this.prev=pos.copy();this.vel=vel.copy();this.depth=depth;this.hue=hue;this.life=p.int(p.random(...BRANCH_LIFE));this.alive=true;}
      update(){
        this.prev.set(this.pos);this.life--;if(this.life<=0){this.alive=false;return;}
        const nearest=nearestAttr(this.pos);const steer=p5.Vector.sub(nearest,this.pos).setMag(0.25);
        const nAng=p.noise(this.pos.x*NOISE_SCALE,this.pos.y*NOISE_SCALE,noiseZ)*p.TWO_PI*2;
        const noiseVec=p5.Vector.fromAngle(nAng).setMag(0.4);
        this.vel.add(steer).add(noiseVec).limit(2*CFG.speed);this.pos.add(this.vel);
        this.pos.x=p.constrain(this.pos.x,0,p.width);this.pos.y=p.constrain(this.pos.y,0,p.height);
        if(branches.length<MAX_BRANCHES&&this.depth<MAX_DEPTH){
          const dist=p5.Vector.dist(this.pos,nearest);const fit=1-p.constrain(dist/p.width,0,1);
          const prob=p.lerp(BASE_SPAWN_PROB,BASE_SPAWN_PROB*4,fit*ELITE_BIAS);
          if(p.random()<prob){const newVel=this.vel.copy().rotate(p.random(-0.6,0.6)).mult(p.random(0.5,0.9));branches.push(new Branch(this.pos.copy(),newVel,this.depth+1,this.hue));}
        }
        const pulse=1.1+0.6*Math.sin(p.frameCount*0.04);p.strokeWeight(pulse);
        const hueVal=(this.hue+this.depth*28+p.frameCount*0.25)%360;p.stroke(hueVal,60,100,80);
        p.line(this.prev.x,this.prev.y,this.pos.x,this.pos.y);
      }
    }
    function spawnTribe(){const hue=p.random(0,360);const vel=p.createVector(2*CFG.speed,0);branches.push(new Branch(startPt.copy(),vel,0,hue));}
    function schedule(){nextTribe=p.frameCount+p.int(p.random(...TRIBE_INTERVAL));}
    function initAttr(){attractors=[];for(let i=0;i<NODE_COUNT;i++){const amt=(i+1)/(NODE_COUNT+1);attractors.push(p5.Vector.lerp(startPt,p.createVector(p.width*0.8,p.random(p.height*0.25,p.height*0.75)),amt));}}
    function driftAttr(){for(const a of attractors){const d=p5.Vector.random2D().mult(NODE_DRIFT);a.add(d);a.x=p.constrain(a.x,p.width*0.05,p.width*0.95);a.y=p.constrain(a.y,p.height*0.05,p.height*0.95);}}
    function nearestAttr(pt){let md=Infinity,cl;for(const a of attractors){const d=p5.Vector.dist(pt,a);if(d<md){md=d;cl=a;}}return cl||startPt;}
    function collide(){if(branches.length>=MAX_BRANCHES)return;for(let i=0;i<branches.length;i++){const a=branches[i];for(let j=i+1;j<branches.length;j++){const b=branches[j];if(a.hue!==b.hue&&p5.Vector.dist(a.pos,b.pos)<COLLIDE_DIST&&p.random()<REPRO_RATE){const dir=p5.Vector.random2D().setMag(2*CFG.speed);const hue=p.random()<0.5?a.hue:b.hue;branches.push(new Branch(a.pos.copy(),dir,Math.min(a.depth,b.depth)+1,hue));if(branches.length>=MAX_BRANCHES)return;}}}}
    p.setup=()=>{p.createCanvas(window.innerWidth,window.innerHeight);p.colorMode(p.HSB,360,100,100,100);startPt=p.createVector(p.width*0.1,p.height*0.5);initAttr();spawnTribe();schedule();p.noFill();p.frameRate(60);};
    p.draw=()=>{p.background(0,BG_FADE);if(p.frameCount>=nextTribe&&branches.length<MAX_BRANCHES*0.9){spawnTribe();schedule();}driftAttr();for(const b of branches)b.update();branches=branches.filter(b=>b.alive);collide();if(branches.length===0)spawnTribe();noiseZ+=0.003*CFG.speed;};
    p.windowResized=()=>{p.resizeCanvas(window.innerWidth,window.innerHeight);startPt.set(p.width*0.1,p.height*0.5);initAttr();};
  };
  const inst=new p5(Sketch,wrap);
  const checkbox=$("#"+checkboxId);
  checkbox.addEventListener('change',()=>{wrap.style.display=checkbox.checked?'block':'none';checkbox.checked?inst.loop():inst.noLoop();});
  return {checkbox};
}

// ———————————————————————————————————————————————————
// Geometry canvases (plain 2d) share code structure
// ———————————————————————————————————————————————————
function makeSriLayer(checkboxId){
  const cv=fullCanvas('sri');resizeCanvas(cv);const ctx=cv.getContext('2d');let t=0;
  function draw(){ctx.fillStyle=`rgba(0,0,0,${CFG.trail})`;ctx.fillRect(0,0,cv.width,cv.height);
    const cx=cv.width/2,cy=cv.height/2;ctx.save();const pulse=1+0.02*Math.sin(t*0.02);
    ctx.translate(cx,cy);ctx.scale(pulse,pulse);ctx.translate(-cx,-cy);const maxSq=6;ctx.lineWidth=1.2;for(let i=1;i<=maxSq;i++){const r=40+i*25;const spin=i%2===0?-1:1;const aOff=t*0.0005*spin;ctx.beginPath();for(let j=0;j<4;j++){const ang=j*Math.PI/2+aOff;const x=cx+r*Math.cos(ang),y=cy+r*Math.sin(ang);j===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.closePath();ctx.strokeStyle=`hsl(${(t+i*10)%360},100%,70%)`;ctx.stroke();}
    ctx.restore();t+=CFG.speed;}
  let anim;function loop(){anim=requestAnimationFrame(loop);draw();}
  loop();window.addEventListener('resize',()=>resizeCanvas(cv));const cb=$("#"+checkboxId);
  cb.addEventListener('change',()=>{cv.style.display=cb.checked?'block':'none';if(cb.checked){loop();}else{cancelAnimationFrame(anim);}});
  return {checkbox:cb};
}

function makeFlowerLayer(checkboxId){
  const cv=fullCanvas('flower');resizeCanvas(cv);const ctx=cv.getContext('2d');let t=0;
  const params={radius:40,rings:5,pulse:0.03};
  function drawFlower(cx,cy){const hexR=params.radius*Math.sin(Math.PI/3);ctx.strokeStyle=`hsl(${(t*10)%360},100%,80%)`;ctx.lineWidth=1.2;for(let q=-params.rings;q<=params.rings;q++){for(let r=-params.rings;r<=params.rings;r++){const x=cx+q*1.5*params.radius;const y=cy+r*hexR*2+(q%2)*hexR;if(Math.hypot(x-cx,y-cy)<=params.rings*params.radius*1.5){ctx.beginPath();ctx.arc(x,y,params.radius,0,Math.PI*2);ctx.stroke();}}}}
  function draw(){ctx.fillStyle=`rgba(0,0,0,${CFG.trail})`;ctx.fillRect(0,0,cv.width,cv.height);const cx=cv.width/2,cy=cv.height/2;ctx.save();const pulse=1+params.pulse*Math.sin(t*0.05);ctx.translate(cx,cy);ctx.scale(pulse,pulse);ctx.translate(-cx,-cy);drawFlower(cx,cy);ctx.restore();t+=CFG.speed;}
  let anim;function loop(){anim=requestAnimationFrame(loop);draw();}
  loop();window.addEventListener('resize',()=>resizeCanvas(cv));const cb=$("#"+checkboxId);
  cb.addEventListener('change',()=>{cv.style.display=cb.checked?'block':'none';cb.checked?loop():cancelAnimationFrame(anim);});
  return {checkbox:cb};
}

function makeMixerLayer(checkboxId){
  const cv=fullCanvas('mixer');resizeCanvas(cv);const ctx=cv.getContext('2d');let t=0;let pattern='flower';
  const patternOrder=['flower','metatron','sri'];
  // Minimal UI cycle on click
  cv.addEventListener('click',()=>{pattern=patternOrder[(patternOrder.indexOf(pattern)+1)%patternOrder.length];});
  function drawFlower(cx,cy){const radius=40,rings=5,hexR=radius*Math.sin(Math.PI/3);ctx.strokeStyle=`hsl(${(t*10)%360},100%,80%)`;ctx.lineWidth=1.2;for(let q=-rings;q<=rings;q++){for(let r=-rings;r<=rings;r++){const x=cx+q*1.5*radius;const y=cy+r*hexR*2+(q%2)*hexR;if(Math.hypot(x-cx,y-cy)<=rings*radius*1.5){ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.stroke();}}}}
  function drawMetatron(cx,cy){const radius=120+10*Math.sin(t*0.02);ctx.strokeStyle=`hsl(${(t*15)%360},80%,75%)`;ctx.lineWidth=1.2;const pts=[];for(let i=0;i<13;i++){const ang=2*Math.PI*i/13+t*0.001;const x=cx+radius*Math.cos(ang);const y=cy+radius*Math.sin(ang);pts.push([x,y]);ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);ctx.stroke();}for(let i=0;i<pts.length;i++){for(let j=i+1;j<pts.length;j++){ctx.beginPath();ctx.moveTo(pts[i][0],pts[i][1]);ctx.lineTo(pts[j][0],pts[j][1]);ctx.stroke();}}}
  function drawSri(cx,cy){const layers=9;ctx.strokeStyle=`hsl(${(t*5)%360},100%,70%)`;ctx.lineWidth=1.5;for(let i=1;i<=layers;i++){const off=t*0.001*(i%2===0?1:-1);const r=i*20+80;ctx.beginPath();for(let j=0;j<4;j++){const a=j*Math.PI/2+off;const x=cx+r*Math.cos(a),y=cy+r*Math.sin(a);j===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.closePath();ctx.stroke();}}
  function draw(){ctx.fillStyle=`rgba(0,0,0,${CFG.trail})`;ctx.fillRect(0,0,cv.width,cv.height);const cx=cv.width/2,cy=cv.height/2;ctx.save();const pulse=1+0.03*Math.sin(t*0.05);ctx.translate(cx,cy);ctx.scale(pulse,pulse);ctx.translate(-cx,-cy);
    if(pattern==='flower')drawFlower(cx,cy);else if(pattern==='metatron')drawMetatron(cx,cy);else drawSri(cx,cy);
    ctx.restore();t+=CFG.speed;}
  let anim;function loop(){anim=requestAnimationFrame(loop);draw();}
  loop();window.addEventListener('resize',()=>resizeCanvas(cv));const cb=$("#"+checkboxId);
  cb.addEventListener('change',()=>{cv.style.display=cb.checked?'block':'none';cb.checked?loop():cancelAnimationFrame(anim);});
  return {checkbox:cb};
}

// ———————————————————————————————————————————————————
// Kick-off – build all layers & bind global UI
// ———————————————————————————————————————————————————
const layers = [
  makeMushroomPulseLayer('mushroom1'),
  makeConvergentLayer('mushroom2'),
  makeTribesLayer('mushroom3'),
  makeSriLayer('geoSri'),
  makeFlowerLayer('geoFlower'),
  makeMixerLayer('geoMixer')
];

// Global sliders -------------------------------------------------------
$('#speed').addEventListener('input',e=>{CFG.speed=parseFloat(e.target.value);});
$('#trail').addEventListener('input',e=>{CFG.trail=parseFloat(e.target.value);});

// Respond to viewport changes for raw canvases (p5 handled inside its own)
window.addEventListener('resize',()=>{
  document.querySelectorAll('canvas').forEach(c=>{if(!c.classList.contains('p5Canvas'))resizeCanvas(c);});
});
