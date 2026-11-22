/* Cascade Game Studio 3D runtime.
   Three.js rendering + Cannon-es rigid bodies + the shared Game Studio graph
   interpreter. Runs in the editor's sandboxed play iframe and in standalone
   exports. No Cascade auth or backend access is required at runtime. */
(function (root) {
  'use strict';

  const T = root.CascadeThree?.THREE || root.THREE;
  const Loaders = root.CascadeThree || {};
  const C = root.CANNON;
  const VERSION = '1.0.0';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const str = (value, fallback = '') => (value === undefined || value === null ? fallback : String(value));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const PRESETS = {
    smoke: { color: '#9ca3af', size: 0.5, speed: 1.1, gravity: -0.2, life: 2.2, opacity: 0.35 },
    dust: { color: '#d6d3d1', size: 0.22, speed: 0.6, gravity: -0.1, life: 1.1, opacity: 0.5 },
    rain: { color: '#93c5fd', size: 0.08, speed: 11, gravity: 4, life: 1.2, opacity: 0.7 },
    snow: { color: '#f8fafc', size: 0.12, speed: 0.9, gravity: 0.15, life: 2.6, opacity: 0.8 },
    sparks: { color: '#fbbf24', size: 0.12, speed: 5, gravity: 4, life: 0.8, opacity: 1 },
    fire: { color: '#fb923c', size: 0.45, speed: 1.2, gravity: 0.8, life: 1.4, opacity: 0.65 },
    magic: { color: '#c084fc', size: 0.25, speed: 2.4, gravity: 0.2, life: 1.5, opacity: 0.85 },
  };

  class Input3D {
    constructor(runtime, canvas) {
      this.runtime = runtime;
      this.canvas = canvas;
      this.down = new Set();
      this.pressed = new Set();
      this.framePressed = new Set();
      this.mouse = { dx: 0, dy: 0, down: false, locked: false };
      this.touch = false;
      this.bind();
    }

    bind() {
      this.runtime.listen(root, 'keydown', (event) => {
        if (typing(event.target)) return;
        if (!this.down.has(event.code)) this.pressed.add(event.code);
        this.down.add(event.code);
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      });
      this.runtime.listen(root, 'keyup', (event) => this.down.delete(event.code));
      this.runtime.listen(root, 'blur', () => { this.down.clear(); this.pressed.clear(); this.framePressed.clear(); });
      this.runtime.listen(this.canvas, 'pointerdown', (event) => {
        this.mouse.down = true;
        this.runtime.audio.unlock();
        if (this.runtime.cameraController === 'firstPerson' && this.canvas.requestPointerLock) this.canvas.requestPointerLock();
        this.runtime.onPointer('down', event);
      });
      this.runtime.listen(root, 'pointerup', () => { this.mouse.down = false; this.runtime.onPointer('up'); });
      this.runtime.listen(root, 'pointermove', (event) => {
        if (document.pointerLockElement === this.canvas) {
          this.mouse.dx += event.movementX || 0;
          this.mouse.dy += event.movementY || 0;
        }
      });
      this.runtime.listen(this.canvas, 'touchstart', (event) => { this.touch = true; this.runtime.onPointer('down', event); }, { passive: true });
      this.runtime.listen(this.canvas, 'touchend', () => { this.touch = false; this.runtime.onPointer('up'); });
      this.runtime.listen(this.canvas, 'contextmenu', (event) => event.preventDefault());
    }

    beginFrame() {
      // Graph execution is async; snapshot presses for the whole frame before
      // clearing the event buffer so key nodes never miss a real keydown.
      this.framePressed = new Set(this.pressed);
      this.pressed.clear();
    }

    held(code) { return this.down.has(code); }
    justPressed(code) { return this.framePressed.has(code); }
    afterFrame() { this.mouse.dx = 0; this.mouse.dy = 0; }

    axis(action) {
      const mapping = this.runtime.project.project.input?.[action] || {};
      if (mapping.axis) {
        const [negative, positive] = String(mapping.axis).split(':');
        const value = (this.held(positive) ? 1 : 0) - (this.held(negative) ? 1 : 0);
        if (value) return value;
      }
      // Older projects (and the original default map) name arrow keys in
      // axis while still listing WASD in keys. Fall back to the full key list
      // so WASD works instead of silently returning zero.
      const keys = Array.isArray(mapping.keys) ? mapping.keys : [];
      const half = Math.max(1, Math.floor(keys.length / 2));
      let value = 0;
      keys.forEach((key, index) => { if (this.held(key)) value += index < half ? -1 : 1; });
      return clamp(value, -1, 1);
    }
  }

  function typing(target) {
    const tag = String(target?.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
  }

  class Audio3D {
    constructor(runtime, assets) {
      this.runtime = runtime;
      this.assets = assets;
      this.ctx = null;
      this.buffers = new Map();
      this.sources = [];
    }

    unlock() {
      if (!this.ctx) {
        const Ctx = root.AudioContext || root.webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = num(this.runtime.project.project.audio?.master, 1);
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    }

    async buffer(assetId) {
      if (this.buffers.has(assetId)) return this.buffers.get(assetId);
      const asset = this.assets.get(assetId);
      if (!asset?.src) return null;
      this.unlock();
      if (!this.ctx) return null;
      try {
        const response = await fetch(asset.src);
        const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
        this.buffers.set(assetId, buffer);
        return buffer;
      } catch { return null; }
    }

    async play(assetId, options = {}) {
      this.unlock();
      const buffer = await this.buffer(assetId);
      if (!buffer || !this.ctx) return null;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = !!options.loop;
      source.playbackRate.value = clamp(options.pitch ?? 1, 0.25, 4);
      const gain = this.ctx.createGain();
      gain.gain.value = clamp(options.volume ?? 1, 0, 1);
      source.connect(gain);
      gain.connect(this.master || this.ctx.destination);
      source.start();
      this.sources.push({ source, gain });
      source.onended = () => { this.sources = this.sources.filter((item) => item.source !== source); };
      return source;
    }

    stop() {
      for (const entry of this.sources) { try { entry.source.stop(); } catch { /* noop */ } }
      this.sources = [];
    }
  }

  class Runtime3D {
    constructor(project, canvas, options = {}) {
      this.project = project;
      this.canvas = canvas;
      this.options = options;
      this.editor = !!options.editor;
      this.headless = !!options.headless || !canvas;
      this.running = false;
      this.paused = false;
      this.destroyed = false;
      this.listeners = [];
      this.entities = new Map();
      this.objects = new Map();
      this.bodies = new Map();
      this.meshes = [];
      this.scripts = new Map();
      this.codeScripts = new Map();
      this.vars = { ...(project.variables || {}) };
      this.assets = new Map((project.assets || []).map((asset) => [asset.id, asset]));
      this.images = new Map();
      this.scene = null;
      this.world = null;
      this.input = new Input3D(this, canvas);
      this.audio = new Audio3D(this, this.assets);
      this.camera = null;
      this.renderer = null;
      this.scene3d = null;
      this.sceneId = null;
      this.cameraController = project.project.controls || 'orbit';
      this.cameraTarget = null;
      this.cameraOffset = new T.Vector3(7, 4, 8);
      this.cameraYaw = Math.PI / 4;
      this.cameraPitch = -0.32;
      this.cameraShake = 0;
      this.cameraShakeTime = 0;
      this.selectedId = null;
      this.selectionHelper = null;
      this.grid = null;
      this.clock = null;
      this.lastTime = 0;
      this.accumulator = 0;
      this.frame = 0;
      this.fps = 0;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      this.frameMs = 0;
      this.renderMs = 0;
      this.physicsMs = 0;
      this.scriptMs = 0;
      this.drawCalls = 0;
      this.won = false;
      this.winMessage = '';
      this.hud = null;
      this.uiEntities = new Map();
      this.gizmo = null;
      this.gizmoMode = 'translate';
      this.gizmoSpace = 'world';
      this.bindParentMessages();
      if (!T || !C) {
        this.missingDependencies = true;
        if (canvas) this.showFatal('3D engine failed to load: Three.js or Cannon is missing.');
        return;
      }
      this.setupRenderer();
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
      try { root.parent.postMessage({ type, ...payload }, '*'); } catch { /* detached */ }
    }

    log(message, level = 'log') {
      const text = str(message);
      this.post('cascade-game:console', { message: text, level, time: Date.now() });
      if (level === 'error') console.error(text);
      else console.log(text);
    }

    showFatal(message) {
      if (!this.canvas) return;
      const host = this.canvas.parentElement || this.canvas;
      const node = root.document.createElement('div');
      node.textContent = message;
      node.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;color:#fecdd3;background:#09090c;padding:24px;font:14px system-ui;text-align:center;z-index:20';
      host.append(node);
    }

    setupRenderer() {
      try {
        this.renderer = new T.WebGLRenderer({ canvas: this.canvas, antialias: this.project.project.render3d?.antialias !== false, alpha: false, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
        this.renderer.setSize(this.canvas.clientWidth || 800, this.canvas.clientHeight || 450, false);
        this.renderer.outputColorSpace = T.SRGBColorSpace;
        this.renderer.toneMapping = T.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = num(this.project.project.render3d?.exposure, 1.05);
        const shadows = this.project.project.render3d?.shadows !== 'off';
        this.renderer.shadowMap.enabled = shadows;
        this.renderer.shadowMap.type = this.project.project.render3d?.shadows === 'high' ? T.PCFSoftShadowMap : T.PCFShadowMap;
        this.scene3d = new T.Scene();
        this.camera = new T.PerspectiveCamera(60, 16 / 9, 0.1, 1200);
        this.camera.position.set(8, 6, 12);
        this.camera.lookAt(0, 1, 0);
        this.scene3d.add(this.camera);
        this.createEnvironment();
        this.createGrid();
        this.clock = { start: performance.now() };
        this.listen(root, 'resize', () => this.resize());
        this.resize();
      } catch (error) {
        this.missingDependencies = true;
        this.log(`WebGL initialization failed: ${error.message}`, 'error');
        this.showFatal('WebGL is unavailable in this browser. Enable hardware acceleration to play 3D games.');
      }
    }

    resize() {
      if (!this.renderer || !this.canvas) return;
      const width = Math.max(1, this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 800);
      const height = Math.max(1, this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 450);
      this.cameraZoom ||= 12;
      this.renderer.setSize(width, height, false);
      if (!this.camera?.isOrthographicCamera) this.camera.aspect = width / height;
      else {
        const zoom = num(this.cameraZoom, 12);
        this.camera.left = -zoom * width / height / 2;
        this.camera.right = zoom * width / height / 2;
        this.camera.top = zoom / 2;
        this.camera.bottom = -zoom / 2;
      }
      this.camera?.updateProjectionMatrix();
      this.renderFrame();
    }

    createEnvironment() {
      const env = this.scene?.environment || this.project.scenes?.[0]?.environment || {};
      this.scene3d.background = new T.Color(env.sky === 'solid' ? env.top || '#0b0b12' : '#0b0b12');
      this.scene3d.fog = env.fog ? new T.Fog(env.fogColor || '#111827', num(env.fogNear, 18), num(env.fogFar, 80)) : null;
      const ambient = new T.HemisphereLight(env.top || '#93c5fd', env.bottom || '#111827', 1.1);
      ambient.name = '__cascade_ambient';
      this.scene3d.add(ambient);
      this.setupGradientSky(env);
    }

    setupGradientSky(env) {
      const canvas = root.document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 0, 256);
      gradient.addColorStop(0, env.top || '#111827');
      gradient.addColorStop(1, env.bottom || '#050508');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 2, 256);
      const texture = new T.CanvasTexture(canvas);
      texture.colorSpace = T.SRGBColorSpace;
      texture.mapping = T.EquirectangularReflectionMapping;
      this.scene3d.background = texture;
      if (env.sky === 'solid') this.scene3d.background = new T.Color(env.top || '#0b0b12');
      this.skyTexture = texture;
    }

    createGrid() {
      if (this.grid) this.scene3d.remove(this.grid);
      this.grid = new T.GridHelper(40, 40, 0x475569, 0x1e293b);
      this.grid.position.y = 0.001;
      this.grid.name = '__cascade_grid';
      this.scene3d.add(this.grid);
    }

    async loadImages() {
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

    async loadModels() {
      const tasks = [];
      for (const asset of this.project.assets || []) {
        if (asset.type !== 'model' || !asset.src) continue;
        tasks.push(this.loadModel(asset).catch((error) => this.log(`Model ${asset.name}: ${error.message}`, 'warn')));
      }
      await Promise.all(tasks);
    }

    async loadModel(asset) {
      if (!asset.src) return null;
      if (this.modelCache?.has(asset.id)) return this.modelCache.get(asset.id);
      this.modelCache ||= new Map();
      const extension = String(asset.name || asset.src).split('.').pop().toLowerCase().split('?')[0];
      const loader = extension === 'glb' || extension === 'gltf' ? new Loaders.GLTFLoader()
        : extension === 'obj' ? new Loaders.OBJLoader()
          : extension === 'stl' ? new Loaders.STLLoader()
            : extension === 'fbx' ? new Loaders.FBXLoader() : null;
      if (!loader) throw new Error(`Unsupported model format: ${extension}`);
      const response = await fetch(asset.src);
      const buffer = await response.arrayBuffer();
      let object;
      if (extension === 'glb' || extension === 'gltf') object = (await loader.parseAsync(buffer, '')).scene;
      else if (extension === 'obj') object = loader.parse(new TextDecoder().decode(buffer));
      else if (extension === 'stl') object = new T.Mesh(loader.parse(buffer), new T.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.1, roughness: 0.7 }));
      else object = loader.parse(buffer, '');
      if (object) {
        object.traverse((child) => {
          if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
        });
        this.modelCache.set(asset.id, object);
      }
      return object;
    }

    async start(options = {}) {
      if (this.running || this.missingDependencies) return;
      this.running = true;
      await this.loadImages();
      await this.loadModels();
      this.setScene(this.project.activeScene || this.project.project.defaultScene);
      if (this.editor) {
        this.post('cascade-game:ready', { version: VERSION, mode: '3d', editor: true });
        return;
      }
      this.clock = { start: performance.now() };
      this.lastTime = performance.now();
      this.post('cascade-game:ready', { version: VERSION, mode: '3d' });
      if (!this.headless) this.raf = root.requestAnimationFrame((time) => this.loop(time));
    }

    stop() {
      this.running = false;
      if (this.raf) root.cancelAnimationFrame(this.raf);
      this.raf = null;
      this.audio.stop();
      this.post('cascade-game:stopped');
    }

    pause() { this.paused = true; this.post('cascade-game:paused'); }
    resume() { this.paused = false; this.lastTime = performance.now(); this.post('cascade-game:resumed'); }
    restart() { this.stop(); this.start(); }

    destroy() {
      this.stop();
      for (const remove of this.listeners.splice(0)) { try { remove(); } catch { /* noop */ } }
      this.clearScene();
      this.renderer?.dispose();
      this.destroyed = true;
    }

    clearScene() {
      if (!this.scene3d) return;
      for (const [id, object] of this.objects) {
        this.scene3d.remove(object);
        disposeObject(object);
      }
      this.objects.clear();
      this.entities.clear();
      this.uiEntities.clear();
      if (this.hud) this.hud.remove();
      this.hud = null;
      if (this.world) {
        this.world.bodies.slice().forEach((body) => this.world.removeBody(body));
        this.world = null;
      }
      this.bodies.clear();
    }

    setScene(sceneId, options = {}) {
      const scene = (this.project.scenes || []).find((item) => item.id === sceneId) || this.project.scenes?.[0];
      if (!scene) throw new Error('The project has no scenes');
      this.clearScene();
      this.scene = scene;
      this.sceneId = scene.id;
      this.project.activeScene = scene.id;
      this.won = false;
      this.vars = { ...(this.project.variables || {}) };
      this.particles = [];
      this.particleEmitters = new Map();
      this.pendingDestroy = [];
      this.inPhysics = false;
      this.applyEnvironment(scene.environment || {});
      if (!this.editor) {
        this.hud = root.document.createElement('div');
        this.hud.id = 'game3d-hud';
        this.hud.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;font-family:system-ui,sans-serif;z-index:5';
        (this.canvas.parentElement || root.document.body).append(this.hud);
        this.createWorld();
      } else {
        this.createWorldEditor();
      }
      this.createEntities();
      this.resolveHierarchy();
      this.setupCamera();
      this.createJoints();
      if (this.editor) this.renderFrame();
      else {
        this.startCodeScripts();
        this.runScripts('sceneLoad', 0);
        this.runScripts('start', 0);
        this.updateHud();
        this.post('cascade-game:scene', { sceneId: scene.id, sceneName: scene.name, entities: this.entities.size });
      }
      return scene;
    }

    applyEnvironment(env) {
      if (!this.scene3d) return;
      this.scene3d.fog = env.fog ? new T.Fog(env.fogColor || '#111827', num(env.fogNear, 18), num(env.fogFar, 80)) : null;
      this.setupGradientSky(env);
    }

    createWorldEditor() {
      this.world = null;
      this.renderer.shadowMap.enabled = true;
    }

    createWorld() {
      this.world = new C.World();
      const gravity = this.scene?.gravity || { x: 0, y: -18, z: 0 };
      this.world.gravity.set(num(gravity.x), num(gravity.y), num(gravity.z));
      this.world.broadphase = new C.SAPBroadphase(this.world);
      this.world.allowSleep = true;
      this.world.solver.iterations = num(this.project.project.render3d?.quality === 'low' ? 5 : 10, 10);
      this.world.addEventListener('beginContact', (event) => this.handleContact(event, 'triggerEnter'));
      this.world.addEventListener('endContact', (event) => this.handleContact(event, 'triggerExit'));
      this.world.addEventListener('beginContact', (event) => this.handleContact(event, 'collisionEnter'));
      this.world.addEventListener('endContact', (event) => this.handleContact(event, 'collisionExit'));
    }

    createEntities() {
      for (const data of this.scene.entities || []) this.createEntity(data);
      for (const entity of this.entities.values()) this.attachToParent(entity);
    }

    createEntity(data) {
      const object = new T.Group();
      object.name = data.name || data.id;
      object.position.set(num(data.x), num(data.y), num(data.z));
      object.rotation.set(deg(num(data.rotationX ?? data.rotation)), deg(num(data.rotationY)), deg(num(data.rotationZ)));
      object.scale.set(num(data.scaleX, 1), num(data.scaleY, 1), num(data.scaleZ, 1));
      object.visible = data.visible !== false;
      object.userData.entityId = data.id;
      this.objects.set(data.id, object);
      this.scene3d.add(object);
      const entity = { ...data, object, alive: true, vx: 0, vy: 0, vz: 0, grounded: false, contacts: new Set(), parent: null, children: [] };
      this.entities.set(data.id, entity);
      this.buildVisual(entity);
      this.buildBody(entity);
      return entity;
    }

    attachToParent(entity) {
      const parent = entity.parentId ? this.entities.get(entity.parentId) : null;
      if (!parent) return;
      entity.object.position.sub(parent.object.position);
      parent.object.add(entity.object);
      entity.parent = parent;
      parent.children.push(entity);
    }

    resolveHierarchy() {
      for (const entity of this.entities.values()) {
        entity.parent = entity.parentId ? this.entities.get(entity.parentId) || null : null;
        entity.children = [];
      }
      for (const entity of this.entities.values()) if (entity.parent) entity.parent.children.push(entity);
    }

    buildVisual(entity) {
      const mesh = entity.components.MeshRenderer;
      const skin = entity.components.SkinnedMeshRenderer;
      const light = entity.components.Light3D;
      const camera = entity.components.Camera3D;
      if (mesh) {
        const object = this.meshFor(entity, mesh);
        if (object) entity.object.add(object);
      }
      if (skin?.assetId && this.modelCache?.has(skin.assetId)) {
        const model = this.modelCache.get(skin.assetId).clone(true);
        entity.object.add(model);
      }
      if (light) {
        const lightObject = this.lightFor(entity, light);
        if (lightObject) entity.object.add(lightObject);
      }
      if (camera) {
        entity.camera3d = camera;
      }
      const audio = entity.components.AudioSource3D;
      if (audio?.autoplay && audio.assetId) this.audio.play(audio.assetId, { volume: audio.volume, loop: audio.loop, pitch: audio.pitch }).catch(() => {});
      const particles = entity.components.ParticleEmitter3D;
      if (particles) this.createParticles3D(entity, particles);
      const terrain = entity.components.TerrainComponent;
      if (terrain) this.buildTerrain(entity, terrain);
    }

    meshFor(entity, mesh) {
      const model = mesh.assetId && this.modelCache?.get(mesh.assetId);
      if (mesh.mesh === 'custom' && model) {
        const group = new T.Group();
        const clone = model.clone(true);
        clone.scale.set(num(entity.w, 1), num(entity.h, 1), num(entity.d, 1));
        clone.traverse((child) => { if (child.isMesh) { child.castShadow = mesh.castShadow !== false; child.receiveShadow = mesh.receiveShadow !== false; } });
        group.add(clone);
        group.userData.entityId = entity.id;
        return group;
      }
      const w = Math.max(0.001, num(entity.w, 1));
      const h = Math.max(0.001, num(entity.h, 1));
      const d = Math.max(0.001, num(entity.d, num(entity.components.Collider3D?.depth, 1)));
      let geometry;
      switch (mesh.mesh || 'box') {
        case 'sphere': geometry = new T.SphereGeometry(Math.min(w, h, d) / 2, 28, 18); break;
        case 'cylinder': geometry = new T.CylinderGeometry(Math.min(w, d) / 2, Math.min(w, d) / 2, h, 24); break;
        case 'cone': geometry = new T.ConeGeometry(Math.min(w, d) / 2, h, 24); break;
        case 'plane': geometry = new T.PlaneGeometry(w, d); geometry.rotateX(-Math.PI / 2); break;
        case 'capsule': geometry = new T.CapsuleGeometry(Math.min(w, d) / 2, Math.max(0.01, h - Math.min(w, d)), 8, 18); break;
        case 'torus': geometry = new T.TorusGeometry(Math.max(w, d) / 2, Math.max(0.01, Math.min(w, d) / 6), 16, 32); break;
        default: geometry = new T.BoxGeometry(w, h, d);
      }
      const material = new T.MeshStandardMaterial({
        color: mesh.color || '#e11d48',
        metalness: clamp(num(mesh.metalness, 0.05), 0, 1),
        roughness: clamp(num(mesh.roughness, 0.55), 0, 1),
        transparent: num(mesh.opacity, 1) < 1,
        opacity: clamp(num(mesh.opacity, 1), 0, 1),
        emissive: mesh.emissive || '#000000',
        emissiveIntensity: num(mesh.emissiveIntensity, 0),
        side: mesh.mesh === 'plane' ? T.DoubleSide : T.FrontSide,
      });
      if (mesh.textureAssetId && this.images.has(mesh.textureAssetId)) {
        const texture = new T.CanvasTexture(this.images.get(mesh.textureAssetId));
        texture.colorSpace = T.SRGBColorSpace;
        material.map = texture;
        material.needsUpdate = true;
      }
      if (mesh.normalAssetId && this.images.has(mesh.normalAssetId)) {
        const texture = new T.CanvasTexture(this.images.get(mesh.normalAssetId));
        material.normalMap = texture;
        material.needsUpdate = true;
      }
      const object = new T.Mesh(geometry, material);
      object.castShadow = mesh.castShadow !== false;
      object.receiveShadow = mesh.receiveShadow !== false;
      object.userData.entityId = entity.id;
      this.meshes.push(object);
      return object;
    }

    lightFor(entity, light) {
      const color = light.color || '#fff4df';
      const intensity = num(light.intensity, 1.5);
      let object;
      if (light.type === 'directional') {
        object = new T.DirectionalLight(color, intensity);
        object.position.set(6, 10, 4);
        object.castShadow = light.castShadow !== false;
        const size = num(light.shadowQuality, 2048);
        object.shadow.mapSize.set(size, size);
        object.shadow.camera.near = 0.5;
        object.shadow.camera.far = 80;
        object.shadow.camera.left = -36;
        object.shadow.camera.right = 36;
        object.shadow.camera.top = 36;
        object.shadow.camera.bottom = -36;
      } else if (light.type === 'point') {
        object = new T.PointLight(color, intensity, num(light.distance, 22), 2);
        object.castShadow = light.castShadow !== false;
      } else if (light.type === 'spot') {
        object = new T.SpotLight(color, intensity, num(light.distance, 28), deg(num(light.angle, 35)), num(light.penumbra, 0.3), 1.6);
        object.target.position.set(0, -4, 0);
        object.add(object.target);
        object.castShadow = light.castShadow !== false;
      } else if (light.type === 'hemisphere') {
        object = new T.HemisphereLight(color, '#111827', intensity);
      } else {
        object = new T.AmbientLight(color, intensity);
      }
      object.userData.entityId = entity.id;
      return object;
    }

    buildTerrain(entity, terrain) {
      const size = Math.max(2, num(terrain.size, 40));
      const segments = clamp(num(terrain.segments, 48), 2, 256);
      const heightScale = num(terrain.heightScale, 3);
      const noiseScale = Math.max(0.01, num(terrain.noise, 0.12));
      const seed = num(terrain.seed, 7);
      const geometry = new T.PlaneGeometry(size, size, segments, segments);
      geometry.rotateX(-Math.PI / 2);
      const position = geometry.attributes.position;
      const heights = [];
      for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i) * noiseScale + seed;
        const z = position.getZ(i) * noiseScale + seed;
        const height = (Math.sin(x) * Math.cos(z) + Math.sin(x * 2.3 + z * 1.7) * 0.5) * heightScale;
        position.setY(i, height);
        heights.push(height);
      }
      geometry.computeVertexNormals();
      const material = new T.MeshStandardMaterial({ color: terrain.color || '#3f6212', roughness: 0.95, metalness: 0 });
      const mesh = new T.Mesh(geometry, material);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.userData.entityId = entity.id;
      entity.object.add(mesh);
      entity.terrain = { mesh, heights, size, segments };
      if (this.world && !this.editor) {
        // Cannon heightfields live in the local XY plane with height on +Z.
        // Rotate the static body -90° around X so it becomes a Y-up floor.
        // PlaneGeometry row 0 is at +Z before rotation; Cannon's row 0 maps to
        // -Z after this rotation, so the rows must be written in reverse.
        const cols = segments + 1;
        const data = Array.from({ length: cols }, () => new Array(cols).fill(0));
        for (let ix = 0; ix < cols; ix += 1) {
          for (let iy = 0; iy < cols; iy += 1) {
            const sourceRow = segments - iy;
            data[ix][iy] = heights[sourceRow * cols + ix] || 0;
          }
        }
        const shape = new C.Heightfield(data, { elementSize: size / segments });
        // Cannon heightfields start at local (0, 0), not at a centered origin.
        // Shift the body so the grid covers the same footprint as the mesh.
        const body = new C.Body({ mass: 0, shape, position: new C.Vec3(entity.object.position.x - size / 2, entity.object.position.y, entity.object.position.z + size / 2) });
        body.quaternion.setFromAxisAngle(new C.Vec3(1, 0, 0), -Math.PI / 2);
        this.world.addBody(body);
        entity.body = body;
      }
    }

    buildBody(entity) {
      if (!this.world || this.editor) return;
      const rb = entity.components.Rigidbody3D;
      const collider = entity.components.Collider3D;
      const controller = entity.components.CharacterController3D;
      if (!rb && !collider && !controller) return;
      const w = Math.max(0.01, num(collider?.width, entity.w));
      const h = Math.max(0.01, num(collider?.height, entity.h));
      const d = Math.max(0.01, num(collider?.depth, entity.d));
      const radius = Math.max(0.01, num(collider?.radius, Math.min(w, h, d) / 2));
      let shape;
      switch (collider?.shape || 'box') {
        case 'sphere': shape = new C.Sphere(radius); break;
        case 'capsule': shape = new C.Sphere(radius); break;
        case 'cylinder': shape = new C.Cylinder(radius, radius, h, 16); break;
        default: shape = new C.Box(new C.Vec3(w / 2, h / 2, d / 2));
      }
      const type = rb?.bodyType || (controller ? 'dynamic' : 'static');
      // A velocity-driven character must not fight static friction: Cannon's
      // box contact creates four points (eight friction equations), which can
      // otherwise cancel nearly all horizontal input in one step.
      const friction = controller ? 0 : num(rb?.friction, 0.25);
      const body = new C.Body({
        mass: type === 'dynamic' ? Math.max(0.01, num(rb?.mass, 1)) : 0,
        type: type === 'static' ? C.Body.STATIC : type === 'kinematic' ? C.Body.KINEMATIC : C.Body.DYNAMIC,
        shape,
        position: new C.Vec3(entity.object.position.x, entity.object.position.y, entity.object.position.z),
        material: this.materialFor(friction, num(rb?.restitution, 0.05)),
        linearDamping: clamp(num(rb?.linearDamping, 0.02), 0, 1),
        angularDamping: clamp(num(rb?.angularDamping, 0.05), 0, 1),
        fixedRotation: !!rb?.fixedRotation,
        // Cannon will otherwise put a standing character to sleep while the
        // controller keeps writing input velocity, so jumps and movement do
        // nothing until something else wakes the body.
        allowSleep: !controller,
      });
      body.userData = { entityId: entity.id, trigger: !!collider?.sensor, controller: !!controller };
      if (rb?.fixedRotation) body.angularFactor.set(0, 0, 0);
      body.collisionFilterGroup = 1 << clamp(num(collider?.layer), 0, 30);
      body.collisionFilterMask = num(collider?.mask, -1);
      this.world.addBody(body);
      entity.body = body;
      this.bodies.set(body, entity);
      if (controller) entity.controller = { ...controller, velocityY: 0, grounded: false };
    }

    materialFor(friction, restitution) {
      this.materialCache ||= new Map();
      const key = `${Number(friction).toFixed(3)}:${Number(restitution).toFixed(3)}`;
      const cached = this.materialCache.get(key);
      if (cached) return cached;
      const material = new C.Material({ friction: Number(friction), restitution: Number(restitution) });
      this.materialCache.set(key, material);
      // Cannon ignores per-body material friction unless an explicit contact
      // material exists for the pair. Register every pair (including self) as
      // materials are created, combining by the lower friction/restitution.
      for (const other of this.materialCache.values()) {
        this.world?.addContactMaterial(new C.ContactMaterial(material, other, {
          friction: Math.min(material.friction, other.friction),
          restitution: Math.min(material.restitution, other.restitution),
        }));
      }
      return material;
    }

    createJoints() {
      if (!this.world) return;
      for (const entity of this.entities.values()) {
        const joint = entity.components.Joint3D;
        if (!joint || !entity.body) continue;
        const target = this.entities.get(joint.target);
        if (!target?.body) continue;
        let constraint;
        if (joint.type === 'hinge') {
          constraint = new C.HingeConstraint(entity.body, target.body, { axisA: new C.Vec3(0, 1, 0), axisB: new C.Vec3(0, 1, 0), maxForce: 1e6 });
        } else if (joint.type === 'point') {
          constraint = new C.PointToPointConstraint(entity.body, new C.Vec3(0, 0, 0), target.body, new C.Vec3(0, 0, 0));
        } else {
          constraint = new C.DistanceConstraint(entity.body, target.body, num(joint.length, 2), 1e6);
        }
        this.world.addConstraint(constraint);
      }
    }

    setupCamera() {
      const cameraEntity = [...this.entities.values()].find((entity) => entity.components.Camera3D);
      this.cameraEntity = cameraEntity || null;
      const c = cameraEntity?.components.Camera3D || {};
      if (c.orthographic) {
        const size = num(c.orthoSize, 12);
        this.camera = new T.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, num(c.near, 0.1), num(c.far, 1200));
      } else {
        this.camera = new T.PerspectiveCamera(num(c.fov, 60), 16 / 9, num(c.near, 0.1), num(c.far, 1200));
      }
      if (cameraEntity) this.camera.position.copy(cameraEntity.object.position);
      this.cameraController = c.controller || this.project.project.controls || 'orbit';
      this.cameraTarget = c.follow ? this.entities.get(c.follow) : null;
      if (this.cameraController === 'firstPerson') this.cameraYaw = deg(num(c.yaw, 180));
      this.cameraOffset.set(num(c.offsetX, 7), num(c.offsetY, 4), num(c.offsetZ, 8));
      this.camera.fov = num(c.fov, 60);
      this.camera.updateProjectionMatrix();
      if (this.cameraController === 'orbit') {
        this.cameraYaw = Math.atan2(this.camera.position.x, this.camera.position.z);
        this.cameraPitch = Math.atan2(this.camera.position.y, Math.hypot(this.camera.position.x, this.camera.position.z));
        this.applyOrbitCamera();
      } else this.updateFollowCamera(0);
    }

    applyOrbitCamera() {
      if (!this.camera || this.cameraController !== 'orbit') return;
      const target = this.cameraTarget?.object.position || new T.Vector3(0, 1, 0);
      const distance = this.editor ? 12 : 10;
      const x = target.x + Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch) * distance;
      const y = target.y + Math.sin(this.cameraPitch) * distance;
      const z = target.z + Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch) * distance;
      this.camera.position.set(x, y, z);
      this.camera.lookAt(target);
    }

    updateFollowCamera(dt) {
      if (!this.camera) return;
      if (this.cameraController === 'orbit') { this.applyOrbitCamera(); return; }
      const target = this.cameraTarget?.object.position || new T.Vector3(0, 1, 0);
      const offset = this.cameraOffset;
      if (this.cameraController === 'firstPerson') {
        const eye = target.clone().add(new T.Vector3(0, 1.55, 0));
        this.camera.position.copy(eye);
        const direction = new T.Vector3(Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch), Math.sin(this.cameraPitch), Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch));
        this.camera.lookAt(eye.clone().add(direction));
      } else {
        const distance = Math.max(1, offset.z);
        const desired = target.clone().add(new T.Vector3(Math.sin(this.cameraYaw) * distance, offset.y + Math.sin(this.cameraPitch) * distance, Math.cos(this.cameraYaw) * distance));
        this.camera.position.lerp(desired, Math.min(1, dt * 7 || 1));
        this.camera.lookAt(target.clone().add(new T.Vector3(0, 1.1, 0)));
      }
      if (this.cameraShakeTime > 0) {
        this.cameraShakeTime = Math.max(0, this.cameraShakeTime - dt);
        this.camera.position.x += (Math.random() - 0.5) * this.cameraShake;
        this.camera.position.y += (Math.random() - 0.5) * this.cameraShake;
        this.camera.position.z += (Math.random() - 0.5) * this.cameraShake;
      }
    }

    loop(time) {
      if (!this.running) return;
      const delta = Math.min(0.1, Math.max(0, (time - this.lastTime) / 1000));
      this.lastTime = time;
      if (!this.paused) this.update(delta);
      this.renderFrame();
      this.frame += 1;
      this.fpsAccum += delta;
      this.fpsFrames += 1;
      if (this.fpsAccum >= 0.5) { this.fps = Math.round(this.fpsFrames / this.fpsAccum); this.fpsAccum = 0; this.fpsFrames = 0; }
      if (this.frame % 30 === 0) this.post('cascade-game:profiler', { fps: this.fps, entities: this.entities.size, bodies: this.bodies.size, scripts: this.project.scripts.length, scriptMs: Math.round(this.scriptMs || 0) });
      this.raf = root.requestAnimationFrame((next) => this.loop(next));
    }

    update(dt) {
      const frameStart = performance.now();
      this.input.beginFrame();
      if (this.editor) {
        this.updateFollowCamera(dt);
        this.updateParticles(dt);
        this.renderMs = performance.now() - frameStart;
        return;
      }
      this.updatePlayerController(dt);
      this.updateFollowCamera(dt);
      this.updateParticles(dt);
      const physicsStart = performance.now();
      if (this.world) {
        this.accumulator += dt;
        const fixed = Math.max(1 / 240, num(this.project.project.physicsTimestep, 1 / 60));
        let steps = 0;
        this.inPhysics = true;
        try {
          while (this.accumulator >= fixed && steps < 5) {
            this.runScripts('fixedUpdate', dt);
            this.world.step(fixed);
            this.accumulator -= fixed;
            steps += 1;
          }
        } finally {
          this.inPhysics = false;
          this.flushDestroyQueue();
        }
        this.syncPhysics();
      }
      this.physicsMs = performance.now() - physicsStart;
      const scriptStart = performance.now();
      this.runScripts('update', dt);
      this.runScripts('keyPressed', dt);
      this.runCode('update', dt);
      this.scriptMs = performance.now() - scriptStart;
      this.updateHud();
      this.updateMouseLook();
      this.input.afterFrame();
      this.frameMs = performance.now() - frameStart;
    }

    updatePlayerController(dt) {
      for (const entity of this.entities.values()) {
        const controller = entity.components.CharacterController3D;
        if (!controller || !entity.body) continue;
        const input = this.input;
        const speed = input.held('ShiftLeft') ? num(controller.runSpeed, 8) : num(controller.speed, 4.2);
        let x = 0;
        let z = 0;
        if (!this.editor) {
          x = input.axis('horizontal');
          z = input.axis('vertical');
        }
        if (controller.cameraRelative) {
          const forward = new T.Vector3();
          this.camera.getWorldDirection(forward);
          forward.y = 0;
          forward.normalize();
          const right = new T.Vector3().crossVectors(forward, new T.Vector3(0, 1, 0)).normalize();
          // The input map reports W/Up as -1 and A/Left as -1. Convert those
          // screen-space axes to camera-relative movement instead of walking
          // backwards whenever the camera faces -Z.
          const direction = new T.Vector3().addScaledVector(forward, -z).addScaledVector(right, x);
          if (direction.lengthSq() > 1) direction.normalize();
          x = direction.x;
          z = direction.z;
        }
        const body = entity.body;
        body.wakeUp();
        if (this.grounded(entity, 0.65)) entity.controller.velocityY = Math.max(0, entity.controller.velocityY);
        entity.controller.velocityY = Math.max(-60, entity.controller.velocityY + num(controller.gravity, -20) * dt);
        if (input.justPressed('Space') && this.grounded(entity, 0.65)) entity.controller.velocityY = Math.sqrt(2 * Math.max(1, Math.abs(num(controller.gravity, -20))) * Math.max(0.2, num(controller.jumpHeight, 1.5)));
        if (this.cameraController !== 'orbit') {
          body.velocity.x = x * speed;
          body.velocity.z = z * speed;
          body.velocity.y = entity.controller.velocityY;
        }
        entity.grounded = this.grounded(entity, 0.65);
      }
    }

    grounded(entity, distance = 1) {
      if (!this.world || !entity?.body) return false;
      const body = entity.body;
      const colliderHeight = Math.max(0.2, num(entity.components.Collider3D?.height, entity.h, 1.7));
      // Probe from the body centre down past the feet. The origin is inside the
      // controller's own collider, so temporarily put the body in group 0 to
      // make the ray ignore it; otherwise the closest hit is always self and a
      // standing character is treated as airborne (then accumulates gravity
      // until it tunnels through the floor).
      const from = new C.Vec3(body.position.x, body.position.y, body.position.z);
      const to = new C.Vec3(from.x, from.y - Math.max(colliderHeight / 2 + 0.1, distance + 0.1), from.z);
      const result = new C.RaycastResult();
      const group = body.collisionFilterGroup;
      body.collisionFilterGroup = 0;
      try {
        this.world.raycastClosest(from, to, { skipBackfaces: true, collisionFilterMask: -1 }, result);
      } finally {
        body.collisionFilterGroup = group;
      }
      return !!result.hasHit && result.body !== body;
    }

    syncPhysics() {
      for (const [body, entity] of this.bodies) {
        if (!entity.alive) continue;
        entity.object.position.set(body.position.x, body.position.y, body.position.z);
        entity.object.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      }
    }

    handleContact(event, trigger) {
      if (this.editor) return;
      const a = this.bodies.get(event.bodyA);
      const b = this.bodies.get(event.bodyB);
      if (!a || !b) return;
      const sensor = event.bodyA.userData?.trigger || event.bodyB.userData?.trigger;
      const type = sensor ? (trigger === 'triggerEnter' || trigger === 'triggerExit' ? trigger : null) : (trigger === 'collisionEnter' || trigger === 'collisionExit' ? trigger : null);
      if (!type) return;
      for (const [self, other] of [[a, b], [b, a]]) {
        for (const script of this.scripts.values()) {
          if (script.type === 'code') continue;
          if (script.entityId && script.entityId !== self.id) continue;
          const typeNode = { collisionEnter: 'event.collisionEnter', collisionExit: 'event.collisionExit', triggerEnter: 'event.triggerEnter', triggerExit: 'event.triggerExit' }[type];
          const eventNode = (script.graph?.nodes || []).find((node) => node.type === typeNode);
          if (!eventNode) continue;
          if (eventNode.config?.tagFilter && !(other.tags || []).includes(String(eventNode.config.tagFilter))) continue;
          this.runVisual(script, type, self, { other, tag: other.tags?.[0] || '' }).catch((error) => this.log(error.message, 'error'));
        }
      }
    }

    updateParticles(dt) {
      for (let i = this.particles?.length - 1; i >= 0; i -= 1) {
        const particle = this.particles[i];
        particle.life -= dt;
        if (particle.life <= 0) { particle.mesh.removeFromParent(); particle.mesh.geometry.dispose(); particle.mesh.material.dispose(); this.particles.splice(i, 1); continue; }
        particle.mesh.position.addScaledVector(particle.velocity, dt);
        particle.velocity.y += particle.gravity * dt;
        particle.mesh.material.opacity = clamp(particle.life / particle.maxLife, 0, 1) * particle.opacity;
      }
    }

    createParticles3D(entity, emitter) {
      entity.emitter = { ...emitter, acc: 0 };
      this.particles ||= [];
      this.particleEmitters ||= new Map();
      this.particleEmitters.set(entity.id, emitter);
    }

    emitParticles(entity, emitter, count) {
      const preset = PRESETS[emitter.preset] || PRESETS.sparks;
      this.particles ||= [];
      for (let i = 0; i < count; i += 1) {
        const material = new T.MeshBasicMaterial({ color: emitter.color || preset.color, transparent: true, opacity: preset.opacity || 1 });
        const mesh = new T.Mesh(new T.SphereGeometry(Math.max(0.01, num(emitter.size, preset.size)), 5, 4), material);
        const position = new T.Vector3(entity.object.position.x, entity.object.position.y + 1, entity.object.position.z);
        mesh.position.copy(position);
        const speed = num(emitter.speed, preset.speed);
        const velocity = new T.Vector3((Math.random() - 0.5) * speed, Math.random() * speed, (Math.random() - 0.5) * speed);
        const life = Math.max(0.1, num(emitter.lifetime, preset.life));
        mesh.userData.particle = true;
        this.scene3d.add(mesh);
        this.particles.push({ mesh, velocity, gravity: num(emitter.gravity, preset.gravity), life, maxLife: life, opacity: preset.opacity || 1 });
      }
    }

    updateEmitters(dt) {
      if (!this.particleEmitters) return;
      for (const [id, emitter] of this.particleEmitters) {
        const entity = this.entities.get(id);
        if (!entity) continue;
        if (emitter.burst) { this.emitParticles(entity, emitter, Math.max(1, num(emitter.burst, 8))); emitter.burst = 0; }
        emitter.acc += dt * Math.max(0, num(emitter.rate, 8));
        const count = Math.floor(emitter.acc);
        emitter.acc -= count;
        if (count > 0) this.emitParticles(entity, emitter, count);
      }
    }

    updateHud() {
      if (!this.hud) return;
      this.updateEmitters?.(1 / 60);
      this.hud.innerHTML = '';
      for (const entity of this.entities.values()) {
        const ui = entity.components.UIElement;
        if (!ui || ui.visible === false || entity.object.visible === false) continue;
        const row = root.document.createElement(ui.clickable ? 'button' : 'div');
        const text = ui.binding ? `${ui.prefix || ''}${this.vars[ui.binding] ?? 0}` : ui.text || '';
        row.textContent = text;
        row.dataset.entityId = entity.id;
        row.style.cssText = [
          'position:absolute',
          `left:${num(ui.x, 20)}px`,
          `top:${num(ui.y, 20)}px`,
          `min-width:${num(ui.w, 180)}px`,
          `min-height:${num(ui.h, 38)}px`,
          `padding:${ui.kind === 'panel' ? 10 : 6}px 12px`,
          `color:${ui.color || '#f4f4f5'}`,
          `background:${ui.kind === 'panel' ? ui.fill || 'rgba(15,23,42,.75)' : ui.kind === 'button' ? ui.fill || '#e11d48' : 'transparent'}`,
          `border:${ui.clickable ? '1px solid rgba(255,255,255,.18)' : 'none'}`,
          'border-radius:8px',
          `font-size:${num(ui.size, 18)}px`,
          'font-weight:600',
          'pointer-events:auto',
          'text-align:left',
          'font-family:system-ui,sans-serif',
          'text-shadow:0 1px 4px rgba(0,0,0,.5)',
          'cursor:' + (ui.clickable ? 'pointer' : 'default'),
        ].join(';');
        row.style.opacity = String(clamp(entity.opacity ?? 1, 0, 1));
        if (ui.clickable) {
          row.addEventListener('click', () => {
            for (const script of this.scripts.values()) {
              if (script.type === 'code') continue;
              if (!(script.graph?.nodes || []).some((node) => node.type === 'event.uiClick')) continue;
              this.runVisual(script, 'uiClick', script.entityId ? this.entities.get(script.entityId) : null, { clicked: entity }).catch((error) => this.log(error.message, 'error'));
            }
          });
        }
        this.hud.append(row);
      }
    }

    onPointer(kind, event) {
      if (!this.editor && this.cameraController !== 'orbit') {
        this.pointerAngle = true;
        this.lastPointer = event;
      }
    }

    updateMouseLook() {
      if (!this.input || this.cameraController === 'orbit' || !this.input.mouse) return;
      if (root.document.pointerLockElement === this.canvas || this.input.mouse.down) {
        this.cameraYaw -= this.input.mouse.dx * 0.0025;
        this.cameraPitch = clamp(this.cameraPitch - this.input.mouse.dy * 0.0025, -1.4, 1.35);
      }
    }

    renderFrame() {
      if (!this.renderer || !this.scene3d || !this.camera) return;
      this.updateMouseLook();
      if (this.editor) {
        this.updateSelectionHelper();
      }
      this.drawCalls = this.renderer.info.render.calls;
      this.renderer.render(this.scene3d, this.camera);
    }

    updateSelectionHelper() {
      if (!this.selectedId) {
        if (this.selectionHelper) { this.selectionHelper.visible = false; }
        return;
      }
      const entity = this.entities.get(this.selectedId);
      if (!entity) return;
      if (!this.selectionHelper) {
        const geometry = new T.BoxGeometry(1, 1, 1);
        const material = new T.MeshBasicMaterial({ color: 0xf43f5e, wireframe: true, transparent: true, opacity: 0.9 });
        this.selectionHelper = new T.LineSegments(new T.EdgesGeometry(geometry), new T.LineBasicMaterial({ color: 0xfb7185, depthTest: false }));
        this.selectionHelper.renderOrder = 999;
        this.scene3d.add(this.selectionHelper);
      }
      const box = new T.Box3().setFromObject(entity.object);
      const size = box.getSize(new T.Vector3());
      const center = box.getCenter(new T.Vector3());
      this.selectionHelper.visible = true;
      this.selectionHelper.position.copy(center);
      this.selectionHelper.scale.set(Math.max(0.1, size.x), Math.max(0.1, size.y), Math.max(0.1, size.z));
    }

    raycasterFromEvent(event) {
      const rect = this.canvas.getBoundingClientRect();
      const pointer = new T.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new T.Raycaster();
      raycaster.setFromCamera(pointer, this.camera);
      return raycaster;
    }

    pick(clientX, clientY) {
      if (!this.camera || !this.scene3d) return null;
      const rect = this.canvas.getBoundingClientRect();
      const pointer = new T.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new T.Raycaster();
      raycaster.setFromCamera(pointer, this.camera);
      const hits = raycaster.intersectObjects([...this.objects.values()], true);
      const hit = hits.find((item) => item.object.userData.entityId || item.object.parent?.userData?.entityId);
      if (!hit) return null;
      let object = hit.object;
      while (object && !object.userData.entityId) object = object.parent;
      return object?.userData.entityId || null;
    }

    focusEntity(id) {
      const entity = this.entities.get(id);
      if (!entity) return;
      const box = new T.Box3().setFromObject(entity.object);
      const center = box.getCenter(new T.Vector3());
      this.cameraTarget = entity;
      this.cameraYaw = Math.PI / 4;
      this.cameraPitch = -0.28;
      if (this.cameraController === 'orbit') {
        this.camera.position.set(center.x + 5, center.y + 4, center.z + 6);
        this.camera.lookAt(center);
      } else this.updateFollowCamera(0);
    }

    setView(view) {
      if (!this.camera) return;
      const target = this.cameraTarget?.object.position || new T.Vector3(0, 1, 0);
      const distance = 10;
      if (view === 'top') { this.camera.position.set(target.x, target.y + distance, target.z + 0.001); this.camera.lookAt(target); }
      else if (view === 'front') { this.camera.position.set(target.x, target.y, target.z + distance); this.camera.lookAt(target); }
      else if (view === 'side') { this.camera.position.set(target.x + distance, target.y, target.z); this.camera.lookAt(target); }
      else { this.cameraYaw = Math.PI / 4; this.cameraPitch = -0.28; this.applyOrbitCamera(); }
      this.camera.updateProjectionMatrix();
      this.renderFrame();
    }

    setSelected(id) {
      this.selectedId = id;
      this.updateSelectionHelper();
      this.renderFrame();
    }

    worldToScreen(entity) {
      if (!entity?.object || !this.camera) return null;
      const point = entity.object.position.clone().project(this.camera);
      const rect = this.canvas.getBoundingClientRect();
      return { x: (point.x + 1) / 2 * rect.width, y: (1 - point.y) / 2 * rect.height, visible: point.z < 1 };
    }

    setScripts(scripts) {
      this.scripts = new Map();
      for (const script of scripts || []) this.scripts.set(script.id, script);
    }

    startCodeScripts() {
      for (const script of this.scripts.values()) {
        if (script.type !== 'code' || script.enabled === false) continue;
        try {
          const api = this.api();
          const source = script.code;
          const factory = /export\s+default\s+class|^\s*class\s/.test(source)
            ? new Function('api', 'entity', `"use strict";\n${source.replace(/export\s+default\s+/g, 'return ').replace(/^\s*export\s+/gm, '')}\n`)
            : new Function('api', 'entity', 'event', 'dt', `"use strict";\n${source}`);
          if (/export\s+default\s+class|^\s*class\s/.test(source)) {
            const instance = new (factory(api, script.entityId ? this.entities.get(script.entityId) : null))();
            instance.game = this;
            instance.entity = script.entityId ? this.entities.get(script.entityId) : null;
            if (instance.onStart) instance.onStart();
            this.codeScripts.set(script.id, instance);
          } else {
            this.codeScripts.set(script.id, { body: factory, script });
          }
        } catch (error) { this.log(`[script ${script.id}] ${error.message}`, 'error'); }
      }
    }

    runCode(trigger, dt, event = {}) {
      for (const [id, instance] of this.codeScripts) {
        try {
          if (instance.body) instance.body(this.api(), this.entities.get(instance.script.entityId), event, dt);
          else if (typeof instance[trigger] === 'function') instance[trigger](dt, event);
        } catch (error) { this.log(`[script ${id}] ${error.message}`, 'error'); }
      }
    }

    api() {
      return {
        game: this, scene: this.scene, root: this, input: this.input, audio: this.audio,
        entity: (id) => this.entities.get(id), vars: this.vars,
        getVar: (name) => this.vars[name], setVar: (name, value) => { this.vars[name] = value; },
        setVelocity: (entity, x, y, z) => this.setVelocity(entity, x, y, z),
        applyImpulse: (entity, x, y, z) => this.applyImpulse(entity, x, y, z),
        setPosition: (entity, x, y, z) => this.setPosition(entity, x, y, z),
        spawn: (prefabId, x, y, z) => this.spawn(prefabId, x, y, z),
        destroy: (entity) => this.destroyEntity(entity),
        playSound: (id, options) => this.audio.play(id, options),
        camera: this.camera, THREE: T,
      };
    }

    runScripts(trigger, dt, event = {}) {
      for (const script of this.scripts.values()) {
        if (script.enabled === false || script.type === 'code') continue;
        if (!(script.graph?.nodes || []).some((node) => node.type === `event.${trigger}` || (trigger === 'start' && node.type === 'event.start') || (trigger === 'sceneLoad' && node.type === 'event.sceneLoad'))) continue;
        this.runVisual(script, trigger, script.entityId ? this.entities.get(script.entityId) : null, event, dt).catch((error) => this.log(error.message, 'error'));
      }
    }

    async runVisual(script, trigger, entity, event = {}, dt = 1 / 60) {
      const graph = script.graph || { nodes: [], edges: [] };
      const map = { start: 'event.start', sceneLoad: 'event.sceneLoad', fixedUpdate: 'event.fixedUpdate', collisionEnter: 'event.collisionEnter', collisionExit: 'event.collisionExit', triggerEnter: 'event.triggerEnter', triggerExit: 'event.triggerExit', uiClick: 'event.uiClick', keyPressed: 'event.keyPressed', animationFinished: 'event.animationFinished' };
      const entry = (graph.nodes || []).find((node) => node.type === (map[trigger] || 'event.update'));
      if (!entry) return;
      if (trigger === 'keyPressed' && !this.input.justPressed(entry.config?.key || 'Space')) return;
      const ctx = { graph, script, trigger, entity, event, dt, vars: this.vars, cache: new Map() };
      await this.executeChain(this.nextNode(graph, entry.id), ctx);
    }

    nextNode(graph, nodeId, pin = 'next') {
      return (graph.edges || []).find((edge) => edge.from?.node === nodeId && edge.from?.pin === pin)?.to?.node || null;
    }

    async executeChain(id, ctx) {
      let guard = 0;
      let nodeId = id;
      while (nodeId && guard++ < 1000) {
        const node = (ctx.graph.nodes || []).find((item) => item.id === nodeId);
        if (!node) break;
        const result = await this.executeNode(node, ctx);
        if (result?.stop) break;
        nodeId = this.nextNode(ctx.graph, node.id, result?.pin || 'next');
      }
    }

    readPin(node, pin, ctx, fallback) {
      const edge = (ctx.graph.edges || []).find((item) => item.to?.node === node.id && item.to?.pin === pin);
      if (edge) {
        const source = (ctx.graph.nodes || []).find((item) => item.id === edge.from.node);
        if (source) return this.evalOutput(source, edge.from.pin, ctx);
      }
      return node.config?.[pin] ?? fallback;
    }

    self(ctx) { return ctx.entity || (ctx.script.entityId ? this.entities.get(ctx.script.entityId) : null); }
    entity(value) { return typeof value === 'string' ? this.entities.get(value) : value?.id ? this.entities.get(value.id) : null; }
    v3(value, fallback = { x: 0, y: 0, z: 0 }) { return value && typeof value === 'object' ? { x: num(value.x), y: num(value.y), z: num(value.z) } : fallback; }

    evalOutput(node, pin, ctx) {
      const key = `${node.id}:${pin}`;
      if (ctx.cache.has(key)) return ctx.cache.get(key);
      const cfg = node.config || {};
      let result;
      switch (node.type) {
        case 'input.axis': result = this.input.axis(cfg.action || 'horizontal'); break;
        case 'input.keyHeld': result = this.input.held(cfg.key); break;
        case 'input.keyPressed': result = this.input.justPressed(cfg.key); break;
        case 'input.mouseX': result = this.input.mouse.x || 0; break;
        case 'input.mouseY': result = this.input.mouse.y || 0; break;
        case 'input.mouseDown': result = this.input.mouse.down; break;
        case 'input.gamepadButton': result = this.input.gamepadButton?.(cfg.button) || false; break;
        case 'input.gamepadAxis': result = this.input.gamepadAxis?.(cfg.axis) || 0; break;
        case 'input.touch': result = this.input.touch; break;
        case 'data.self': result = this.self(ctx); break;
        case 'data.find': result = this.entities.get(cfg.name) || [...this.entities.values()].find((entity) => entity.name === cfg.name); break;
        case 'data.position3d': {
          const entity = this.entity(this.readPin(node, 'entity', ctx, cfg.entityId)) || this.self(ctx);
          result = entity?.object.position[pin] || 0;
          break;
        }
        case 'data.position': {
          const entity = this.entity(this.readPin(node, 'entity', ctx, cfg.entityId)) || this.self(ctx);
          result = pin === 'x' ? entity?.object.position.x : entity?.object.position.y;
          break;
        }
        case 'data.rotation3d': { const entity = this.entity(this.readPin(node, 'entity', ctx, cfg.entityId)) || this.self(ctx); result = (entity?.object.rotation[pin] || 0) * 180 / Math.PI; break; }
        case 'data.velocity3d': {
          const entity = this.entity(this.readPin(node, 'entity', ctx)) || this.self(ctx);
          result = entity?.body?.velocity[pin] || 0;
          break;
        }
        case 'data.velocity': {
          const entity = this.entity(this.readPin(node, 'entity', ctx)) || this.self(ctx);
          result = pin === 'x' ? entity?.body?.velocity.x : entity?.body?.velocity.y;
          break;
        }
        case 'data.distance3d': {
          const a = this.entity(this.readPin(node, 'a', ctx));
          const b = this.entity(this.readPin(node, 'b', ctx));
          result = a && b ? a.object.position.distanceTo(b.object.position) : 0;
          break;
        }
        case 'data.vector3': result = new T.Vector3(num(this.readPin(node, 'x', ctx, cfg.x)), num(this.readPin(node, 'y', ctx, cfg.y)), num(this.readPin(node, 'z', ctx, cfg.z))); break;
        case 'data.vectorMath3d': {
          const a = this.v3(this.readPin(node, 'a', ctx), cfg.a);
          const b = this.v3(this.readPin(node, 'b', ctx), cfg.b);
          const out = new T.Vector3(a.x, a.y, a.z);
          if (cfg.op === 'sub') out.sub(new T.Vector3(b.x, b.y, b.z));
          else if (cfg.op === 'scale') out.multiplyScalar(num(cfg.scale, 1));
          else if (cfg.op === 'normalize') out.normalize();
          else out.add(new T.Vector3(b.x, b.y, b.z));
          result = out;
          break;
        }
        case 'data.normalize3d': { const v = this.v3(this.readPin(node, 'value', ctx), cfg.value); result = new T.Vector3(v.x, v.y, v.z).normalize(); break; }
        case 'data.dot3d': { const a = this.v3(this.readPin(node, 'a', ctx)); const b = this.v3(this.readPin(node, 'b', ctx)); result = a.x * b.x + a.y * b.y + a.z * b.z; break; }
        case 'data.cross3d': { const a = this.v3(this.readPin(node, 'a', ctx)); const b = this.v3(this.readPin(node, 'b', ctx)); result = new T.Vector3(a.x, a.y, a.z).cross(new T.Vector3(b.x, b.y, b.z)); break; }
        case 'data.lerp3d': { const a = this.v3(this.readPin(node, 'a', ctx)); const b = this.v3(this.readPin(node, 'b', ctx)); result = new T.Vector3(a.x, a.y, a.z).lerp(new T.Vector3(b.x, b.y, b.z), clamp(this.readPin(node, 't', ctx, cfg.t), 0, 1)); break; }
        case 'data.compare': { const a = this.readPin(node, 'a', ctx, cfg.a); const b = this.readPin(node, 'b', ctx, cfg.b); result = cfg.op === '==' ? a == b : cfg.op === '!=' ? a != b : cfg.op === '>' ? a > b : cfg.op === '>=' ? a >= b : cfg.op === '<' ? a < b : a <= b; break; }
        case 'data.math': { const a = num(this.readPin(node, 'a', ctx, cfg.a)); const b = num(this.readPin(node, 'b', ctx, cfg.b)); result = cfg.op === 'sub' ? a - b : cfg.op === 'mul' ? a * b : cfg.op === 'div' ? (b ? a / b : 0) : cfg.op === 'min' ? Math.min(a, b) : cfg.op === 'max' ? Math.max(a, b) : a + b; break; }
        case 'data.random': result = Math.random() * (num(this.readPin(node, 'max', ctx, cfg.max), 1) - num(this.readPin(node, 'min', ctx, cfg.min), 0)) + num(this.readPin(node, 'min', ctx, cfg.min), 0); break;
        case 'data.and': result = !!this.readPin(node, 'a', ctx) && !!this.readPin(node, 'b', ctx); break;
        case 'data.or': result = !!this.readPin(node, 'a', ctx) || !!this.readPin(node, 'b', ctx); break;
        case 'data.not': result = !this.readPin(node, 'a', ctx); break;
        case 'data.string': result = str(cfg.text).replace(/\{\{(\w+)\}\}/g, (_, name) => str(this.vars[name])); break;
        case 'variable.get': result = this.vars[cfg.name] ?? 0; break;
        case 'data.grounded3d': { const entity = this.entity(this.readPin(node, 'entity', ctx)) || this.self(ctx); result = this.grounded(entity, 1); break; }
        case 'data.grounded': { const entity = this.entity(this.readPin(node, 'entity', ctx)) || this.self(ctx); result = this.grounded(entity, 1); break; }
        case 'data.rigidbody': result = !!this.entity(this.readPin(node, 'entity', ctx))?.body; break;
        case 'event.collisionEnter':
        case 'event.collisionExit':
        case 'event.triggerEnter':
        case 'event.triggerExit': result = pin === 'other' ? ctx.event.other : pin === 'tag' ? ctx.event.tag : null; break;
        case 'event.uiClick': result = pin === 'clicked' ? ctx.event.clicked : null; break;
        case 'action.spawn':
        case 'action.spawn3d': result = ctx.cache.get(`${node.id}:entity`) || null; break;
        case 'action.raycast3d': result = pin === 'hit' ? !!ctx.cache.get(`${node.id}:hit`) : ctx.cache.get(`${node.id}:entity`) || null; break;
        case 'data.screenToWorld3d': return this.worldToScreen(this.self(ctx)) || { x: 0, y: 0 };
        default: result = cfg[pin] ?? null;
      }
      ctx.cache.set(key, result);
      return result;
    }

    async executeNode(node, ctx) {
      const cfg = node.config || {};
      const value = (pin, fallback) => this.readPin(node, pin, ctx, fallback);
      const target = () => this.entity(value('entity', cfg.entityId)) || this.self(ctx);
      switch (node.type) {
        case 'action.branch': return { pin: value('condition', cfg.condition) ? 'true' : 'false' };
        case 'action.loop': {
          const count = clamp(Math.floor(num(value('count', cfg.count), 1)), 0, 500);
          for (let i = 0; i < count; i += 1) await this.executeChain(this.nextNode(ctx.graph, node.id, 'body'), ctx);
          return { pin: 'done' };
        }
        case 'action.wait': await sleep(clamp(num(value('seconds', cfg.seconds), 0.2), 0, 30) * 1000); return { pin: 'next' };
        case 'action.gate': return value('open', cfg.open) ? { pin: 'next' } : { stop: true };
        case 'action.doOnce': { const key = `once:${ctx.script.id}:${node.id}`; if (this.vars[key]) return { stop: true }; this.vars[key] = true; return { pin: 'next' }; }
        case 'action.setVelocity3d': { const entity = target(); if (entity?.body) entity.body.velocity.set(num(value('x', cfg.x)), num(value('y', cfg.y)), num(value('z', cfg.z))); return { pin: 'next' }; }
        case 'action.applyImpulse3d': { const entity = target(); if (entity?.body) entity.body.applyImpulse(new C.Vec3(num(value('x', cfg.x)), num(value('y', cfg.y)), num(value('z', cfg.z)))); return { pin: 'next' }; }
        case 'action.applyForce3d': { const entity = target(); if (entity?.body) entity.body.applyForce(new C.Vec3(num(value('x', cfg.x)), num(value('y', cfg.y)), num(value('z', cfg.z))), entity.body.position); return { pin: 'next' }; }
        case 'action.setVelocity': { const entity = target(); if (entity?.body) entity.body.velocity.set(num(value('x', cfg.x)), num(value('y', cfg.y)), 0); return { pin: 'next' }; }
        case 'action.applyImpulse': { const entity = target(); if (entity?.body) entity.body.applyImpulse(new C.Vec3(num(value('x', cfg.x)), num(value('y', cfg.y)), 0)); return { pin: 'next' }; }
        case 'action.setPosition3d': { const entity = target(); if (entity) this.setPosition(entity, value('x', cfg.x), value('y', cfg.y), value('z', cfg.z)); return { pin: 'next' }; }
        case 'action.setPosition': { const entity = target(); if (entity) this.setPosition(entity, value('x', cfg.x), value('y', cfg.y), 0); return { pin: 'next' }; }
        case 'action.move3d': { const entity = target(); if (entity) this.setPosition(entity, entity.object.position.x + num(value('x', cfg.x)), entity.object.position.y + num(value('y', cfg.y)), entity.object.position.z + num(value('z', cfg.z))); return { pin: 'next' }; }
        case 'action.setRotation3d': { const entity = target(); if (entity) entity.object.rotation.set(deg(num(value('x', cfg.x))), deg(num(value('y', cfg.y))), deg(num(value('z', cfg.z)))); return { pin: 'next' }; }
        case 'action.setScale3d': { const entity = target(); if (entity) entity.object.scale.set(num(value('x', cfg.x), 1), num(value('y', cfg.y), 1), num(value('z', cfg.z), 1)); return { pin: 'next' }; }
        case 'action.lookAt3d': { const entity = target(); const other = this.entity(value('target', cfg.target)); if (entity && other) entity.object.lookAt(other.object.position); return { pin: 'next' }; }
        case 'action.moveToward3d': { const entity = target(); const other = this.entity(value('target', cfg.target)); if (entity && other) { const dir = other.object.position.clone().sub(entity.object.position); const length = dir.length(); if (length > 0.05) entity.object.position.addScaledVector(dir.normalize(), Math.min(length, num(value('speed', cfg.speed), 4) * ctx.dt)); } return { pin: 'next' }; }
        case 'action.setGravityScale': { const entity = target(); if (entity?.body) entity.body.gravityScale = num(value('value', cfg.value), 1); return { pin: 'next' }; }
        case 'action.spawn':
        case 'action.spawn3d': { const spawned = this.spawn(cfg.prefabId, num(value('x', cfg.x)), num(value('y', cfg.y)), num(value('z', cfg.z))); ctx.cache.set(`${node.id}:entity`, spawned); return { pin: 'next' }; }
        case 'action.destroy': { const entity = this.entity(value('entity', cfg.entityId)); if (entity) this.destroyEntity(entity); return { pin: 'next' }; }
        case 'action.setVisible': { const entity = this.entity(value('entity', cfg.entityId)) || target(); if (entity) entity.object.visible = !!value('visible', cfg.visible); return { pin: 'next' }; }
        case 'action.showUI': { const entity = this.entity(value('entity', cfg.entityId)); if (entity?.components.UIElement) { entity.components.UIElement.visible = true; entity.object.visible = true; this.updateHud(); } return { pin: 'next' }; }
        case 'action.hideUI': { const entity = this.entity(value('entity', cfg.entityId)); if (entity?.components.UIElement) { entity.components.UIElement.visible = false; entity.object.visible = false; this.updateHud(); } return { pin: 'next' }; }
        case 'action.setUIText': { const entity = this.entity(value('entity', cfg.entityId)); if (entity?.components.UIElement) { entity.components.UIElement.text = str(value('text', cfg.text)); this.updateHud(); } return { pin: 'next' }; }
        case 'action.setUIBinding': { const entity = this.entity(value('entity', cfg.entityId)); if (entity?.components.UIElement) { entity.components.UIElement.binding = str(cfg.binding); entity.components.UIElement.prefix = str(cfg.prefix); this.updateHud(); } return { pin: 'next' }; }
        case 'action.setMaterial3d': { const entity = target(); entity?.object.traverse((child) => { if (child.material && child.material.isMeshStandardMaterial) { child.material.color.set(cfg.color || '#e11d48'); child.material.metalness = num(cfg.metalness, 0.1); child.material.roughness = num(cfg.roughness, 0.5); if (cfg.emissive) child.material.emissive.set(cfg.emissive); child.material.needsUpdate = true; } }); return { pin: 'next' }; }
        case 'action.changeMesh3d': { const entity = target(); if (entity) { const old = entity.object.children.find((child) => child.isMesh); if (old) entity.object.remove(old); const next = this.meshFor(entity, { ...entity.components.MeshRenderer, mesh: cfg.mesh }); if (next) entity.object.add(next); } return { pin: 'next' }; }
        case 'action.playAnimation3d': { const entity = target(); if (entity?.mixer) { const action = entity.mixer.clipAction(cfg.clip); action.reset().setEffectiveTimeScale(num(cfg.speed, 1)).play(); } return { pin: 'next' }; }
        case 'action.cameraFollow3d': { const entity = target(); this.cameraTarget = entity || null; if (entity) this.cameraOffset.set(0, num(value('height', cfg.height), 3), num(value('distance', cfg.distance), 7)); return { pin: 'next' }; }
        case 'action.cameraPosition3d': { if (this.camera) this.camera.position.set(num(value('x', cfg.x)), num(value('y', cfg.y)), num(value('z', cfg.z))); return { pin: 'next' }; }
        case 'action.cameraRotation3d': { if (this.camera) this.camera.rotation.set(deg(num(value('x', cfg.x))), deg(num(value('y', cfg.y))), deg(num(value('z', cfg.z)))); return { pin: 'next' }; }
        case 'action.cameraShake3d': { this.cameraShake = num(value('intensity', cfg.intensity), 0.3); this.cameraShakeTime = num(value('duration', cfg.duration), 0.3); return { pin: 'next' }; }
        case 'action.cameraZoom3d': { if (this.camera?.isPerspectiveCamera) { this.camera.fov = clamp(num(value('value', cfg.value), 60), 20, 120); this.camera.updateProjectionMatrix(); } return { pin: 'next' }; }
        case 'action.playSound3d': this.audio.play(cfg.assetId, { volume: num(cfg.volume, 1) }).catch(() => {}); return { pin: 'next' };
        case 'action.spawnParticles3d': { const entity = this.self(ctx); if (entity) this.emitParticles(entity, { ...PRESETS[cfg.preset] || PRESETS.sparks, ...cfg, burst: 20 }, 20); return { pin: 'next' }; }
        case 'action.raycast3d': {
          const entity = this.self(ctx);
          if (!entity || !this.world) return { pin: 'next' };
          const origin = entity.body?.position || entity.object.position;
          const direction = new C.Vec3(num(value('dx', cfg.dx), 0), num(value('dy', cfg.dy), -1), num(value('dz', cfg.dz), 0)).unit();
          const distance = Math.max(0.1, num(value('distance', cfg.distance), 5));
          const result = new C.RaycastResult();
          this.world.raycastClosest(new C.Vec3(origin.x, origin.y, origin.z), new C.Vec3(origin.x + direction.x * distance, origin.y + direction.y * distance, origin.z + direction.z * distance), { skipBackfaces: true }, result);
          const hit = result.hasHit ? this.bodies.get(result.body) : null;
          ctx.cache.set(`${node.id}:hit`, !!hit);
          ctx.cache.set(`${node.id}:entity`, hit);
          return { pin: 'next' };
        }
        case 'action.loadScene3d': if (cfg.sceneId) this.setScene(cfg.sceneId); return { pin: 'next' };
        case 'variable.set': this.vars[cfg.name] = value('value', cfg.value); return { pin: 'next' };
        case 'variable.add': this.vars[cfg.name] = num(this.vars[cfg.name], 0) + num(value('amount', cfg.amount), 1); this.updateHud(); return { pin: 'next' };
        case 'action.save': this.save(cfg.slot || 'slot1'); return { pin: 'next' };
        case 'action.load': this.load(cfg.slot || 'slot1'); return { pin: 'next' };
        case 'action.log': this.log(str(value('message', cfg.message))); return { pin: 'next' };
        case 'action.win': this.win(str(value('message', cfg.message), 'You win!')); return { stop: true };
        default: return { pin: 'next' };
      }
    }

    setPosition(entity, x, y, z) {
      if (!entity) return;
      entity.object.position.set(num(x), num(y), num(z));
      if (entity.body) { entity.body.position.set(num(x), num(y), num(z)); entity.body.velocity.set(0, 0, 0); }
    }

    setVelocity(entity, x, y, z) {
      if (entity?.body) entity.body.velocity.set(num(x), num(y), num(z));
    }

    applyImpulse(entity, x, y, z) {
      if (entity?.body) entity.body.applyImpulse(new C.Vec3(num(x), num(y), num(z)));
    }

    spawn(prefabId, x, y, z) {
      const prefab = (this.project.prefabs || []).find((item) => item.id === prefabId || item.name === prefabId);
      if (!prefab) { this.log(`Prefab not found: ${prefabId}`, 'warn'); return null; }
      const data = JSON.parse(JSON.stringify(prefab.entity));
      data.id = `spawn_${Math.random().toString(36).slice(2, 9)}`;
      data.x = num(x, data.x);
      data.y = num(y, data.y);
      data.z = num(z, data.z);
      const entity = this.createEntity(data);
      this.attachToParent(entity);
      return entity;
    }

    destroyEntity(entity) {
      if (!entity?.alive || entity._destroyQueued) return;
      // Trigger graphs start executing synchronously inside Cannon's
      // beginContact event. Removing a body from the world mid-step corrupts
      // Cannon's broadphase ("wakeUpAfterNarrowphase" of undefined), so defer
      // destruction until the physics step has fully returned.
      if (this.inPhysics) {
        entity._destroyQueued = true;
        this.pendingDestroy.push(entity);
        return;
      }
      this.removeEntityNow(entity);
    }

    flushDestroyQueue() {
      if (!this.pendingDestroy?.length) return;
      const queued = this.pendingDestroy.splice(0);
      for (const entity of queued) {
        if (entity.alive) this.removeEntityNow(entity);
      }
    }

    removeEntityNow(entity) {
      if (!entity?.alive) return;
      entity.alive = false;
      entity._destroyQueued = false;
      if (entity.body && this.world) { this.world.removeBody(entity.body); this.bodies.delete(entity.body); }
      for (const child of [...(entity.children || [])]) this.destroyEntity(child);
      this.scene3d.remove(entity.object);
      disposeObject(entity.object);
      this.entities.delete(entity.id);
    }

    win(message = 'You win!') {
      this.won = true;
      this.winMessage = message;
      this.paused = true;
      if (this.hud) {
        this.updateHud();
        const overlay = root.document.createElement('div');
        overlay.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;background:rgba(5,5,10,.72);color:#fff;font:700 clamp(24px,5vw,48px) system-ui;text-align:center;pointer-events:none';
        overlay.textContent = this.winMessage;
        this.hud.append(overlay);
      }
      this.post('cascade-game:win', { message });
    }

    save(slot = 'slot1') {
      try { root.localStorage?.setItem(`cascade-game3d:${this.project.project.name}:${slot}`, JSON.stringify({ version: 1, vars: this.vars, scene: this.sceneId })); } catch { /* disabled */ }
    }

    load(slot = 'slot1') {
      try {
        const raw = root.localStorage?.getItem(`cascade-game3d:${this.project.project.name}:${slot}`);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (data?.version !== 1) return false;
        this.vars = { ...this.vars, ...(data.vars || {}) };
        if (data.scene) this.setScene(data.scene);
        return true;
      } catch { return false; }
    }

    stepFrame() {
      if (!this.running) { this.start().then(() => this.stepFrame()); return; }
      this.update(1 / 60);
      this.renderFrame();
      this.post('cascade-game:stepped', { frame: this.frame });
    }
  }

  function deg(value) { return num(value) * Math.PI / 180; }

  function disposeObject(object) {
    object?.traverse?.((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
      else child.material?.dispose?.();
    });
  }

  root.CascadeGame3D = { Runtime: Runtime3D, VERSION };

  function boot() {
    const canvas = root.document?.getElementById('game-canvas');
    if (!canvas || !root.__GAME_PROJECT__) return null;
    const runtime = new Runtime3D(root.__GAME_PROJECT__, canvas);
    runtime.setScripts(root.__GAME_PROJECT__.scripts || []);
    runtime.start().catch((error) => runtime.log(error.message, 'error'));
    root.__CASCADE_GAME__ = runtime;
    root.addEventListener('keydown', (event) => { if (event.code === 'KeyR' && runtime.won) runtime.restart(); });
    return runtime;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
