# Cascade Studio & Sites specification audit

Date: 2026-11-22
Scope: Cascade Roblox Studio bridge (Part 1, items 1–9) and Cascade Sites Advanced Design Engine + template gallery (Part 2, items 10–11).

This document is an audit, not a feature announcement. Every **✅** below has a command output or a browser action recorded in this repository. Anything that could not be executed in this environment is marked **🟡** or **❌** with the reason.

## How the evidence was produced

- Real browser: cloud Chromium at the project preview origin, signed in as an audit admin account. The browser viewport is 592 CSS px wide (1184 physical at DPR 2), so the screenshots are narrow-layout captures; desktop-width canvas math is covered by renderer tests.
- Studio viewport: the live Three.js canvas was enabled in the browser, a part was selected with a real click, the move gizmo was clicked and dragged with a real pointer, and the queued relay command was read back through the API.
- Sites: a real site was created from the new **Product launch landing** template, edited through the live editor, dragged in freeform mode, copied/pasted, exported, and published.
- Tests executed from the repository root with Node 26 and `PYTHON_BIN=/tmp/cascade-pptx-venv/bin/python npm test`.

## Part 1 — Roblox Studio (items 1–9)

| # | Deliverable | Status | Implementation | Executed evidence |
|---|---|---|---|---|
| 1 | 3D viewport renders the actual scene, not a static mockup | ✅ Implemented and demonstrated | `public/studio/scene-engine.mjs` builds renderable descriptors; `public/studio/studio.js` builds real Three.js meshes, lights, grid, axes, selection box, and renders on every frame | Live screenshot `docs/screenshots/studio-viewport-live.png` shows the baseplate and SpawnLocation; `node scripts/render-studio-frame.mjs` rendered `meshes=6 segments=103 litPixels=11959 traceHash=2a5922a2` to `docs/screenshots/studio-frame.png` |
| 2 | Selection picks the real instance and updates Explorer/Properties | ✅ Implemented and demonstrated | Raycaster in `studio.js`; selected mesh drives `renderTree`, `renderProps`, `BoxHelper` outline, and the gizmo | A real viewport click selected **SpawnLocation** and filled the Properties panel (`docs/screenshots/studio-viewport-selection.png`); a later gizmo drag selected **Baseplate**, which is visible in `docs/screenshots/studio-viewport-gizmo.png` |
| 3 | Orbit, pan and zoom move the camera deterministically | ✅ Implemented and demonstrated | `orbitPosition`, `orbitCamera`, `screenPanDelta`, `zoomCamera` in `scene-engine.mjs`; pointer/wheel wiring in `studio.js` | Live left-drag orbit + wheel zoom changed the view (`docs/screenshots/studio-viewport-orbit.png`); unit tests assert orbit/zoom/pan vectors in `test/studio-viewport.test.mjs` |
| 4 | Move/rotate/scale gizmo transforms the selection | ✅ Implemented and demonstrated | Axis-arrow gizmo from `makeTransformGizmo()`; drag math routed through `applyGizmoDrag()`; local/world modes | Real pointer drag moved Baseplate from `{x:0,z:0}` to `{x:3,z:1}` with size unchanged; screenshot `docs/screenshots/studio-viewport-gizmo.png`; persisted project version 3 |
| 5 | Grid snapping changes the transform and is observable | ✅ Implemented and demonstrated | `gridSnap` checkbox + size selector; `snapValue()`; `gridConfig()` | The live drag landed on integer values `X=3, Z=1` with snap enabled at 1; unit tests cover positive/negative snapping and grid config |
| 6 | Grid is part of the real scene | ✅ Implemented and demonstrated | Three.js `GridHelper(160,160)` plus `AxesHelper`; headless frame trace draws a projected grid | Grid is rendered in the live viewport underneath the 120×120 baseplate; headless trace adds 31 projected grid lines and produces a different hash (`test/studio-viewport.test.mjs`) |
| 7 | Gizmo edits emit the exact relay diff | ✅ Implemented and demonstrated | `transformCommand()` produces `{kind:'update',payload:{instanceId,props}}`; `queueCommand` persists before delivery | `GET /api/studio/projects/lfNNuwu6Bmfq/commands` returned one queued command with `Position:{x:3,y:0,z:1}` and no `Size`; screenshot `studio-viewport-gizmo.png` and persisted project response agree |
| 8 | Studio page reflects real connection/queue/history state | ✅ Implemented and demonstrated | `views/studio/detail.ejs` + `studio.js`; presence chip, stale/disconnected state, queue, snapshots/history | `docs/screenshots/studio-roblox-index.png` (setup/pairing), `studio-roblox-detail.png` (Explorer, disconnected state, Connect Studio), `studio-viewport-optin.png` (explicit opt-in), `studio-viewport-live.png` |
| 9 | Complete Studio editing surface and security boundary | ✅ Implemented; Studio-side application remains manual | Explorer/properties/Luau Monaco/GUI/undo-redo/snapshots/live presence/pairing; schema validation; hashed session tokens; revocation; per-owner routes | `node --test test/studio-sites.test.mjs` → **3 pass**; covers private-project 404, single-use pairing, relay connect/poll/ack, snapshot restore, revoke → `410`, cross-user command rejection, MCP queueing, plugin download; `node --test test/security.test.mjs` → **1 pass** |

### Studio live-action record

1. Opened `/studio/roblox/lfNNuwu6Bmfq` in the real browser.
2. Clicked **Enable 3D preview**; the opt-in button disappeared and a live `#studio-viewport` canvas was created at 817×538.
3. Clicked the baseplate in the viewport. Explorer selected **Baseplate**; Properties showed its real position and size.
4. Clicked the **Move** tool. The red/green/blue gizmo appeared at the selection (`studio-viewport-gizmo.png`).
5. Dragged the gizmo. Properties changed to `X=3, Y=0, Z=1`; size stayed `120,1,120`.
6. Read the queued relay command over HTTP; its payload was exactly `{"instanceId":"85c11985-c9d7-4eaf-894f-a1eefbfd08f7","props":{"Position":{"x":3,"y":0,"z":1}}}`.
7. Orbited and zoomed with real pointer/wheel input; the camera view changed and no console exception was raised.

## Part 2 — Cascade Sites (items 10–11)

### Item 10 — Advanced Design Engine

| Capability | Status | Implementation | Verification |
|---|---|---|---|
| Drag-and-drop section reorder | ✅ Implemented and demonstrated | Native drag handlers on canvas sections and layer rows in `public/editors/site.js` | Real browser drag dispatched from the second layer to the first moved **Hero** above **Navigation** in both the layer list and the rendered canvas |
| Freeform canvas | ✅ Implemented and demonstrated | New `freeform` section type in `site-render.mjs` + inspector + pointer drag in `site.js`; x/y/w/h percentage positions | Real pointer drag changed the first block from `6%,10%` to `22%,21%`; API read-back at version 3 returned `x:22,y:21`; screenshot `sites-freeform-drag.png` |
| CSS Grid **and** Flexbox | ✅ Implemented and demonstrated | `layoutFor`/`sectionLayoutStyle`; grid/flex classes and CSS variables; editor **Auto-layout & breakpoints** controls | Automated test asserts `--cs-layout:flex`, `--cs-cols:4`, `cs-layout-flex`, tablet/mobile column variables; grid remains the default for every existing section type |
| Configurable breakpoints | ✅ Implemented and demonstrated | `DEFAULT_SITE_BREAKPOINTS`, `breakpointsFor`, theme `breakpoints`; editor tablet/mobile fields | Changed the live site to tablet **780**, mobile **520**; exported HTML and published page both contained exactly `@media (max-width:780px)` and `@media (max-width:520px)`; test also asserts a custom 820/560 pair |
| Reusable components **and variants** | ✅ Implemented and demonstrated | `components` array with `variants`; save/insert/variant UI; component IDs copied with sections | Browser generated `Component · Audit hero component` and `Variant · Audit hero component / Audit hero component`; inserting the variant increased rendered sections from 9 to 10 |
| Global design tokens | ✅ Implemented | Theme accent/background/surface/text/muted, radius, max width, body font and heading font in `site-render.mjs` | Exported page uses the token values; automated renderer test checks custom breakpoint tokens and layout CSS |
| Fonts | ✅ Implemented | `fontStack()` supports Inter/system, Georgia, Times, Courier and monospace; body + heading tokens | Editor exposes both fields; generated CSS emits `--cs-font` and `--cs-heading-font` |
| Gradients and background media | ✅ Implemented and demonstrated | Section gradient endpoints, custom background, image picker, background video URL; `videoSrc()` allow-list; `<video class="cs-bg-video">` | Automated test asserts gradient CSS variables and escaped `<video src="https://cdn.example.test/loop.mp4">` |
| SVG images | ✅ Implemented and demonstrated | `imageSrc()` accepts base64 SVG data URIs and local raw assets; editor image picker stores them | Automated test renders `data:image/svg+xml;base64,...` inside a freeform block and asserts it survives in markup |
| Nesting | ❌ Not implemented | Sections are a flat ordered list; freeform blocks are absolutely positioned siblings, not nested containers | No nested section/container model exists. This is an honest gap, not a fake control. |
| Auto-layout | ✅ Implemented and demonstrated | Grid/flex layout controls with columns, tablet/mobile columns, gap, align and justify | Same automated renderer test and live inspector controls |
| Smart guides / snapping | ✅ Implemented and demonstrated | Freeform drag snaps to a 1% grid and center guides; guide lines appear during a drag | Live drag output `22%,21%`; code creates/hides `.cs-freeform-guide` lines at 0/25/50/75/100 |
| Constraints | 🟡 Partial | Responsive padding, hide-on-tablet/mobile, column counts, and mobile freeform stacking are real constraints | No per-element pin/min/max/fill constraints. These are deliberately not presented as finished. |
| Undo / redo | ✅ Implemented and demonstrated (bug fixed in this audit) | History snapshots in `site.js`; undo/redo now refresh the layer list as well as the canvas | Before fix: undo restored the canvas order but left stale layer rows. After fix: `Navigation,Hero,Features → Hero,Navigation,Features → Navigation,Hero,Features → Hero,Navigation,Features` across move/undo/redo |
| Keyboard shortcuts | ✅ Implemented | Cmd/Ctrl+Z, Shift+Z, C, V, D, S; Alt+↑/↓; Escape; Delete/Backspace | Shortcut handlers are in `site.js`; copy/paste was additionally exercised with the toolbar buttons |
| Copy/paste across projects | ✅ Implemented and demonstrated in one project | `localStorage` payload `cascade.site.section.v1` plus clipboard fallback; pasted sections receive a new id and are saved to the current site | Browser Copy → Paste changed rendered section count from **8 → 9** and stored a `freeform` payload; because the store is same-origin localStorage, another site in the same origin reads the same clipboard |

### Item 11 — Template gallery

All eight requested kinds are present in `src/templates.js`; `templatesFor('site')` is asserted by `test/studio-sites.test.mjs`.

| Requested template | Template id | Status |
|---|---|---|
| Blank | `site-blank` | ✅ |
| Landing page | `site-landing` — Product launch landing (new) | ✅ Created a real site from it in the live browser |
| Portfolio | `site-portfolio` | ✅ |
| SaaS | `site-saas` | ✅ |
| Business | `site-business` | ✅ |
| Blog | `site-blog` | ✅ |
| E-commerce landing | `site-commerce` | ✅ |
| Community-created | `site-community` — Community showcase (new, contributor-labelled) + user-saved templates | ✅ Built-in community starter and per-user saved templates; a public multi-user marketplace is **not** implemented |

## Exported responsive markup (actual output)

The live site was changed to tablet **780** and mobile **520**, exported with `GET /sites/Ynb3sIf9BpIH/export.html`, and published at `/sites/BhEioVOv-3`.

```
$ curl … /sites/Ynb3sIf9BpIH/export.html
export=200 bytes=23443

$ grep -o '@media (max-width:[0-9]*px)' /tmp/cascade-audit/export2.html | sort -u
@media (max-width:520px)
@media (max-width:780px)

$ curl … /sites/BhEioVOv-3
public=200 bytes=23466

$ grep -o '@media (max-width:[0-9]*px)' /tmp/cascade-audit/public.html | sort -u
@media (max-width:520px)
@media (max-width:780px)

$ grep -c 'data-freeform-id=' /tmp/cascade-audit/public.html
2
```

The renderer test separately asserts a real 820/560 pair and layout variables:

```js
assert.match(html, /--cs-layout:flex/);
assert.match(html, /--cs-cols:4/);
assert.match(css, /@media \(max-width:820px\)/);
assert.match(css, /@media \(max-width:560px\)/);
```

## Automated test output

### Viewport engine

```
$ node --test test/studio-viewport.test.mjs
✔ scene descriptors are built from real instance props and skip GUI/scripts
✔ orbit, zoom, pan and grid math are deterministic
✔ move/rotate/scale gizmo drags clamp, snap and support local space
✔ transform diffs are the exact relay update payloads
✔ sceneDiff emits only changed instances and properties
✔ deterministic headless frame contains projected geometry and a stable trace
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

Headless frame command:

```
$ node scripts/render-studio-frame.mjs
{
  "output": ".../docs/screenshots/studio-frame.png",
  "bytes": 14403,
  "width": 960,
  "height": 600,
  "meshes": 6,
  "segments": 103,
  "litPixels": 11959,
  "traceHash": "2a5922a2"
}
```

### Studio/Sites end-to-end and security

```
$ node --test test/studio-sites.test.mjs
✔ Roblox Studio unit validation rejects unsafe payloads and persists supported edits
✔ website engine emits real responsive CSS, breakpoints, layout variants and media
✔ Studio relay, website publishing, CMS, rollback, MCP and cross-user isolation work end-to-end
ℹ tests 3
ℹ pass 3

$ node --test test/security.test.mjs
✔ real HTTP security matrix blocks anonymous/cross-user access and hardens uploads and API keys
ℹ tests 1
ℹ pass 1
```

### Full regression suite

```
$ PYTHON_BIN=/tmp/cascade-pptx-venv/bin/python npm test
ℹ tests 18
ℹ pass 17
ℹ fail 0
ℹ skipped 1
```

The one skip is the external LibreOffice render check, which requires `SOFFICE_BIN`.

## Security matrix

| Surface | Assertion executed | Result |
|---|---|---|
| Session/auth isolation | Anonymous API calls return 401; cross-user document routes return 404; session cookie is HttpOnly + SameSite=Lax | ✅ `test/security.test.mjs` |
| Studio project isolation | Second account gets 404 for project page, project API, pair, commands, snapshots and restore | ✅ `test/studio-sites.test.mjs` |
| Pairing code | Wrong code → 401; valid code works once; replay → 401; token required for poll/ack/snapshot | ✅ `test/studio-sites.test.mjs` |
| Relay revocation | `/sessions/:id/revoke` → 200; old token poll → 410 | ✅ `test/studio-sites.test.mjs` |
| Relay payloads | Unsafe `__proto__`, invalid class names, oversized scripts and oversized commands rejected; supported edits persist | ✅ `test/studio-sites.test.mjs` |
| CMS output escaping | Published CMS item with `<script>`/`onerror` payload is escaped; raw tags absent; escaped entities present | ✅ `test/studio-sites.test.mjs` |
| Publishing/rollback authorization | Stranger cannot publish, list deployments or restore staging; owner rollback restores production content | ✅ `test/studio-sites.test.mjs` |
| API key handling | Read/write scopes enforced; hash stored as SHA-256 (64 hex), never plaintext; revoke → 401; cross-user key access → 404 | ✅ `test/security.test.mjs` |
| CMS drafts / private sites | Anonymous private collection/export/raw routes → 404; public item/export allowed; unrelated assets → 404 | ✅ `test/security.test.mjs` |
| MCP | Anonymous → 401; cross-origin cookie mutation → 403; read-only key cannot mutate; cross-user reads fail; owner scope succeeds | ✅ `test/security.test.mjs` |

## Bugs found and fixed during this audit

1. **Undo/redo left the layer panel stale.** Reproduced by moving Hero above Navigation, clicking Undo: canvas returned to Navigation→Hero, layer list stayed Hero→Navigation. Fixed by calling `renderLayers()` from both undo and redo; re-verified live.
2. **Freeform was renderer-only.** The new section rendered but could not be added because `views/editors/site.ejs` had no Freeform option. Added the option and verified adding, dragging, saving and publishing.
3. **Renderer used hardcoded 860/600 media queries.** Replaced with `breakpointsFor(content)` and added live/custom breakpoint verification.
4. **Editor canvas ignored custom breakpoints.** `paint()` used fixed 390/834 widths. It now derives tablet/mobile canvas widths from the site theme; the same breakpoints are emitted in exported markup.
5. **Headless trace had no grid evidence.** Added a projected-grid option and a test that proves it adds 31 lines and changes the stable hash.
6. **Viewport logic was renderer-coupled and untested.** Extracted scene building, camera math, gizmo/snap math and relay diff construction into `scene-engine.mjs` with 6 executed tests.

## Remaining work (not claimed as done)

- **True nesting** is not implemented. Sections remain a flat list; freeform blocks are siblings, not recursive containers.
- **Per-element constraints** (pin/fill/min-max) are not implemented; responsive section padding/visibility/columns and freeform mobile stacking are the available constraints.
- **Real Roblox Studio application** cannot be executed in this environment. The plugin, relay, security boundary and browser side are tested; the final in-Studio application still requires the checklist in `docs/roblox-studio-manual-checklist.md`.
- **Collaboration WebSocket through the cloud preview proxy** returned 502 during the Sites session. The editor autosaved through HTTP and the collaboration test matrix passes against the app server directly, but proxy WebSocket behavior is not proven here.
- Screenshots are narrow-viewport captures (592 CSS px) because of the cloud browser panel; desktop-width layout is covered by generated CSS and renderer tests, not a 1440px screenshot.
