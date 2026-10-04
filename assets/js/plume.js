/* Goblet exhaust plume: WebGL fragment shader drawn behind the hero name.
   Sequence: dark page with the engine dimly lit, igniter sputter, main-stage ignition with a flash
   that lights the page, then steady firing. Scrolling the hero away throttles the engine down.
   The turbulence is advected hundreds of nozzle radii per second, so every frame is a fresh sample:
   you see the flame shimmer, never the flow itself, the way a hot fire looks on camera. */
(function () {
  "use strict";
  var root = document.documentElement;
  var canvas = document.querySelector("canvas.plume");
  var engine = document.querySelector(".hero-engine");
  var glowEl = document.querySelector(".hero-glow"), glowLast = -1;
  var hero = document.querySelector(".hero");
  function light() { root.classList.add("ign-lit"); }
  if (!canvas || !engine || !hero) { light(); return; }

  // nozzle exit centre in the side-on engine image, as fractions of its width/height;
  // radius as a fraction of its height
  var EXIT = { x: 0.997, y: 0.5017, r: 0.3759 };   // centre of the exit plane, at the rim of the bell
  var DELAY = root.classList.contains("ign-pre") ? 1.1 : 0.35;  // seconds in the dark before the igniter
  var IGNITER = 0.55;                                            // seconds of igniter before main stage
  var MIN_THROTTLE = 0.2;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var gl = canvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) { hero.classList.add("no-webgl"); light(); return; }

  var VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}";
  var FS = [
    "precision highp float;",
    "uniform vec2 uExit;uniform float uR,uTf,uP,uSpark,uFlash,uJit,uJit2,uAtt;",
    // sine-free hash: stays well behaved at the large coordinates the fast advection produces
    "float hash(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}",
    "float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);",
    " return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),u.y);}",
    "float fbm(vec2 p){float s=0.0,a=0.5;for(int i=0;i<4;i++){s+=a*noise(p);p=p*2.03+vec2(3.1,1.7);a*=0.5;}return s;}",
    // chord length through a disc of radius r at height y, with a softened edge
    "float sc(float r,float y){float q=r*r-y*y;return 2.0*sqrt(0.5*(q+sqrt(q*q+0.003)));}",
    // half-chord through a disc of radius r, softened in proportion to r (stays clean as r goes to 0)
    "float cone(float r,float y){float q=r*r-y*y;float e=0.22*r*r;return sqrt(0.5*(q+sqrt(q*q+e*e)));}",
    "float wedge(float dxa,float y,float cell,float Ro,float j,float xs){",
    "  if(j<0.0) return 0.0;",
    "  float r1=hash(vec2(j,5.3)), r2=hash(vec2(j,8.9));",
    "  float dist=min(0.12+j*0.16,0.8);",                                // turbulence takes over downstream
    "  float wq=fbm(vec2(xs*1.1-uTf*70.0,y*1.8+j*3.7))-0.5;",
    "  float yy=y-(r1-0.5)*0.14*min(j+0.4,3.0)-dxa*(r2-0.5)*0.22*min(j+0.6,3.0)-wq*dist*0.45*min(dxa,1.0);",  // off-axis, lean, warp
    // downstream each diamond is a little smaller (about 25% by the 4th) and much blurrier
    "  float sz=max(1.0-0.085*j,0.72);",
    "  float bw=0.08*j;",                                               // blur width, in nozzle radii
    "  float Rn=Ro/(1.0+0.0235*xs);",                                   // size against the exit, not the widening jet
    "  float Lt=cell*0.52*sz;",
    "  float t=clamp(dxa/Lt,0.0,1.6);",
    "  float tail2=smoothstep(0.35,1.6+0.35*j,dxa/Lt);",
    "  float tq=max(t-0.6,0.0)/1.0;",
    "  float rc=0.62*Rn*sz*(t<0.6 ? t/0.6 : 1.0-0.55*tq*tq)*(1.0+wq*dist*0.7)+0.003;",  // straight wedge from the tip, widest 60% back, rounded back
    "  float rb=rc+bw, v=yy/rb, g=exp(-v*v*2.0)*sqrt((rc+0.06)/(rb+0.06));",  // blur spreads the same light wider and dimmer
    "  float fill=g;",                                                 // hot gas behind the reflected shock, brightest on axis
    "  float edge=v*v*g*1.6;",                                         // the reflected-shock surface, faint and soft
    "  float along=smoothstep(0.0,0.03+0.24*j,dxa)*(1.0-0.3*min(t,1.0))*(1.0-tail2);",   // hottest right behind the tip, dissolving downstream
    "  float side=max(0.0,1.0+((r1-0.5)*0.6+wq*0.5*dist)*yy/(abs(yy)+0.12));",    // top and bottom never match (smooth across the axis)
    "  float halo=exp(-yy*yy*2.6/(1.0+0.35*j))*smoothstep(0.0,0.5,dxa)*exp(-dxa/(0.9*Lt))*0.14;",  // glow it throws into the gas
    "  float dk=0.88+0.12*hash(vec2(j*7.1,uJit*97.0));",                 // per-frame shimmer
    "  return ((0.8*fill+0.2*edge)*along*side+halo)*dk;",
    "}",
    "void main(){",
    " vec2 q=(gl_FragCoord.xy-uExit)/uR; float x=q.x,y=q.y;",
    " float P=max(uP,0.0), Pc=min(P,1.0);",
    " float fl=0.93+0.07*uJit;",                                         // whole-engine flicker, new every frame
    " vec3 col=vec3(0.0);",
    // light the flame throws back onto the room and the nozzle
    " float amb=exp(-length((q-vec2(5.0,0.0))*vec2(0.075,0.13)));",
    " col+=vec3(1.0,0.42,0.18)*amb*0.035*Pc*fl;",
    " float r0=length(vec2(x*(x<0.0?1.3:2.2),y*0.85));",
    " col+=vec3(1.0,0.45,0.18)*exp(-r0*r0*1.6)*(0.1*Pc*fl+0.3*uSpark);",
    // main-stage ignition flash
    " vec2 fq=q*vec2(0.22,0.4);",
    " col+=vec3(1.0,0.62,0.38)*uFlash*(0.42*amb+0.7*exp(-dot(fq,fq)));",
    // igniter: a ragged tongue licking out of the nozzle
    " if(uSpark>0.001){",
    "  float xs=max(x,0.0);",
    "  float ns=noise(vec2(xs*1.3-uTf*40.0,y*2.2+uJit2*9.0));",
    "  float tongue=exp(-xs/(0.5+1.6*uSpark))*exp(-y*y*(1.4+xs*0.8))*smoothstep(-0.3,0.15,x)*(0.3+0.9*ns);",
    "  col+=vec3(1.0,0.36,0.12)*tongue*uSpark*1.5;",
    " }",
    " if(P>0.001 && x>-0.3 && abs(y)<3.2+0.1*max(x,0.0)){",
    "  float xs=max(x,0.0);",
    // overexpanded jet, proportions measured from a hot-fire photo (exit radius ~0.85 of the lip):
    // the outer envelope flares ~15% straight out of the exit and keeps widening, dipping only a
    // little at each Mach diamond; inside it, a brighter core bounded by the shock surfaces
    // converges from the lip into the first diamond, re-expands, and converges again.
    "  float cell=3.6*(0.4+0.6*sqrt(P));",                              // shock cells stretch with chamber pressure
    "  float fw=0.75*cell;",                                            // first diamond, measured from the exit
    "  float u=(xs-fw)/cell;",
    "  float k=floor(u+0.5), ph=fract(u+0.5);",                          // ph 0.5 at each diamond
    "  float f=fract(u);",
    "  float tri=xs<fw ? 1.0-xs/fw : 1.0-abs(1.0-2.0*f);",               // 0 at a diamond, 1 at the lip and mid-cell
    "  float dxd=(ph-0.5)*cell;",                                       // distance to the nearest diamond
    "  float xe=xs/0.85;",
    "  float dip=(k<0.5 ? 0.2 : 0.1)+0.1*(1.0-Pc)+0.22*(1.0-uAtt);",    // first pinch is deepest; deeper when throttled or separated
    "  float Ro=0.85*(1.0+0.02*xe)*(1.0+0.26*uAtt*(1.0-exp(-xe/0.45)))*(1.0-dip*step(-0.5,u)*exp(-pow(dxd/(0.32*cell),2.0)));",
    "  Ro*=(0.85+0.15*Pc)*mix(0.74,1.0,uAtt);",                          // separated flow leaves the nozzle narrow
    "  float S=Ro*0.92*tri;",                                           // shock surface bounding the bright core
    "  float reach=24.0*P*(0.97+0.06*uJit2)+0.001;",
    "  float start=smoothstep(-0.2,0.05,x);",
    "  float fade=smoothstep(reach,reach*0.45,xs)*start;",
    // fast turbulence: tiny at the nozzle, growing down the tail; advected far more than a frame
    "  float n=fbm(vec2(xs*0.32-uTf*96.0,y*1.5));",
    "  float n2=fbm(vec2(xs*0.8-uTf*151.0,y*2.7+7.3));",
    "  float tail=smoothstep(reach*0.25,reach*0.8,xs);",
    "  float e=(n-0.5)*(0.05+0.01*xs+0.5*tail+0.25*(1.0-uAtt));",
    "  float ay=abs(y)+e;",
    // Lighting is volumetric. The exhaust is optically thin, so what you see is emission summed along
    // each line of sight. The hottest gas is the turbulent mixing layer around the outside, so a sight
    // line grazing the edge crosses far more of it than one through the axis: bright limbs, hollow middle.
    "  float w=0.21+0.02*xs+0.3*tail+0.1*(1.0-uAtt);",                 // mixing layer thickens downstream
    "  float ri=max(Ro-w,0.0);",
    "  float shell=(sc(Ro,ay)-sc(ri,ay))/(2.0*w);",                       // ~1 on the axis, ~3 at the limbs
    "  float ns=fbm(vec2(xs*0.28-uTf*96.0,y*2.4));",                      // streaky turbulence, new every frame
    "  float shellE=shell*(0.5+0.95*ns)*0.17;",
    "  float coreE=sc(ri,ay)*(0.006+0.05*tail);",                                     // dim, translucent core gas
    // the shock surfaces are thin glowing shells too: they draw the converging cone and the barrels
    "  float Si=max(S-0.2,0.0);",
    "  float barrel=(sc(S+0.04,ay)-sc(Si,ay))/(2.0*max(S+0.04-Si,0.24))*smoothstep(0.05,0.3,S);",
    "  float barrelE=barrel*(xs<fw ? 0.045 : 0.025*exp(-max(u,0.0)/4.0))*(1.0-tail);",
    "  float glowE=exp(-pow(max(ay/Ro-1.0,0.0)*4.5,2.0))*0.035;",          // light scattered just outside the jet
    // Mach diamonds, after hot-fire footage. Each one is a feature of the flow, not a shape on top of it:
    // the incident shocks meet at a sharp upstream tip, and from there a wedge of hot gas opens downstream,
    // bounded by the reflected shocks (the same lines that run out to the jet edge). Its brightness decays
    // along the wedge and dissolves into the gas. Every diamond leans, sits off-axis and warps differently,
    // more so downstream where turbulence eats into the shock structure.
    "  float ms=uAtt*smoothstep(0.25,0.9,P);",                          // low pressure: a flat Mach disk; full: diamonds
    "  float j=floor(u);",
    "  float dxa=f*cell;",                                              // distance downstream of the last apex
    "  float Ik=3.3*exp(-max(j,0.0)/(4.5*max(P,0.1)));",
    "  float Ik2=3.3*exp(-max(j-1.0,0.0)/(4.5*max(P,0.1)));",
    "  float wd=wedge(dxa,y,cell,Ro,j,xs)*Ik+wedge(dxa+cell,y,cell,Ro,j-1.0,xs)*Ik2;",
    // the converging incident-shock cone feeds each tip: the gas inside it is hotter and lighter
    "  float conv=xs<fw ? 1.0 : smoothstep(0.35,0.65,f);",
    "  float Sc=max(S,0.02);",
    "  float coneE=exp(-pow(ay/Sc,2.0)*1.6)*conv*(xs<fw ? 0.5 : 0.35*exp(-max(u,0.0)/4.0))*smoothstep(0.0,0.25,xs)*(1.0-tail);",
    "  float tipg=step(0.0,k)*exp(-dxd*dxd/0.3-y*y*3.0)*0.12*3.3*exp(-max(k,0.0)/(4.5*max(P,0.1)));",  // keyed to the nearest diamond, so it is continuous at the tip        // light scattered around each tip, upstream too
    "  float rd=(0.2+0.3*(1.0-ms))*Ro;",
    "  float disk=step(0.0,k)*exp(-pow(dxd/0.2,2.0))*cone(rd,y+(hash(vec2(k,2.0))-0.5)*0.1)/rd*2.4*exp(-max(k,0.0)/2.5);",
    "  float heat=0.45+0.55*Pc;",                                       // cooler and dimmer when throttled down
    "  float Eg=(shellE+coreE+barrelE+glowE)*(0.85+0.15*n2)*2.5*fade;",
    "  float Ed=((wd+tipg+coneE)*mix(0.35,1.0,ms)+disk*(1.0-ms)*(1.0-ms))*start*fade;",
    // colour comes from intensity: red saturates first, then green, then blue, like film exposing hot gas.
    // the shocked gas in the diamonds is hotter, so it runs whiter
    "  col+=(vec3(1.0,0.37,0.14)*Eg+vec3(1.0,0.6,0.34)*Ed)*fl*heat;",
    " }",
    " col*=1.0+uFlash*1.2;",
    " col=1.0-exp(-col*1.6);",
    " gl_FragColor=vec4(col,1.0);",
    "}"
  ].join("\n");

  function sh(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  var prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) { hero.classList.add("no-webgl"); light(); return; }
  gl.useProgram(prog);
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var U = {};
  ["uExit", "uR", "uTf", "uP", "uSpark", "uFlash", "uJit", "uJit2", "uAtt"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

  var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  var exitPx = [0, 0], radPx = 1;
  function layout() {
    var cr = canvas.getBoundingClientRect(), er = engine.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(cr.width * dpr));
    canvas.height = Math.max(1, Math.round(cr.height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    var ex = er.left + er.width * EXIT.x - cr.left, ey = er.top + er.height * EXIT.y - cr.top;
    exitPx = [ex * dpr, (cr.height - ey) * dpr];          // GL y runs bottom-up
    radPx = er.height * EXIT.r * dpr;
  }

  // telemetry readout under the hero, updated only when its text changes
  var tlState = document.querySelector("[data-tl-state]"), tlThr = document.querySelector("[data-tl-thr]");
  var lastState = "", lastThr = "";
  function telemetry(state, pct) {
    if (tlState && state !== lastState) { tlState.textContent = lastState = state; }
    var s = pct + "%";
    if (tlThr && s !== lastThr) { tlThr.textContent = lastThr = s; }
  }

  // ---------------------------------------------------------------- sequence
  var seq0 = null;               // performance.now()/1000 at which the igniter fires
  var lastNow = 0, spark = 0, thr = 1, thrTarget = 1, lit = false;

  function ss(a, b, x) { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); }
  function draw(now) {
    var t = now / 1000;
    var dt = lastNow ? Math.min(0.1, t - lastNow) : 1 / 60; lastNow = t;
    var P = 0, flash = 0, sp = 0, att = 0, state = "Armed";
    if (reduce) { P = 1; att = 1; state = "Mainstage"; if (!lit) { lit = true; light(); } }
    else if (seq0 !== null && t >= seq0) {
      var s = t - seq0;
      if (s < IGNITER) {
        // igniter: random pops, building up
        spark = Math.random() < 0.42 ? 0.35 + 0.65 * Math.random() : spark * 0.55;
        sp = spark * Math.min(1, s / 0.15);
        state = "Igniter";
      } else {
        var u = s - IGNITER;
        // main valve open: hard start, a little chamber-pressure ring, then steady
        P = (1 - Math.exp(-u / 0.075)) * (1 + 0.1 * Math.exp(-u / 0.3) * Math.sin(u * 26));
        att = 1;
        flash = Math.exp(-u / 0.13);
        sp = spark * Math.max(0, 1 - u / 0.15);
        state = u < 0.9 ? "Ignition" : "Mainstage";
        if (!lit) { lit = true; light(); }
      }
    }
    // the engine spools toward the throttle the scroll position asks for
    thr += (thrTarget - thr) * (1 - Math.exp(-dt / 0.22));
    P *= thr;
    telemetry(state, P > 0.01 ? Math.round(thr * 100) : 0);

    gl.uniform2f(U.uExit, exitPx[0], exitPx[1]);
    gl.uniform1f(U.uR, radPx);
    gl.uniform1f(U.uTf, reduce ? 1.0 : t % 10);   // wrap is invisible: consecutive frames are uncorrelated anyway
    gl.uniform1f(U.uP, P);
    gl.uniform1f(U.uSpark, sp);
    gl.uniform1f(U.uFlash, flash);
    gl.uniform1f(U.uAtt, att);
    var jit = reduce ? 0.5 : Math.random();
    gl.uniform1f(U.uJit, jit);
    // flame light on the engine: follows chamber pressure and the flash, flickering with the flame
    if (glowEl) {
      var gv = Math.min(1, Math.min(P, 1) * (0.84 + 0.16 * jit) + flash * 0.9 + sp * 0.4) * 0.9;
      if (Math.abs(gv - glowLast) > 0.004) { glowEl.style.opacity = gv.toFixed(3); glowLast = gv; }
    }
    gl.uniform1f(U.uJit2, reduce ? 0.5 : Math.random());
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  var visible = true, running = false;
  function loop(now) {
    if (!visible || document.hidden) { running = false; return; }
    draw(now);
    requestAnimationFrame(loop);
  }
  function start() { if (!running && !reduce) { running = true; requestAnimationFrame(loop); } }
  function still() { if (reduce) draw(performance.now()); }

  function arm() {
    layout();
    if (seq0 === null) seq0 = performance.now() / 1000 + DELAY;
    start(); still();
  }
  // impatient visitor: any input while still dark fires the engine straight away
  function skip() {
    if (lit) return;
    var now = performance.now() / 1000;
    if (seq0 === null || now < seq0 + IGNITER) seq0 = now - IGNITER;
    // light the page now: the engine may be off screen (scroll restored further down the page),
    // and the render loop only runs while the hero is visible
    lit = true; light();
    start();
  }
  ["wheel", "touchstart", "keydown", "pointerdown"].forEach(function (e) {
    window.addEventListener(e, skip, { passive: true, once: true });
  });

  layout();
  if (engine.complete && engine.naturalWidth) arm(); else {
    engine.addEventListener("load", arm);
    engine.addEventListener("error", function () { skip(); });
  }
  new ResizeObserver(function () { layout(); still(); }).observe(hero);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) start(); });

  // as the hero scrolls away the engine throttles down; rendering stops once it is gone
  var steps = []; for (var i = 0; i <= 50; i++) steps.push(i / 50);
  new IntersectionObserver(function (es) {
    var r = es[0].intersectionRatio;
    visible = es[0].isIntersecting;
    var p = 1 - r;
    var k = Math.min(1, Math.max(0, (p - 0.04) / 0.5)); k = k * k * (3 - 2 * k);
    thrTarget = 1 - (1 - MIN_THROTTLE) * k;
    hero.style.setProperty("--p", p.toFixed(3));
    if (r < 0.6) skip();
    if (visible) { start(); still(); }
  }, { threshold: steps }).observe(hero);
})();
