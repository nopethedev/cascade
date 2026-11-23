/* Cascade Game Studio runtime. Canvas2D renderer + Matter.js physics + a
   data-driven visual-script interpreter. The same file is used by the editor's
   sandboxed play iframe and by exported standalone HTML games.

   Visual graphs are interpreted as data. User-authored JavaScript is the only
   code evaluated at runtime, and only inside the sandboxed iframe or the
   exported game, never in the Cascade application origin. */
(function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const str = (value, fallback = '') => (value === undefined || value === null ? fallback : String(value));
  const vec = (x, y) => ({ x: num(x), y: num(y) });
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  class InputManager {
    constructor(runtime, canvas) {
      this.runtime = runtime;
      this.canvas = canvas;
      this.down = new Set();
      this.pressed = new Set();
      this.framePressed = new Set();
      this.released = new Set();
      this.pointer = { x: 0, y: 0, down: false, justDown: false, justUp: false };
      this.touch = false;
      this.gamepads = [];
      this.handleKeyDown = (event) => {
        if (isTyping(event.target)) return;
        if (!this.down.has(event.code)) this.pressed.add(event.code);
        this.down.add(event.code);
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      };
      this.handleKeyUp = (event) => {
        this.down.delete(event.code);
        this.released.add(event.code);
      };
      this.handleBlur = () => { this.down.clear(); this.pressed.clear(); this.framePressed.clear(); this.pointer.down = false; };
      this.handlePointerDown = (event) => {
        this.pointer.down = true;
        this.pointer.justDown = true;
        this.updatePointer(event);
        this.runtime.onPointer('down');
      };
      this.handlePointerMove = (event) => { this.updatePointer(event); };
      this.handlePointerUp = (event) => {
        this.updatePointer(event);
        this.pointer.down = false;
        this.pointer.justUp = true;
        this.runtime.onPointer('up');
      };
      this.handleTouchStart = (event) => { this.touch = true; this.pointer.down = true; this.pointer.justDown = true; this.updateTouch(event); this.runtime.onPointer('down'); };
      this.handleTouchMove = (event) => { this.updateTouch(event); };
      this.handleTouchEnd = (event) => { this.touch = false; this.pointer.down = false; this.pointer.justUp = true; this.updateTouch(event); };
      this.bind();
    }

    bind() {
      this.runtime.listen(root, 'keydown', this.handleKeyDown);
      this.runtime.listen(root, 'keyup', this.handleKeyUp);
      this.runtime.listen(root, 'blur', this.handleBlur);
      this.runtime.listen(this.canvas, 'pointerdown', this.handlePointerDown);
      this.runtime.listen(this.canvas, 'pointermove', this.handlePointerMove);
      this.runtime.listen(root, 'pointerup', this.handlePointerUp);
      this.runtime.listen(this.canvas, 'touchstart', this.handleTouchStart, { passive: false });
      this.runtime.listen(this.canvas, 'touchmove', this.handleTouchMove, { passive: false });
      this.runtime.listen(this.canvas, 'touchend', this.handleTouchEnd);
    }

    updatePointer(event) {
      const point = this.runtime.clientToWorld(event.clientX, event.clientY);
      const screen = this.runtime.clientToScreen(event.clientX, event.clientY);
      this.pointer.x = point.x;
      this.pointer.y = point.y;
      this.pointer.screenX = screen.x;
      this.pointer.screenY = screen.y;
    }

    updateTouch(event) {
      const touch = event.touches?.[0] || event.changedTouches?.[0];
      if (touch) {
        const point = this.runtime.clientToWorld(touch.clientX, touch.clientY);
        const screen = this.runtime.clientToScreen(touch.clientX, touch.clientY);
        this.pointer.x = point.x;
        this.pointer.y = point.y;
        this.pointer.screenX = screen.x;
        this.pointer.screenY = screen.y;
      }
    }

    beginFrame() {
      // Visual graphs run asynchronously, so keep a per-frame key snapshot
      // instead of clearing `pressed` at the end of the synchronous update.
      this.framePressed = new Set(this.pressed);
      this.pressed.clear();
    }

    afterFrame() {
      this.released.clear();
      this.pointer.justDown = false;
      this.pointer.justUp = false;
    }

    held(code) { return this.down.has(code); }
    justPressed(code) { return this.framePressed.has(code); }

    readGamepad() {
      const pads = root.navigator?.getGamepads?.() || [];
      this.gamepads = [...pads].filter(Boolean);
      return this.gamepads[0] || null;
    }

    button(index) {
      const pad = this.readGamepad();
      if (!pad) return false;
      const button = pad.buttons?.[Number(index) || 0];
      return !!(button && (button.pressed || button.value > 0.5));
    }

    padAxis(index) {
      const pad = this.readGamepad();
      return pad?.axes?.[Number(index) || 0] || 0;
    }

    axis(action) {
      const mappings = this.runtime.project.project.input || {};
      const mapping = mappings[action] || {};
      if (mapping.axis) {
        const [negative, positive] = String(mapping.axis).split(':');
        return (this.held(positive) ? 1 : 0) - (this.held(negative) ? 1 : 0);
      }
      const keys = Array.isArray(mapping.keys) ? mapping.keys : [];
      const half = Math.max(1, Math.floor(keys.length / 2));
      let value = 0;
      keys.forEach((key, index) => {
        if (this.held(key)) value += index < half ? -1 : 1;
      });
      return clamp(value, -1, 1);
    }

    serialize() {
      return { down: [...this.down], pointer: { ...this.pointer }, touch: this.touch };
    }
  }

  function isTyping(target) {
    const tag = String(target?.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
  }

  class AudioManager {
    constructor(assets, settings) {
      this.assets = assets;
      this.settings = settings || {};
      this.ctx = null;
      this.buffers = new Map();
      this.active = new Map();
      this.music = null;
      this.master = clamp(this.settings.master ?? 1, 0, 1);
      this.musicVolume = clamp(this.settings.music ?? 0.7, 0, 1);
      this.sfxVolume = clamp(this.settings.sfx ?? 0.9, 0, 1);
    }

    context() {
      if (this.ctx) return this.ctx;
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.master;
      this.masterGain.connect(this.ctx.destination);
      return this.ctx;
    }

    async decode(assetId) {
      if (this.buffers.has(assetId)) return this.buffers.get(assetId);
      const asset = this.assets.get(assetId);
      if (!asset?.src) return null;
      const ctx = this.context();
      if (!ctx) return null;
      try {
        const response = await fetch(asset.src);
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        this.buffers.set(assetId, buffer);
        return buffer;
      } catch {
        return null;
      }
    }

    async play(assetId, options = {}) {
      const ctx = this.context();
      if (!ctx) return null;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const buffer = await this.decode(assetId);
      if (!buffer) return null;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = !!options.loop;
      source.playbackRate.value = clamp(options.pitch ?? 1, 0.25, 4);
      const gain = ctx.createGain();
      const volume = clamp(options.volume ?? 1, 0, 1) * (options.bus === 'music' ? this.musicVolume : this.sfxVolume);
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(this.masterGain);
      source.start();
      this.active.set(source, { assetId, gain, source });
      source.onended = () => this.active.delete(source);
      if (options.bus === 'music') this.music = { assetId, source, gain };
      return { source, gain };
    }

    stop(assetId) {
      for (const [source, entry] of this.active) {
        if (!assetId || entry.assetId === assetId) {
          try { source.stop(); } catch { /* already stopped */ }
          this.active.delete(source);
        }
      }
      if (this.music && (!assetId || this.music.assetId === assetId)) this.music = null;
    }

    setVolume(value) {
      const next = clamp(value, 0, 1);
      this.sfxVolume = next;
      if (this.masterGain) this.masterGain.gain.value = this.master * 1;
    }

    setMusicVolume(value) {
      this.musicVolume = clamp(value, 0, 1);
      if (this.music?.gain) this.music.gain.gain.value = this.musicVolume;
    }

    setPitch(value) {
      for (const entry of this.active.values()) {
        try { entry.source.playbackRate.value = clamp(value, 0.25, 4); } catch { /* noop */ }
      }
    }

    setMaster(value) {
      this.master = clamp(value, 0, 1);
      if (this.masterGain) this.masterGain.gain.value = this.master;
    }
  }

  class Runtime {
    constructor(project, canvas, options = {}) {
      this.project = project;
      this.canvas = canvas || null;
      this.ctx = canvas ? canvas.getContext('2d') : null;
      this.options = options;
      this.headless = !!options.headless || !this.ctx;
      this.listeners = [];
      this.raf = null;
      this.running = false;
      this.paused = false;
      this.destroyed = false;
      this.lastTime = 0;
      this.accumulator = 0;
      this.entities = new Map();
      this.byBody = new Map();
      this.bodies = [];
      this.scripts = new Map();
      this.codeInstances = new Map();
      this.vars = { ...(project.variables || {}) };
      this.scene = null;
      this.engine = null;
      this.camera = { x: 0, y: 0, zoom: 1, smoothing: 0.15, shake: 0, shakeTime: 0, bounds: null };
      this.input = new InputManager(this, this.canvas);
      this.assets = new Map((project.assets || []).map((asset) => [asset.id, asset]));
      this.images = new Map();
      this.audio = new AudioManager(this.assets, project.project.audio);
      this.particles = [];
      this.uiHit = null;
      this.frame = 0;
      this.debug = !!project.project.debug;
      this.won = false;
      this.winMessage = '';
      this.viewScale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.dpr = 1;
      this.sceneTime = 0;
      this.totalTime = 0;
      this.fps = 0;
      this.frameTime = 0;
      this.renderTime = 0;
      this.scriptTime = 0;
      this.physicsTime = 0;
      this.drawCalls = 0;
      this.pointer = { x: 0, y: 0, down: false };
      this.network = null;
      this.bindParentMessages();
      this.resize();
    }

    listen(target, type, handler, options) {
      if (!target?.addEventListener) return;
      target.addEventListener(type, handler, options);
      this.listeners.push(() => target.removeEventListener(type, handler, options));
    }

    bindParentMessages() {
      if (typeof root.addEventListener !== 'function') return;
      this.listen(root, 'message', (event) => {
        if (root.parent && event.source !== root.parent) return;
        const data = event.data || {};
        if (data.type === 'cascade-game:pause') this.pause();
        if (data.type === 'cascade-game:resume') this.resume();
        if (data.type === 'cascade-game:stop') this.stop();
        if (data.type === 'cascade-game:step') this.stepFrame();
        if (data.type === 'cascade-game:restart') this.restart();
      });
    }

    post(type, payload = {}) {
      if (typeof root.parent === 'undefined' || root.parent === root) return;
      try { root.parent.postMessage({ type, ...payload }, '*'); } catch { /* cross-origin detached */ }
    }

    log(message, level = 'log') {
      const text = str(message);
      this.post('cascade-game:console', { message: text, level, time: Date.now() });
      if (level === 'error') console.error(text);
      else console.log(text);
    }

    clearListeners() {
      for (const remove of this.listeners.splice(0)) {
        try { remove(); } catch { /* noop */ }
      }
    }

    setScene(sceneId) {
      const scene = (this.project.scenes || []).find((item) => item.id === sceneId) || this.project.scenes?.[0];
      if (!scene) throw new Error('The project has no scenes');
      this.clearScene();
      this.scene = scene;
      this.project.activeScene = scene.id;
      this.sceneTime = 0;
      this.won = false;
      this.winMessage = '';
      this.vars = { ...(this.project.variables || {}) };
      this.entities.clear();
      this.byBody.clear();
      this.codeInstances.clear();
      this.particles.length = 0;
      this.createPhysics(scene);
      for (const data of scene.entities) this.createEntity(data);
      this.resolveHierarchy();
      this.syncBodyPositions();
      const camera = [...this.entities.values()].find((entity) => entity.components.Camera2D);
      this.camera = {
        x: camera?.worldX ?? camera?.x ?? this.project.project.width / 2,
        y: camera?.worldY ?? camera?.y ?? this.project.project.height / 2,
        zoom: num(camera?.components.Camera2D.zoom, 1),
        smoothing: num(camera?.components.Camera2D.smoothing, 0.15),
        shake: 0,
        shakeTime: 0,
        bounds: camera?.components.Camera2D?.boundsW
          ? { x: num(camera.components.Camera2D.boundsX), y: num(camera.components.Camera2D.boundsY), w: num(camera.components.Camera2D.boundsW), h: num(camera.components.Camera2D.boundsH) }
          : null,
        follow: camera?.components.Camera2D.follow || null,
        pixelPerfect: !!camera?.components.Camera2D.pixelPerfect,
      };
      this.cameraEntity = camera || null;
      this.createTileCollisions();
      this.startScripts('sceneLoad');
      this.startCodeScripts();
      this.startScripts('start');
      this.post('cascade-game:scene', { sceneId: scene.id, sceneName: scene.name, entities: this.entities.size });
      return scene;
    }

    clearScene() {
      if (this.engine && root.Matter) {
        root.Matter.Events.off(this.engine);
        root.Matter.Engine.clear(this.engine);
      }
      this.engine = null;
      this.bodies = [];
      this.entities.clear();
      this.byBody.clear();
    }

    createPhysics(scene) {
      if (!root.Matter) {
        this.log('Matter.js is unavailable; physics is disabled in this preview.', 'warn');
        this.engine = null;
        return;
      }
      this.engine = root.Matter.Engine.create({ gravity: vec(num(scene.gravity?.x, 0) / 1000, num(scene.gravity?.y, 980) / 1000) });
      this.engine.gravity.scale = 0.001;
      root.Matter.Events.on(this.engine, 'collisionStart', (event) => this.handleCollisions(event.pairs, 'collisionEnter'));
      root.Matter.Events.on(this.engine, 'collisionEnd', (event) => this.handleCollisions(event.pairs, 'collisionExit'));
    }

    syncBodyPositions() {
      if (!root.Matter) return;
      for (const entity of this.entities.values()) {
        if (!entity.body) continue;
        root.Matter.Body.setPosition(entity.body, { x: entity.worldX, y: entity.worldY });
      }
    }

    createEntity(data) {
      const entity = {
        ...data,
        x: num(data.x),
        y: num(data.y),
        w: Math.max(1, num(data.w, 32)),
        h: Math.max(1, num(data.h, 32)),
        rotation: num(data.rotation),
        scaleX: num(data.scaleX, 1),
        scaleY: num(data.scaleY, 1),
        opacity: clamp(data.opacity ?? 1, 0, 1),
        components: data.components || {},
        parent: null,
        children: [],
        alive: true,
        worldX: num(data.x),
        worldY: num(data.y),
        prevX: num(data.x),
        prevY: num(data.y),
        body: null,
        contacts: new Set(),
        animation: { name: 'default', time: 0, playing: true, speed: 1, finished: false },
        particles: [],
      };
      this.entities.set(entity.id, entity);
      this.createBody(entity);
      for (const childId of (data.children || [])) {
        const child = this.entities.get(childId);
        if (child) { child.parent = entity; entity.children.push(child); }
      }
      return entity;
    }

    resolveHierarchy() {
      for (const entity of this.entities.values()) {
        entity.parent = entity.parentId ? this.entities.get(entity.parentId) || null : null;
        entity.children = [];
      }
      for (const entity of this.entities.values()) {
        if (entity.parent) entity.parent.children.push(entity);
      }
      this.updateWorldTransforms();
    }

    updateWorldTransforms() {
      const visit = (entity, px, py) => {
        entity.worldX = px + entity.x;
        entity.worldY = py + entity.y;
        for (const child of entity.children) visit(child, entity.worldX, entity.worldY);
      };
      for (const entity of this.entities.values()) {
        if (!entity.parent) visit(entity, 0, 0);
      }
    }

    createBody(entity) {
      if (!this.engine || !root.Matter) return;
      const Matter = root.Matter;
      const rb = entity.components.Rigidbody2D;
      const collider = entity.components.Collider2D;
      if (!rb && !collider) return;
      const shape = collider?.shape || 'rectangle';
      const width = Math.max(1, num(collider?.width, entity.w));
      const height = Math.max(1, num(collider?.height, entity.h));
      const radius = Math.max(1, num(collider?.radius, Math.min(width, height) / 2));
      const options = {
        isStatic: (rb?.bodyType || (collider ? 'static' : 'dynamic')) === 'static',
        isSensor: !!collider?.sensor,
        friction: num(collider?.friction ?? rb?.friction, 0.2),
        restitution: num(collider?.restitution ?? rb?.restitution, 0),
        density: Math.max(0.0001, num(rb?.mass, 1) / Math.max(1, width * height)),
        frictionAir: clamp(num(rb?.linearDamping, 0), 0, 0.99),
        label: entity.id,
        collisionFilter: {
          category: 1 << clamp(num(collider?.layer, 0), 0, 30),
          mask: collider?.mask === undefined ? 0xffffffff : num(collider.mask, 0xffffffff),
        },
      };
      let body;
      if (shape === 'circle') body = Matter.Bodies.circle(entity.worldX + num(collider?.offsetX), entity.worldY + num(collider?.offsetY), radius, options);
      else if (shape === 'capsule') body = Matter.Bodies.rectangle(entity.worldX + num(collider?.offsetX), entity.worldY + num(collider?.offsetY), width, height, { ...options, chamfer: { radius: Math.min(width, height) / 2 } });
      else body = Matter.Bodies.rectangle(entity.worldX + num(collider?.offsetX), entity.worldY + num(collider?.offsetY), width, height, options);
      if (rb?.fixedRotation) Matter.Body.setInertia(body, Infinity);
      if (rb?.bodyType === 'kinematic') {
        body.isStatic = true;
        body.isKinematic = true;
      }
      entity.body = body;
      this.byBody.set(body.id, entity);
      this.bodies.push(body);
      Matter.Composite.add(this.engine.world, body);
      if (rb?.bodyType === 'dynamic' && rb?.gravityScale !== undefined) {
        body.gravityScale = num(rb.gravityScale, 1);
      }
    }

    createTileCollisions() {
      if (!this.engine || !root.Matter || !this.scene) return;
      for (const entity of this.entities.values()) {
        const tilemap = entity.components.Tilemap;
        if (!tilemap || !tilemap.collides || !Array.isArray(tilemap.data)) continue;
        const size = Math.max(4, num(tilemap.tileSize, 32));
        tilemap.data.forEach((row, y) => {
          if (!Array.isArray(row)) return;
          row.forEach((value, x) => {
            if (!value) return;
            const body = root.Matter.Bodies.rectangle(entity.worldX + x * size + size / 2, entity.worldY + y * size + size / 2, size, size, { isStatic: true, friction: 0.2, label: entity.id });
            this.byBody.set(body.id, entity);
            this.bodies.push(body);
            root.Matter.Composite.add(this.engine.world, body);
          });
        });
      }
    }

    entityByIdOrName(value) {
      if (!value) return null;
      if (typeof value === 'object' && value.id) return this.entities.get(value.id) || (value.alive === false ? null : value);
      const text = String(value);
      return this.entities.get(text) || [...this.entities.values()].find((entity) => entity.name === text) || null;
    }

    selfEntity(ctx) {
      return ctx.entity || (ctx.script?.entityId ? this.entityByIdOrName(ctx.script.entityId) : null);
    }

    bodyFor(value, ctx) {
      const entity = this.entityByIdOrName(value) || this.selfEntity(ctx);
      return entity?.body || null;
    }

    async start() {
      if (this.running) return;
      this.running = true;
      await this.loadImages();
      this.setScene(this.project.activeScene || this.project.project.defaultScene);
      this.lastTime = now();
      this.post('cascade-game:ready', { version: VERSION, width: this.project.project.width, height: this.project.project.height });
      if (!this.headless) {
        this.raf = root.requestAnimationFrame((time) => this.loop(time));
      }
    }

    async loadImages() {
      if (this.headless || typeof root.Image !== 'function') return;
      const tasks = [];
      for (const asset of this.project.assets || []) {
        if (asset.type !== 'image' || !asset.src) continue;
        tasks.push(new Promise((resolve) => {
          const image = new root.Image();
          image.onload = () => { this.images.set(asset.id, image); resolve(); };
          image.onerror = () => resolve();
          image.src = asset.src;
        }));
      }
      await Promise.all(tasks);
    }

    stop() {
      this.running = false;
      if (this.raf) root.cancelAnimationFrame(this.raf);
      this.raf = null;
      this.post('cascade-game:stopped');
    }

    pause() {
      this.paused = true;
      this.post('cascade-game:paused');
    }

    resume() {
      this.paused = false;
      this.lastTime = now();
      this.post('cascade-game:resumed');
    }

    restart() {
      this.stop();
      this.start();
    }

    destroy() {
      this.stop();
      this.clearListeners();
      this.clearScene();
      this.destroyed = true;
    }

    resize() {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(2, root.devicePixelRatio || 1);
      this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
      this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
      this.viewScale = Math.min(rect.width / this.project.project.width, rect.height / this.project.project.height);
      this.offsetX = (rect.width - this.project.project.width * this.viewScale) / 2;
      this.offsetY = (rect.height - this.project.project.height * this.viewScale) / 2;
    }

    clientToScreen(clientX, clientY) {
      const rect = this.canvas?.getBoundingClientRect() || { left: 0, top: 0 };
      return {
        x: (clientX - rect.left - this.offsetX) / Math.max(0.0001, this.viewScale),
        y: (clientY - rect.top - this.offsetY) / Math.max(0.0001, this.viewScale),
      };
    }

    clientToWorld(clientX, clientY) {
      const screen = this.clientToScreen(clientX, clientY);
      return {
        x: (screen.x - this.project.project.width / 2) / this.camera.zoom + this.camera.x,
        y: (screen.y - this.project.project.height / 2) / this.camera.zoom + this.camera.y,
      };
    }

    loop(time) {
      if (!this.running) return;
      const delta = Math.min(0.1, Math.max(0, (time - this.lastTime) / 1000));
      this.lastTime = time;
      this.frameTime = delta * 1000;
      if (!this.paused) this.update(delta);
      this.render();
      this.frame += 1;
      if (delta > 0) this.fps = Math.round(1 / delta);
      if (this.frame % 30 === 0) this.post('cascade-game:profiler', { fps: this.fps, entities: this.entities.size, bodies: this.engine ? (root.Matter?.Composite?.allBodies?.(this.engine.world)?.length || 0) : 0, scripts: this.project.scripts.length, scriptMs: Math.round(this.scriptTime || 0) });
      this.raf = root.requestAnimationFrame((next) => this.loop(next));
    }

    stepFrame(seconds = 1 / 60) {
      if (!this.running) {
        this.loadImages().then(() => this.setScene(this.project.activeScene)).catch((error) => this.log(error.message, 'error'));
        this.running = true;
      }
      this.update(Math.max(1 / 240, Math.min(0.1, seconds)));
      this.render();
      this.post('cascade-game:stepped', { frame: this.frame });
    }

    update(dt) {
      const start = now();
      this.input.beginFrame();
      this.frame += 0;
      this.sceneTime += dt;
      this.totalTime += dt;
      this.input.pointer = { x: this.input.pointer.x, y: this.input.pointer.y, down: this.input.pointer.down, justDown: this.input.pointer.justDown, justUp: this.input.pointer.justUp };
      this.updateCamera(dt);
      this.updateAnimations(dt);
      this.updateParticles(dt);
      const physicsStart = now();
      if (this.engine) {
        const fixed = Math.max(1 / 240, num(this.project.project.physicsTimestep, 1 / 60));
        this.accumulator += dt;
        let steps = 0;
        while (this.accumulator >= fixed && steps < 5) {
          this.runScripts('fixedUpdate', dt);
          this.syncBodiesToPhysics();
          try { root.Matter.Engine.update(this.engine, fixed * 1000); } catch (error) { this.log(error.message, 'error'); }
          this.accumulator -= fixed;
          steps += 1;
        }
        this.syncPhysicsToBodies();
      } else {
        this.updateTransformsFallback(dt);
      }
      this.physicsTime = now() - physicsStart;
      this.updateWorldTransforms();
      this.followCamera(dt, true);
      const scriptStart = now();
      this.runScripts('update', dt);
      this.runCode('update', dt);
      this.scriptTime = now() - scriptStart;
      for (const entity of this.entities.values()) {
        entity.prevX = entity.x;
        entity.prevY = entity.y;
      }
      this.input.afterFrame();
      this.renderTime = now() - start;
    }

    updateTransformsFallback(dt) {
      for (const entity of this.entities.values()) {
        const rb = entity.components.Rigidbody2D;
        if (rb?.bodyType === 'dynamic') {
          entity.vy = num(entity.vy, 0) + num(this.scene?.gravity?.y, 980) * dt;
          entity.x += num(entity.vx, 0) * dt;
          entity.y += num(entity.vy, 0) * dt;
        }
      }
    }

    syncBodiesToPhysics() {
      if (!this.engine || !root.Matter) return;
      for (const entity of this.entities.values()) {
        if (!entity.body || !entity.alive) continue;
        const rb = entity.components.Rigidbody2D;
        if (rb?.bodyType === 'kinematic' && (entity.vx || entity.vy)) {
          root.Matter.Body.setVelocity(entity.body, { x: num(entity.vx), y: num(entity.vy) });
        }
      }
    }

    syncPhysicsToBodies() {
      for (const entity of this.entities.values()) {
        if (!entity.body) continue;
        entity.x = entity.body.position.x - (entity.parent?.worldX || 0);
        entity.y = entity.body.position.y - (entity.parent?.worldY || 0);
        entity.rotation = (entity.body.angle * 180) / Math.PI;
      }
    }

    updateCamera(dt) {
      this.camera.shakeTime = Math.max(0, this.camera.shakeTime - dt);
      this.camera.shake *= this.camera.shakeTime > 0 ? 0.92 : 0;
      this.followCamera(dt, false);
    }

    followCamera(dt, smooth) {
      const target = this.entityByIdOrName(this.camera.follow || this.cameraEntity?.components?.Camera2D?.follow);
      if (!target) return;
      const amount = smooth ? clamp(this.camera.smoothing, 0, 1) : Math.min(1, dt * 10);
      this.camera.x += (target.worldX - this.camera.x) * amount;
      this.camera.y += (target.worldY - this.camera.y) * amount;
      if (this.camera.bounds) {
        const halfW = this.project.project.width / 2 / this.camera.zoom;
        const halfH = this.project.project.height / 2 / this.camera.zoom;
        this.camera.x = clamp(this.camera.x, this.camera.bounds.x + halfW, this.camera.bounds.x + this.camera.bounds.w - halfW);
        this.camera.y = clamp(this.camera.y, this.camera.bounds.y + halfH, this.camera.bounds.y + this.camera.bounds.h - halfH);
      }
    }

    updateAnimations(dt) {
      for (const entity of this.entities.values()) {
        const animated = entity.components.AnimatedSprite;
        if (!animated) continue;
        const state = entity.animation;
        if (!state.playing) continue;
        state.time += dt * num(animated.fps, 10) * num(state.speed, 1);
        const frames = String(animated.frames || '').split(',').map((id) => id.trim()).filter(Boolean);
        if (!frames.length) continue;
        const frame = Math.floor(state.time);
        if (frame >= frames.length) {
          if (animated.loop !== false) state.time %= frames.length;
          else { state.finished = true; state.playing = false; this.runScripts('animationFinished', dt, { name: state.name }); }
        }
      }
    }

    updateParticles(dt) {
      for (let i = this.particles.length - 1; i >= 0; i -= 1) {
        const particle = this.particles[i];
        particle.life -= dt;
        if (particle.life <= 0) { this.particles.splice(i, 1); continue; }
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += particle.gravity * dt;
        particle.rotation += particle.spin * dt;
      }
      for (const entity of this.entities.values()) {
        const emitter = entity.components.ParticleEmitter;
        if (!emitter) continue;
        if (emitter.burst) {
          this.spawnParticles(entity, emitter, Math.max(1, num(emitter.burst, 8)));
          emitter.burst = 0;
        }
        emitter._accum = num(emitter._accum) + dt * Math.max(0, num(emitter.rate, 18));
        const count = Math.floor(emitter._accum);
        emitter._accum -= count;
        if (count > 0) this.spawnParticles(entity, emitter, count);
      }
    }

    spawnParticles(entity, emitter, count) {
      const presets = {
        sparks: { colors: ['#fbbf24', '#f97316'], size: 3, speed: 120, gravity: 420, life: 0.7 },
        fire: { colors: ['#f97316', '#ef4444', '#fbbf24'], size: 5, speed: 45, gravity: -90, life: 1.1 },
        smoke: { colors: ['#71717a', '#52525b'], size: 9, speed: 20, gravity: -40, life: 1.5 },
        rain: { colors: ['#93c5fd'], size: 2, speed: 260, gravity: 120, life: 1.2 },
        snow: { colors: ['#f8fafc'], size: 3, speed: 35, gravity: 35, life: 2.2 },
        magic: { colors: ['#c084fc', '#f472b6', '#67e8f9'], size: 4, speed: 70, gravity: -10, life: 1.1 },
        explosion: { colors: ['#fbbf24', '#f97316', '#ef4444'], size: 6, speed: 220, gravity: 120, life: 0.8 },
        dust: { colors: ['#a1a1aa', '#d4d4d8'], size: 3, speed: 26, gravity: 10, life: 0.9 },
      };
      const preset = presets[emitter.preset] || presets.sparks;
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (num(emitter.speed, preset.speed) || preset.speed) * (0.4 + Math.random());
        this.particles.push({
          x: entity.worldX + (Math.random() - 0.5) * entity.w,
          y: entity.worldY + (Math.random() - 0.5) * entity.h,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          gravity: num(emitter.gravity, preset.gravity),
          life: Math.max(0.05, num(emitter.lifetime, preset.life) * (0.6 + Math.random() * 0.8)),
          maxLife: Math.max(0.05, num(emitter.lifetime, preset.life)),
          size: Math.max(1, num(emitter.size, preset.size)),
          color: emitter.color || preset.colors[Math.floor(Math.random() * preset.colors.length)],
          rotation: Math.random() * 6.28,
          spin: (Math.random() - 0.5) * 8,
        });
      }
    }

    handleCollisions(pairs, trigger) {
      const seen = new Set();
      for (const pair of pairs) {
        const a = this.byBody.get(pair.bodyA?.id);
        const b = this.byBody.get(pair.bodyB?.id);
        if (!a || !b) continue;
        if (trigger === 'collisionEnter' && (a.body?.isSensor || b.body?.isSensor)) {
          // Sensors still fire collision events, but do not count as ground.
        }
        a.contacts.add(b.id);
        b.contacts.add(a.id);
        if (trigger === 'collisionExit') { a.contacts.delete(b.id); b.contacts.delete(a.id); }
        for (const [self, other] of [[a, b], [b, a]]) {
          for (const script of this.scripts.values()) {
            if (script.type === 'code') continue;
            if (script.entityId && script.entityId !== self.id) continue;
            const graph = script.graph;
            const eventNode = (graph.nodes || []).find((node) => node.type === (trigger === 'collisionEnter' ? 'event.collisionEnter' : 'event.collisionExit'));
            if (!eventNode) continue;
            const filter = eventNode.config?.tagFilter;
            if (filter && !(other.tags || []).includes(String(filter))) continue;
            const key = `${script.id}:${trigger}:${self.id}:${other.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            this.runVisual(script, trigger, self, { other, tag: other.tags?.[0] || '' }).catch((error) => this.log(error.message, 'error'));
          }
        }
      }
    }

    onPointer(kind) {
      this.pointer = { ...this.pointer, x: this.input.pointer.x, y: this.input.pointer.y, down: kind === 'down' };
      this.uiHit = this.hitUI(this.input.pointer.screenX || 0, this.input.pointer.screenY || 0);
      if (kind === 'down' && this.uiHit) {
        for (const script of this.scripts.values()) {
          if (script.type === 'code') continue;
          if (!(script.graph.nodes || []).some((node) => node.type === 'event.uiClick')) continue;
          this.runVisual(script, 'uiClick', script.entityId ? this.entityByIdOrName(script.entityId) : null, { clicked: this.uiHit }).catch((error) => this.log(error.message, 'error'));
        }
      }
      this.runCodeEvent('pointer', { kind });
      this.audio.context();
    }

    hitUI(x, y) {
      for (const entity of this.entities.values()) {
        const ui = entity.components.UIElement;
        if (!ui || !ui.clickable || ui.visible === false || !entity.visible) continue;
        const rect = this.uiRect(entity);
        if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return entity;
      }
      return null;
    }

    uiRect(entity) {
      const ui = entity.components.UIElement;
      const w = num(ui.w, 180);
      const h = num(ui.h, 44);
      const x = num(ui.x, 16);
      const y = num(ui.y, 16);
      const width = this.project.project.width;
      let left = x;
      if (ui.anchor === 'top-center') left = width / 2 - w / 2 + x;
      if (ui.anchor === 'top-right') left = width - w - x;
      if (ui.anchor === 'center') left = width / 2 - w / 2 + x;
      return { x: left, y, w, h };
    }

    startScripts(trigger) {
      for (const script of this.scripts.values()) {
        if (script.type === 'code' || script.enabled === false) continue;
        const node = (script.graph.nodes || []).find((item) => item.type === (trigger === 'start' ? 'event.start' : trigger === 'sceneLoad' ? 'event.sceneLoad' : ''));
        if (!node) continue;
        this.runVisual(script, trigger, script.entityId ? this.entityByIdOrName(script.entityId) : null, {}).catch((error) => this.log(error.message, 'error'));
      }
    }

    startCodeScripts() {
      for (const script of this.scripts.values()) {
        if (script.type !== 'code' || script.enabled === false) continue;
        this.instantiateCode(script);
      }
    }

    runScripts(trigger, dt, event = {}) {
      for (const script of this.scripts.values()) {
        if (script.enabled === false || script.type === 'code') continue;
        if (!(script.graph.nodes || []).some((node) => node.type === `event.${trigger}`)) continue;
        this.runVisual(script, trigger, script.entityId ? this.entityByIdOrName(script.entityId) : null, event, dt).catch((error) => this.log(error.message, 'error'));
      }
    }

    runCode(trigger, dt, event = {}) {
      for (const [scriptId, instance] of this.codeInstances) {
        if (!instance || instance.disabled) continue;
        const method = trigger === 'update' ? 'onUpdate' : trigger === 'start' ? 'onStart' : trigger;
        if (trigger === 'update' && typeof instance.onUpdate !== 'function') continue;
        try {
          if (typeof instance[method] === 'function') instance[method](dt, event);
        } catch (error) {
          this.log(`[script ${scriptId}] ${error.message}`, 'error');
        }
      }
    }

    runCodeEvent(trigger, event) {
      for (const instance of this.codeInstances.values()) {
        if (!instance) continue;
        try { instance[trigger]?.(event); } catch (error) { this.log(error.message, 'error'); }
      }
    }

    instantiateCode(script) {
      if (typeof Function !== 'function' || !script.code.trim()) return null;
      try {
        const api = this.api();
        let instance;
        const source = script.code;
        const classMatch = /(?:export\s+default\s+|return\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(source);
        if (classMatch) {
          let body = source.replace(/export\s+default\s+/g, 'return ').replace(/^\s*export\s+/gm, '');
          if (!/(?:export\s+default\s+|return\s+)class/.test(source)) body += `\nreturn ${classMatch[1]};`;
          const factory = new Function('api', 'entity', `"use strict";\n${body}\n`);
          const built = factory(api, script.entityId ? this.entityByIdOrName(script.entityId) : null);
          if (typeof built !== 'function') throw new Error('The script class could not be instantiated.');
          instance = new built();
          instance.game = this;
          instance.entity = script.entityId ? this.entityByIdOrName(script.entityId) : null;
          if (typeof instance.onStart === 'function') instance.onStart();
        } else {
          const body = new Function('api', 'entity', 'event', 'dt', `"use strict";\n${source}`);
          instance = { update: (dt, event) => body(api, script.entityId ? this.entityByIdOrName(script.entityId) : null, event, dt) };
        }
        this.codeInstances.set(script.id, instance);
        return instance;
      } catch (error) {
        this.log(`[script ${script.id}] ${error.message}`, 'error');
        return null;
      }
    }

    api() {
      const runtime = this;
      return {
        game: runtime,
        scene: runtime.scene,
        root: this.entities.get.bind(this),
        entity: (id) => this.entityByIdOrName(id),
        input: this.input,
        audio: this.audio,
        assets: this.assets,
        vars: this.vars,
        getVar: (name) => this.vars[name],
        setVar: (name, value) => { this.vars[name] = value; },
        setVelocity: (entity, x, y) => this.setVelocity(entity, x, y),
        getVelocity: (entity, axis) => axis === 'y' ? num(entity?.body?.velocity.y, entity?.vy) : num(entity?.body?.velocity.x, entity?.vx),
        isGrounded: (entity) => this.isGrounded(entity),
        applyImpulse: (entity, x, y) => this.applyImpulse(entity, x, y),
        setPosition: (entity, x, y) => this.setPosition(entity, x, y),
        spawn: (prefabId, x, y) => this.spawn(prefabId, x, y),
        destroy: (entity) => this.destroyEntity(entity),
        playSound: (assetId, options) => this.audio.play(assetId, options),
        shake: (intensity, duration) => this.shake(intensity, duration),
        log: (message) => this.log(message),
        win: (message) => this.win(message),
        save: (slot) => this.save(slot),
        load: (slot) => this.load(slot),
        screenToWorld: (x, y) => this.clientToWorld(x, y),
      };
    }

    async runVisual(script, trigger, entity, event = {}, dt = 1 / 60) {
      const graph = script.graph || { nodes: [], edges: [] };
      const triggerType = trigger === 'start' ? 'event.start' : trigger === 'sceneLoad' ? 'event.sceneLoad' : trigger === 'collisionEnter' ? 'event.collisionEnter' : trigger === 'collisionExit' ? 'event.collisionExit' : trigger === 'uiClick' ? 'event.uiClick' : trigger === 'fixedUpdate' ? 'event.fixedUpdate' : trigger === 'destroy' ? 'event.destroy' : trigger === 'keyPressed' ? 'event.keyPressed' : 'event.update';
      const entry = (graph.nodes || []).find((node) => node.type === triggerType);
      if (!entry) return;
      if (trigger === 'keyPressed' && !this.input.justPressed(entry.config?.key || 'Space')) return;
      const ctx = { graph, script, trigger, entity: entity || null, event, dt, vars: this.vars, cache: new Map(), depth: 0 };
      await this.executeChain(this.nextNode(graph, entry.id, 'next'), ctx);
    }

    nextNode(graph, nodeId, pinId = 'next') {
      const edge = (graph.edges || []).find((item) => item.from?.node === nodeId && item.from?.pin === pinId);
      return edge?.to?.node || null;
    }

    async executeChain(nodeId, ctx) {
      let id = nodeId;
      let guard = 0;
      while (id && guard++ < 2000) {
        const node = (ctx.graph.nodes || []).find((item) => item.id === id);
        if (!node) break;
        const result = await this.executeNode(node, ctx);
        if (result?.stop) break;
        const pin = result?.pin || 'next';
        id = this.nextNode(ctx.graph, node.id, pin);
      }
    }

    async executeNode(node, ctx) {
      const type = node.type;
      const cfg = node.config || {};
      const value = (pinId, fallback) => this.readPin(node, pinId, ctx, fallback);
      const target = () => this.entityByIdOrName(value('entity', cfg.entityId)) || this.selfEntity(ctx);
      switch (type) {
        case 'action.branch': return { pin: value('condition', cfg.condition) ? 'true' : 'false' };
        case 'action.loop': {
          const count = Math.min(1000, Math.max(0, Math.floor(num(value('count', cfg.count), 1))));
          for (let i = 0; i < count; i += 1) {
            const body = this.nextNode(ctx.graph, node.id, 'body');
            if (body) await this.executeChain(body, ctx);
          }
          return { pin: 'done' };
        }
        case 'action.wait': {
          const seconds = Math.min(30, Math.max(0, num(value('seconds', cfg.seconds), 0.2)));
          await sleep(seconds * 1000);
          return { pin: 'next' };
        }
        case 'action.gate': return value('open', cfg.open) ? { pin: 'next' } : { stop: true };
        case 'action.doOnce': {
          const key = `once:${ctx.script.id}:${node.id}`;
          if (this.vars[key]) return { stop: true };
          this.vars[key] = true;
          return { pin: 'next' };
        }
        case 'action.setVelocity': {
          const entity = target();
          if (entity) this.setVelocity(entity, value('x', cfg.x), value('y', cfg.y));
          return { pin: 'next' };
        }
        case 'action.applyForce': {
          const entity = target();
          if (entity?.body && root.Matter) root.Matter.Body.applyForce(entity.body, entity.body.position, { x: num(value('x', cfg.x)) * 0.0001, y: num(value('y', cfg.y)) * 0.0001 });
          return { pin: 'next' };
        }
        case 'action.applyImpulse': {
          const entity = target();
          if (entity) this.applyImpulse(entity, value('x', cfg.x), value('y', cfg.y));
          return { pin: 'next' };
        }
        case 'action.setPosition': {
          const entity = target();
          if (entity) this.setPosition(entity, value('x', cfg.x), value('y', cfg.y));
          return { pin: 'next' };
        }
        case 'action.translate': {
          const entity = target();
          if (entity) this.setPosition(entity, entity.x + num(value('x', cfg.x)), entity.y + num(value('y', cfg.y)));
          return { pin: 'next' };
        }
        case 'action.setRotation': {
          const entity = target();
          if (entity) { entity.rotation = num(value('value', cfg.value)); if (entity.body && root.Matter) root.Matter.Body.setAngle(entity.body, entity.rotation * Math.PI / 180); }
          return { pin: 'next' };
        }
        case 'action.setScale': {
          const entity = target();
          if (entity) { entity.scaleX = num(value('x', cfg.x), 1); entity.scaleY = num(value('y', cfg.y), 1); }
          return { pin: 'next' };
        }
        case 'action.lookAt': {
          const entity = target();
          const other = this.entityByIdOrName(value('target', cfg.target));
          if (entity && other) entity.rotation = Math.atan2(other.worldY - entity.worldY, other.worldX - entity.worldX) * 180 / Math.PI;
          return { pin: 'next' };
        }
        case 'action.setGravityScale': {
          const entity = target();
          if (entity?.body) entity.body.gravityScale = num(value('value', cfg.value), 1);
          return { pin: 'next' };
        }
        case 'action.spawn': {
          const spawned = this.spawn(cfg.prefabId, num(value('x', cfg.x)), num(value('y', cfg.y)));
          ctx.cache.set(`${node.id}:entity`, spawned);
          return { pin: 'next' };
        }
        case 'action.destroy': {
          const entity = this.entityByIdOrName(value('entity', cfg.entityId));
          if (entity) this.destroyEntity(entity);
          return { pin: 'next' };
        }
        case 'action.setVisible': {
          const entity = target();
          if (entity) entity.visible = !!value('visible', cfg.visible);
          return { pin: 'next' };
        }
        case 'action.setUIText': {
          const entity = this.entityByIdOrName(value('entity', cfg.entityId));
          if (entity?.components.UIElement) entity.components.UIElement.text = str(value('text', cfg.text));
          return { pin: 'next' };
        }
        case 'action.setUIBinding': {
          const entity = this.entityByIdOrName(value('entity', cfg.entityId));
          if (entity?.components.UIElement) { entity.components.UIElement.binding = str(cfg.binding); entity.components.UIElement.prefix = str(cfg.prefix); }
          return { pin: 'next' };
        }
        case 'action.setUIValue': {
          const entity = this.entityByIdOrName(value('entity', cfg.entityId));
          if (entity?.components.UIElement) entity.components.UIElement.value = clamp(value('value', cfg.value), 0, 1);
          return { pin: 'next' };
        }
        case 'action.showUI': {
          const entity = this.entityByIdOrName(value('entity', cfg.entityId));
          if (entity?.components.UIElement) { entity.components.UIElement.visible = true; entity.visible = true; }
          return { pin: 'next' };
        }
        case 'action.hideUI': {
          const entity = this.entityByIdOrName(value('entity', cfg.entityId));
          if (entity?.components.UIElement) { entity.components.UIElement.visible = false; entity.visible = false; }
          return { pin: 'next' };
        }
        case 'action.cameraFollow': {
          const entity = this.entityByIdOrName(value('entity', cfg.entityId));
          this.camera.follow = entity?.id || null;
          return { pin: 'next' };
        }
        case 'action.cameraShake': this.shake(value('intensity', cfg.intensity), value('duration', cfg.duration)); return { pin: 'next' };
        case 'action.cameraZoom': this.camera.zoom = clamp(value('value', cfg.value), 0.1, 8); return { pin: 'next' };
        case 'action.setCameraBounds': this.camera.bounds = { x: num(value('x', cfg.x)), y: num(value('y', cfg.y)), w: num(value('w', cfg.w)), h: num(value('h', cfg.h)) }; return { pin: 'next' };
        case 'action.playAnimation': {
          const entity = this.entityByIdOrName(value('entity', cfg.entityId)) || this.selfEntity(ctx);
          if (entity) { entity.animation.name = cfg.name || 'default'; entity.animation.time = 0; entity.animation.playing = true; entity.animation.finished = false; }
          return { pin: 'next' };
        }
        case 'action.stopAnimation': {
          const entity = this.entityByIdOrName(value('entity', cfg.entityId)) || this.selfEntity(ctx);
          if (entity) { entity.animation.playing = false; entity.animation.time = 0; }
          return { pin: 'next' };
        }
        case 'action.pauseAnimation': {
          const entity = this.entityByIdOrName(value('entity', cfg.entityId)) || this.selfEntity(ctx);
          if (entity) entity.animation.playing = false;
          return { pin: 'next' };
        }
        case 'action.setAnimationSpeed': {
          const entity = this.entityByIdOrName(value('entity', cfg.entityId)) || this.selfEntity(ctx);
          if (entity) entity.animation.speed = num(value('value', cfg.value), 1);
          return { pin: 'next' };
        }
        case 'action.playSound': this.audio.play(cfg.assetId, { volume: num(cfg.volume, 1), loop: !!cfg.loop, bus: 'sfx' }).catch(() => {}); return { pin: 'next' };
        case 'action.stopSound': this.audio.stop(cfg.assetId); return { pin: 'next' };
        case 'action.setVolume': this.audio.setVolume(value('value', cfg.value)); return { pin: 'next' };
        case 'action.setPitch': this.audio.setPitch(value('value', cfg.value)); return { pin: 'next' };
        case 'action.playMusic': this.audio.play(cfg.assetId, { volume: 1, loop: true, bus: 'music' }).catch(() => {}); return { pin: 'next' };
        case 'action.fadeAudio': {
          const targetVolume = clamp(value('value', cfg.value), 0, 1);
          const duration = Math.max(0.01, num(cfg.duration, 1));
          const started = now();
          const tick = () => {
            const t = Math.min(1, (now() - started) / (duration * 1000));
            this.audio.setMaster(this.audio.master * (1 - t) + targetVolume * t);
            if (t < 1) setTimeout(tick, 40);
          };
          tick();
          return { pin: 'next' };
        }
        case 'variable.set': this.vars[cfg.name || 'value'] = value('value', cfg.value); this.notifyUI(); return { pin: 'next' };
        case 'variable.add': this.vars[cfg.name || 'score'] = num(this.vars[cfg.name || 'score'], 0) + num(value('amount', cfg.amount), 1); this.notifyUI(); return { pin: 'next' };
        case 'action.save': this.save(cfg.slot || 'slot1'); return { pin: 'next' };
        case 'action.load': this.load(cfg.slot || 'slot1'); return { pin: 'next' };
        case 'action.deleteSave': { try { root.localStorage?.removeItem(this.saveKey(cfg.slot || 'slot1')); } catch { /* storage disabled */ } return { pin: 'next' }; }
        case 'action.log': this.log(str(value('message', cfg.message)), 'log'); return { pin: 'next' };
        case 'action.win': this.win(str(value('message', cfg.message), 'You win!')); return { stop: true };
        case 'action.raycast': {
          const start = this.selfEntity(ctx) || ctx.entity;
          const origin = start ? vec(start.worldX, start.worldY) : vec(0, 0);
          const end = vec(origin.x + num(value('dx', cfg.dx), 100), origin.y + num(value('dy', cfg.dy), 0));
          let hit = null;
          if (root.Matter && this.bodies.length) {
            const hits = root.Matter.Query.ray(this.bodies, origin, end, 1);
            hit = hits.map((item) => this.byBody.get(item.body.id)).find((entity) => entity && entity !== start) || null;
          }
          ctx.cache.set(`${node.id}:hit`, !!hit);
          ctx.cache.set(`${node.id}:entity`, hit);
          return { pin: 'next' };
        }
        default: return { pin: 'next' };
      }
    }

    readPin(node, pinId, ctx, fallback) {
      const edge = (ctx.graph.edges || []).find((item) => item.to?.node === node.id && item.to?.pin === pinId);
      if (edge) {
        const source = (ctx.graph.nodes || []).find((item) => item.id === edge.from.node);
        if (source) return this.evalOutput(source, edge.from.pin, ctx);
      }
      if (node.config && Object.prototype.hasOwnProperty.call(node.config, pinId)) return node.config[pinId];
      const field = (node.config || {})[pinId];
      if (field !== undefined) return field;
      return fallback;
    }

    evalOutput(node, pinId, ctx) {
      const key = `${node.id}:${pinId}`;
      if (ctx.cache.has(key)) return ctx.cache.get(key);
      const cfg = node.config || {};
      let result;
      switch (node.type) {
        case 'input.axis': result = this.input.axis(cfg.action || 'horizontal'); break;
        case 'input.keyHeld': result = this.input.held(cfg.key || 'Space'); break;
        case 'input.keyPressed': result = this.input.justPressed(cfg.key || 'Space'); break;
        case 'input.mouseX': result = this.input.pointer.x; break;
        case 'input.mouseY': result = this.input.pointer.y; break;
        case 'input.mouseDown': result = this.input.pointer.down; break;
        case 'input.gamepadButton': result = this.input.button(cfg.button); break;
        case 'input.gamepadAxis': result = this.input.padAxis(cfg.axis); break;
        case 'input.touch': result = this.input.touch; break;
        case 'data.self': result = this.selfEntity(ctx); break;
        case 'data.find': result = this.entityByIdOrName(cfg.name); break;
        case 'data.position': {
          const entity = this.entityByIdOrName(this.readPin(node, 'entity', ctx, cfg.entityId)) || this.selfEntity(ctx);
          result = pinId === 'x' ? num(entity?.worldX) : num(entity?.worldY);
          break;
        }
        case 'data.velocity': {
          const entity = this.entityByIdOrName(this.readPin(node, 'entity', ctx, cfg.entityId)) || this.selfEntity(ctx);
          result = pinId === 'x' ? num(entity?.body?.velocity.x, entity?.vx) : num(entity?.body?.velocity.y, entity?.vy);
          break;
        }
        case 'data.rotation': result = num((this.entityByIdOrName(this.readPin(node, 'entity', ctx, cfg.entityId)) || this.selfEntity(ctx))?.rotation); break;
        case 'data.scale': {
          const entity = this.entityByIdOrName(this.readPin(node, 'entity', ctx, cfg.entityId)) || this.selfEntity(ctx);
          result = pinId === 'x' ? num(entity?.scaleX, 1) : num(entity?.scaleY, 1);
          break;
        }
        case 'data.children': result = [...(this.entityByIdOrName(this.readPin(node, 'entity', ctx, cfg.entityId)) || this.selfEntity(ctx))?.children || []]; break;
        case 'data.distance': {
          const a = this.entityByIdOrName(this.readPin(node, 'a', ctx));
          const b = this.entityByIdOrName(this.readPin(node, 'b', ctx));
          result = a && b ? Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY) : 0;
          break;
        }
        case 'data.rigidbody': result = !!(this.entityByIdOrName(this.readPin(node, 'entity', ctx, cfg.entityId)) || this.selfEntity(ctx))?.body; break;
        case 'data.grounded': {
          const entity = this.entityByIdOrName(this.readPin(node, 'entity', ctx, cfg.entityId)) || this.selfEntity(ctx);
          if (!entity) { result = false; break; }
          if (entity.contacts.size) result = [...entity.contacts].some((id) => {
            const other = this.entities.get(id);
            return other?.body?.isStatic && other.worldY > entity.worldY;
          });
          else if (entity.body && root.Matter) {
            const start = { x: entity.body.position.x, y: entity.body.position.y + entity.h / 2 };
            const end = { x: start.x, y: start.y + 5 };
            result = root.Matter.Query.ray(this.bodies.filter((body) => body !== entity.body && body.isStatic), start, end, 1).length > 0;
          } else result = false;
          break;
        }
        case 'data.compare': {
          const a = this.readPin(node, 'a', ctx, cfg.a);
          const b = this.readPin(node, 'b', ctx, cfg.b);
          switch (cfg.op) {
            case '==': result = a == b; break; // eslint-disable-line eqeqeq
            case '!=': result = a != b; break; // eslint-disable-line eqeqeq
            case '>': result = a > b; break;
            case '>=': result = a >= b; break;
            case '<': result = a < b; break;
            case '<=': result = a <= b; break;
            default: result = false;
          }
          break;
        }
        case 'data.math': {
          const a = num(this.readPin(node, 'a', ctx, cfg.a));
          const b = num(this.readPin(node, 'b', ctx, cfg.b));
          result = cfg.op === 'sub' ? a - b : cfg.op === 'mul' ? a * b : cfg.op === 'div' ? (b ? a / b : 0) : cfg.op === 'min' ? Math.min(a, b) : cfg.op === 'max' ? Math.max(a, b) : a + b;
          break;
        }
        case 'data.random': result = Math.random() * (num(this.readPin(node, 'max', ctx, cfg.max), 1) - num(this.readPin(node, 'min', ctx, cfg.min), 0)) + num(this.readPin(node, 'min', ctx, cfg.min), 0); break;
        case 'data.and': result = !!this.readPin(node, 'a', ctx, cfg.a) && !!this.readPin(node, 'b', ctx, cfg.b); break;
        case 'data.or': result = !!this.readPin(node, 'a', ctx, cfg.a) || !!this.readPin(node, 'b', ctx, cfg.b); break;
        case 'data.not': result = !this.readPin(node, 'a', ctx, cfg.a); break;
        case 'data.string': result = str(cfg.text).replace(/\{\{(\w+)\}\}/g, (_, name) => str(this.vars[name])); break;
        case 'variable.get': result = this.vars[cfg.name] ?? 0; break;
        case 'data.screenToWorld': {
          const point = this.clientToWorld(num(this.readPin(node, 'x', ctx, cfg.x)), num(this.readPin(node, 'y', ctx, cfg.y)));
          result = pinId === 'x' ? point.x : point.y;
          break;
        }
        case 'event.collisionEnter':
        case 'event.collisionExit': result = pinId === 'other' ? ctx.event.other : pinId === 'tag' ? ctx.event.tag || ctx.event.other?.tags?.[0] || '' : null; break;
        case 'event.uiClick': result = pinId === 'clicked' ? ctx.event.clicked : null; break;
        case 'event.keyPressed': result = this.input.justPressed(cfg.key || 'Space'); break;
        case 'action.spawn': result = ctx.cache.get(`${node.id}:entity`) || null; break;
        case 'action.raycast': result = pinId === 'hit' ? !!ctx.cache.get(`${node.id}:hit`) : ctx.cache.get(`${node.id}:entity`) || null; break;
        default: result = cfg[pinId] ?? null;
      }
      ctx.cache.set(key, result);
      return result;
    }

    isGrounded(entity) {
      if (!entity) return false;
      if (entity.contacts?.size) {
        return [...entity.contacts].some((id) => {
          const other = this.entities.get(id);
          return other?.body?.isStatic && other.worldY > entity.worldY;
        });
      }
      if (entity.body && root.Matter) {
        const start = { x: entity.body.position.x, y: entity.body.position.y + entity.h / 2 };
        const end = { x: start.x, y: start.y + 5 };
        return root.Matter.Query.ray(this.bodies.filter((body) => body !== entity.body && body.isStatic), start, end, 1).length > 0;
      }
      return false;
    }

    setVelocity(entity, x, y) {
      if (!entity) return;
      if (entity.body && root.Matter) root.Matter.Body.setVelocity(entity.body, { x: num(x), y: num(y) });
      else { entity.vx = num(x); entity.vy = num(y); }
    }

    applyImpulse(entity, x, y) {
      if (entity?.body && root.Matter) root.Matter.Body.applyForce(entity.body, entity.body.position, { x: num(x) * 0.0002, y: num(y) * 0.0002 });
      else if (entity) { entity.vx = num(entity.vx) + num(x); entity.vy = num(entity.vy) + num(y); }
    }

    setPosition(entity, x, y) {
      if (!entity) return;
      entity.x = num(x);
      entity.y = num(y);
      if (entity.body && root.Matter) root.Matter.Body.setPosition(entity.body, { x: entity.x + (entity.parent?.worldX || 0), y: entity.y + (entity.parent?.worldY || 0) });
    }

    spawn(prefabId, x, y) {
      const prefab = (this.project.prefabs || []).find((item) => item.id === prefabId || item.name === prefabId);
      if (!prefab) { this.log(`Prefab not found: ${prefabId}`, 'warn'); return null; }
      const data = JSON.parse(JSON.stringify(prefab.entity));
      data.id = `spawn_${Math.random().toString(36).slice(2, 9)}`;
      data.name = prefab.name || data.name;
      data.x = num(x, data.x);
      data.y = num(y, data.y);
      const entity = this.createEntity(data);
      this.resolveHierarchy();
      return entity;
    }

    destroyEntity(entity) {
      if (!entity || !entity.alive) return;
      entity.alive = false;
      this.runVisualForEntity(entity, 'destroy', {}).catch(() => {});
      if (entity.body && this.engine) {
        root.Matter.Composite.remove(this.engine.world, entity.body);
        this.byBody.delete(entity.body.id);
        this.bodies = this.bodies.filter((body) => body !== entity.body);
      }
      this.entities.delete(entity.id);
      for (const child of [...(entity.children || [])]) this.destroyEntity(child);
    }

    async runVisualForEntity(entity, trigger, event) {
      for (const script of this.scripts.values()) {
        if (script.entityId !== entity.id || script.type === 'code') continue;
        await this.runVisual(script, trigger, entity, event);
      }
    }

    notifyUI() {
      for (const entity of this.entities.values()) {
        const ui = entity.components.UIElement;
        if (!ui?.binding) continue;
        ui._resolved = `${ui.prefix || ''}${this.vars[ui.binding] ?? 0}`;
      }
    }

    shake(intensity = 8, duration = 0.3) {
      this.camera.shake = Math.max(this.camera.shake, num(intensity, 8));
      this.camera.shakeTime = Math.max(this.camera.shakeTime, num(duration, 0.3));
    }

    win(message = 'You win!') {
      this.won = true;
      this.winMessage = str(message, 'You win!');
      this.paused = true;
      this.post('cascade-game:win', { message: this.winMessage });
    }

    saveKey(slot) {
      return `cascade-game:${this.project.project.name || 'game'}:${slot || 'slot1'}`;
    }

    save(slot = 'slot1') {
      try {
        root.localStorage?.setItem(this.saveKey(slot), JSON.stringify({ version: 1, vars: this.vars, scene: this.scene?.id, savedAt: new Date().toISOString() }));
        this.log(`Saved ${slot}`, 'log');
      } catch (error) { this.log(`Save failed: ${error.message}`, 'error'); }
    }

    load(slot = 'slot1') {
      try {
        const raw = root.localStorage?.getItem(this.saveKey(slot));
        if (!raw) { this.log(`No save in ${slot}`, 'warn'); return false; }
        const data = JSON.parse(raw);
        if (!data || data.version !== 1 || typeof data.vars !== 'object') throw new Error('invalid save');
        this.vars = { ...this.vars, ...data.vars };
        if (data.scene && data.scene !== this.scene?.id) this.setScene(data.scene);
        this.notifyUI();
        this.log(`Loaded ${slot}`, 'log');
        return true;
      } catch (error) { this.log(`Load failed: ${error.message}`, 'error'); return false; }
    }

    hasCodeScripts() {
      return [...this.scripts.values()].some((script) => script.type === 'code');
    }

    register(id, trigger, entityId) {
      // Scripts are registered by the host before start; kept for generated
      // compiler manifests that call attachScripts(game).
      const existing = this.scripts.get(id);
      if (existing) existing.triggers = [...new Set([...(existing.triggers || []), trigger])];
      else this.scripts.set(id, { id, trigger, entityId, graph: { nodes: [], edges: [] }, type: 'visual' });
    }

    setScripts(scripts) {
      this.scripts = new Map();
      for (const script of scripts || []) this.scripts.set(script.id, script);
    }

    render() {
      if (!this.ctx) return;
      const canvas = this.canvas;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.round(rect.width * this.dpr) || canvas.height !== Math.round(rect.height * this.dpr)) this.resize();
      const ctx = this.ctx;
      const width = rect.width;
      const height = rect.height;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#050508';
      ctx.fillRect(0, 0, width, height);
      const scale = this.viewScale;
      const viewW = this.project.project.width;
      const viewH = this.project.project.height;
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.offsetX, this.offsetY, viewW * scale, viewH * scale);
      ctx.clip();
      ctx.translate(this.offsetX + (viewW * scale) / 2, this.offsetY + (viewH * scale) / 2);
      const shake = this.camera.shake > 0 ? this.camera.shake : 0;
      const shakeX = shake ? (Math.random() - 0.5) * shake : 0;
      const shakeY = shake ? (Math.random() - 0.5) * shake : 0;
      ctx.scale(scale * this.camera.zoom, scale * this.camera.zoom);
      ctx.translate(-this.camera.x + shakeX, -this.camera.y + shakeY);
      ctx.fillStyle = this.scene?.background || this.project.project.background || '#0b0b12';
      ctx.fillRect(this.camera.x - viewW / this.camera.zoom, this.camera.y - viewH / this.camera.zoom, viewW * 2 / this.camera.zoom, viewH * 2 / this.camera.zoom);
      this.drawCalls = 0;
      const drawable = [...this.entities.values()].filter((entity) => entity.visible).sort((a, b) => (num(a.layer) - num(b.layer)) || (num(a.zIndex) - num(b.zIndex)));
      for (const entity of drawable) this.drawEntity(ctx, entity);
      this.drawParticles(ctx);
      if (this.debug) this.drawDebug(ctx);
      ctx.restore();
      this.drawUI(ctx);
      if (this.won) this.drawWin(ctx, width, height);
    }

    drawEntity(ctx, entity) {
      if (entity.opacity <= 0 || !entity.visible) return;
      const sprite = entity.components.SpriteRenderer;
      const animated = entity.components.AnimatedSprite;
      const text = entity.components.TextRenderer;
      const tilemap = entity.components.Tilemap;
      const light = entity.components.Light2D;
      const ui = entity.components.UIElement;
      ctx.save();
      ctx.globalAlpha = entity.opacity;
      ctx.translate(entity.worldX, entity.worldY);
      ctx.rotate((num(entity.rotation) * Math.PI) / 180);
      ctx.scale(num(entity.scaleX, 1), num(entity.scaleY, 1));
      if (tilemap) this.drawTilemap(ctx, tilemap, entity);
      if (sprite) {
        const imageId = sprite.assetId || (animated ? String(animated.frames || '').split(',')[0].trim() : '');
        const image = imageId ? this.images.get(imageId) : null;
        const w = num(sprite.width, entity.w);
        const h = num(sprite.height, entity.h);
        if (image) {
          ctx.save();
          if (sprite.flipX) ctx.scale(-1, 1);
          if (sprite.filter === 'nearest') ctx.imageSmoothingEnabled = false;
          ctx.globalAlpha *= clamp(num(sprite.opacity, 1), 0, 1);
          ctx.drawImage(image, -w / 2, -h / 2, w, h);
          ctx.restore();
        } else {
          ctx.fillStyle = sprite.color || '#e11d48';
          ctx.beginPath();
          if (sprite.shape === 'circle') ctx.arc(0, 0, Math.min(w, h) / 2, 0, Math.PI * 2);
          else if (sprite.shape === 'capsule') { const r = Math.min(w, h) / 2; ctx.roundRect(-w / 2, -h / 2, w, h, r); }
          else ctx.rect(-w / 2, -h / 2, w, h);
          ctx.fill();
        }
      }
      if (animated && !sprite) {
        const frameIds = String(animated.frames || '').split(',').map((id) => id.trim()).filter(Boolean);
        const frameId = frameIds[Math.floor(entity.animation.time) % Math.max(1, frameIds.length)];
        const image = this.images.get(frameId);
        if (image) ctx.drawImage(image, -entity.w / 2, -entity.h / 2, entity.w, entity.h);
      }
      if (text) {
        ctx.fillStyle = text.color || '#f4f4f5';
        ctx.font = `${num(text.size, 18)}px ${text.font || 'system-ui, sans-serif'}`;
        ctx.textAlign = text.align || 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(str(text.text), 0, 0);
      }
      if (light) {
        ctx.globalCompositeOperation = 'lighter';
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, num(light.radius, 160)));
        const color = light.color || '#fbbf24';
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = clamp(num(light.intensity, 1), 0, 1);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(1, num(light.radius, 160)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      this.drawCalls += 1;
    }

    drawTilemap(ctx, tilemap, entity) {
      const size = Math.max(2, num(tilemap.tileSize, 32));
      const data = Array.isArray(tilemap.data) ? tilemap.data : [];
      ctx.fillStyle = tilemap.color || '#27272a';
      data.forEach((row, y) => {
        if (!Array.isArray(row)) return;
        row.forEach((value, x) => {
          if (!value) return;
          ctx.fillRect(x * size - (num(tilemap.cols, row.length) * size) / 2, y * size - (num(tilemap.rows, data.length) * size) / 2, size - 1, size - 1);
        });
      });
    }

    drawParticles(ctx) {
      for (const particle of this.particles) {
        ctx.save();
        ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
        ctx.fillStyle = particle.color;
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotation);
        ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
        ctx.restore();
      }
    }

    drawDebug(ctx) {
      if (!root.Matter || !this.engine) return;
      ctx.save();
      ctx.lineWidth = 1;
      for (const body of this.engine.world.bodies) {
        ctx.strokeStyle = body.isStatic ? '#38bdf8' : body.isSensor ? '#f472b6' : '#f59e0b';
        ctx.beginPath();
        const vertices = body.vertices || [];
        vertices.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
        if (vertices.length) ctx.closePath();
        ctx.stroke();
        if (!body.isStatic && body.velocity) {
          ctx.strokeStyle = '#4ade80';
          ctx.beginPath();
          ctx.moveTo(body.position.x, body.position.y);
          ctx.lineTo(body.position.x + body.velocity.x * 10, body.position.y + body.velocity.y * 10);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    drawUI(ctx) {
      const scale = this.viewScale;
      const viewW = this.project.project.width;
      const viewH = this.project.project.height;
      const left = this.offsetX;
      const top = this.offsetY;
      ctx.save();
      ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, this.dpr * left, this.dpr * top);
      ctx.translate(0, 0);
      for (const entity of [...this.entities.values()].sort((a, b) => num(a.zIndex) - num(b.zIndex))) {
        const ui = entity.components.UIElement;
        if (!ui || ui.visible === false || entity.visible === false) continue;
        const rect = this.uiRect(entity);
        ctx.save();
        ctx.globalAlpha = clamp(entity.opacity ?? 1, 0, 1);
        if (ui.kind === 'panel') { ctx.fillStyle = ui.fill || '#18181b'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h); }
        else if (ui.kind === 'bar') {
          ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
          ctx.fillStyle = ui.fill || '#22c55e'; ctx.fillRect(rect.x + 2, rect.y + 2, Math.max(0, (rect.w - 4) * clamp(num(ui.value, 1), 0, 1)), rect.h - 4);
        } else if (ui.kind === 'button') {
          ctx.fillStyle = ui.fill || '#e11d48'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
          ctx.fillStyle = ui.color || '#fff'; ctx.font = `600 ${num(ui.size, 18)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(str(ui.text || 'Button'), rect.x + rect.w / 2, rect.y + rect.h / 2);
        } else if (ui.kind === 'image') {
          const image = this.images.get(ui.assetId);
          if (image) ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
        } else {
          ctx.fillStyle = ui.color || '#f4f4f5';
          ctx.font = `${num(ui.size, 20)}px system-ui, sans-serif`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          const text = ui._resolved ?? (ui.binding ? `${ui.prefix || ''}${this.vars[ui.binding] ?? 0}` : ui.text || '');
          const lines = str(text).split('\n');
          lines.forEach((line, index) => ctx.fillText(line, rect.x, rect.y + index * num(ui.size, 20) * 1.2));
        }
        ctx.restore();
        this.drawCalls += 1;
      }
      ctx.restore();
    }

    drawWin(ctx, width, height) {
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = 'rgba(5,5,10,.72)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#f4f4f5';
      ctx.textAlign = 'center';
      ctx.font = '700 34px system-ui, sans-serif';
      ctx.fillText(this.winMessage || 'You win!', width / 2, height / 2 - 14);
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText('Press R to restart', width / 2, height / 2 + 28);
      ctx.restore();
    }
  }

  root.CascadeGame = { Runtime, InputManager, AudioManager, VERSION };

  function boot() {
    const canvas = root.document?.getElementById('game-canvas');
    if (!canvas || !root.__GAME_PROJECT__) return null;
    const runtime = new Runtime(root.__GAME_PROJECT__, canvas);
    const scripts = root.__GAME_PROJECT__.scripts || [];
    runtime.setScripts(scripts);
    runtime.start().catch((error) => runtime.log(error.message, 'error'));
    root.__CASCADE_GAME__ = runtime;
    root.addEventListener('keydown', (event) => {
      if (event.code === 'KeyR' && runtime.won) runtime.restart();
    });
    return runtime;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
