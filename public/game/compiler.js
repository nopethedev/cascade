/* Game Studio compiler: validates a project and emits a deterministic build
   manifest for the interpreter-based runtime. Visual graphs are data, never
   evaluated as source, so a malicious graph cannot execute arbitrary JS. */
import { normalizeProject, COMPONENT_TYPES, findEntity, sceneById } from './schema.mjs';
import { gameNodeDef } from './nodes.mjs';
import { scanFlowSecrets } from '../flow/secrets.mjs';

const EXEC_KINDS = new Set(['exec']);

function diag(list, severity, code, message, scriptId = null, nodeId = null, hint = '') {
  list.push({ severity, code, message, scriptId, nodeId, hint });
}

function safeIdent(value) {
  return String(value || 'script').replace(/[^a-zA-Z0-9_]/g, '_').replace(/^([0-9])/, '_$1');
}

function graphNodes(script) {
  return Array.isArray(script?.graph?.nodes) ? script.graph.nodes : [];
}

function graphEdges(script) {
  return Array.isArray(script?.graph?.edges) ? script.graph.edges : [];
}

export function validateGameProject(input) {
  const project = normalizeProject(input);
  const diagnostics = [];

  const secretFindings = scanFlowSecrets({ project, scenes: project.scenes, scripts: project.scripts, prefabs: project.prefabs });
  if (secretFindings.length) {
    diag(diagnostics, 'error', 'game.secret-in-project', `Remove raw credentials from ${secretFindings[0].path}; use environment/runtime configuration instead.`, null, null, 'Game projects are exported as public client code.');
  }

  if (!project.scenes.length) diag(diagnostics, 'error', 'game.no-scenes', 'Add at least one scene.');
  if (!project.project.defaultScene || !sceneById(project, project.project.defaultScene)) {
    diag(diagnostics, 'error', 'game.invalid-default-scene', 'Choose a valid default scene in Project Settings.', null, null, 'The default scene is loaded when Play starts.');
  }
  if (project.mode === '3d') {
    const scene = sceneById(project, project.project.defaultScene);
    if (!scene) diag(diagnostics, 'error', 'game3d.no-scene', 'A 3D project needs at least one scene.');
    else if (!scene.entities.some((object) => object.components?.Camera3D)) diag(diagnostics, 'warning', 'game3d.no-camera', 'The scene has no Camera3D; Play will use a fallback camera.', null, null, 'Add a Camera3D component to an object.');
    if (!scene?.entities.some((object) => object.components?.Light3D || object.components?.Light2D)) diag(diagnostics, 'warning', 'game3d.no-light', 'The scene has no light; it will render with ambient lighting only.');
  }

  const ids = new Set();
  for (const scene of project.scenes) {
    for (const object of scene.entities) {
      if (ids.has(object.id)) diag(diagnostics, 'error', 'game.duplicate-entity', `Entity id ${object.id} is duplicated.`);
      ids.add(object.id);
      if (object.parentId) {
        const parent = findEntity(project, object.parentId);
        if (!parent) diag(diagnostics, 'error', 'game.missing-parent', `“${object.name}” references a missing parent.`);
        let cursor = parent;
        const seen = new Set([object.id]);
        while (cursor) {
          if (seen.has(cursor.id)) {
            diag(diagnostics, 'error', 'game.parent-cycle', `“${object.name}” is part of a parent cycle.`);
            break;
          }
          seen.add(cursor.id);
          cursor = cursor.parentId ? findEntity(project, cursor.parentId) : null;
        }
      }
      for (const [type, props] of Object.entries(object.components || {})) {
        if (!COMPONENT_TYPES.includes(type)) diag(diagnostics, 'warning', 'game.unknown-component', `Unknown component ${type} on “${object.name}” is preserved but ignored.`);
        if ((type === 'UIElement' || type === 'TextRenderer') && props?.text && String(props.text).length > 20000) {
          diag(diagnostics, 'warning', 'game.large-text', 'Text is very long; it may impact rendering.');
        }
      }
    }
  }

  const scriptIds = new Set();
  for (const script of project.scripts) {
    if (scriptIds.has(script.id)) diag(diagnostics, 'error', 'game.duplicate-script', `Script id ${script.id} is duplicated.`, script.id);
    scriptIds.add(script.id);
    if (script.entityId && !findEntity(project, script.entityId)) {
      diag(diagnostics, 'error', 'game.script-missing-entity', `“${script.name}” is attached to a missing entity.`, script.id, null, 'Reattach the script or clear its entity binding.');
    }
    if (script.type === 'code') {
      if (!['javascript', 'typescript'].includes(script.language)) diag(diagnostics, 'error', 'game.unsupported-language', `Unsupported language ${script.language}.`, script.id);
      if (script.code.length > 250000) diag(diagnostics, 'error', 'game.code-too-large', 'Code script exceeds 250 KB.', script.id);
      continue;
    }
    const nodes = graphNodes(script);
    const edges = graphEdges(script);
    if (!nodes.length) {
      diag(diagnostics, 'warning', 'game.empty-graph', `“${script.name}” has no nodes.`, script.id, null, 'Add an event node and connect actions.');
      continue;
    }
    const nodeIds = new Set();
    for (const node of nodes) {
      if (nodeIds.has(node.id)) diag(diagnostics, 'error', 'game.duplicate-node', `Node id ${node.id} is duplicated.`, script.id, node.id);
      nodeIds.add(node.id);
      const def = gameNodeDef(node.type);
      if (!def) {
        diag(diagnostics, 'error', 'game.unknown-node', `Unknown node type “${node.type}”.`, script.id, node.id);
        continue;
      }
      if (def.trigger && def.trigger !== script.trigger && nodes.length === 1) {
        diag(diagnostics, 'warning', 'game.trigger-mismatch', `“${script.name}” uses ${def.title} but its trigger is ${script.trigger}.`, script.id, node.id);
      }
    }
    for (const edge of edges) {
      const from = nodes.find((node) => node.id === edge.from?.node);
      const to = nodes.find((node) => node.id === edge.to?.node);
      if (!from || !to) {
        diag(diagnostics, 'error', 'game.missing-edge-node', 'A connection points at a missing node.', script.id, null);
        continue;
      }
      const fromDef = gameNodeDef(from.type);
      const toDef = gameNodeDef(to.type);
      const output = fromDef?.outputs?.find((pin) => pin.id === edge.from?.pin);
      const input = toDef?.inputs?.find((pin) => pin.id === edge.to?.pin);
      if (!output) diag(diagnostics, 'error', 'game.missing-output-pin', `Connection starts at an unknown output pin (${edge.from?.pin}).`, script.id, from.id);
      if (!input) diag(diagnostics, 'error', 'game.missing-input-pin', `Connection ends at an unknown input pin (${edge.to?.pin}).`, script.id, to.id);
      if (output && input && EXEC_KINDS.has(output.kind) !== EXEC_KINDS.has(input.kind)) {
        diag(diagnostics, 'error', 'game.pin-kind-mismatch', 'Execution pins cannot connect to data pins.', script.id, to.id);
      }
    }
    const triggers = nodes.filter((node) => gameNodeDef(node.type)?.trigger);
    if (!triggers.length) diag(diagnostics, 'warning', 'game.no-trigger', `“${script.name}” has no event node and will never run.`, script.id);
    for (const node of nodes) {
      const def = gameNodeDef(node.type);
      if (!def || !def.outputs?.some((pin) => pin.kind === 'exec')) continue;
      if (!def.trigger && !edges.some((edge) => edge.from.node === node.id)) {
        diag(diagnostics, 'warning', 'game.unused-node', `“${def.title}” has no outgoing connection.`, script.id, node.id);
      }
    }
  }

  for (const asset of project.assets) {
    if (!asset.id || !asset.src) diag(diagnostics, 'warning', 'game.asset-missing-source', `Asset “${asset.name}” has no source.`);
  }

  return {
    ok: !diagnostics.some((item) => item.severity === 'error'),
    project,
    diagnostics,
    errors: diagnostics.filter((item) => item.severity === 'error'),
    warnings: diagnostics.filter((item) => item.severity === 'warning'),
  };
}

export function compileGameProject(input) {
  const validation = validateGameProject(input);
  const project = validation.project;
  if (!validation.ok) return { ...validation, code: null, scripts: [] };

  const lines = [
    '// Generated by Cascade Game Studio. Do not edit by hand.',
    `// Project: ${project.project.name}`,
    `// Scenes: ${project.scenes.length} · Entities: ${project.scenes.reduce((sum, scene) => sum + scene.entities.length, 0)} · Scripts: ${project.scripts.length}`,
    '',
    'export const GAME_PROJECT = ' + JSON.stringify({
      name: project.project.name,
      width: project.project.width,
      height: project.project.height,
      defaultScene: project.project.defaultScene,
      scenes: project.scenes.map((scene) => scene.name),
    }, null, 2) + ';',
    '',
  ];
  const scripts = [];
  for (const script of project.scripts) {
    const name = `script_${safeIdent(script.id)}`;
    const triggers = script.type === 'code'
      ? [script.trigger]
      : [...new Set(graphNodes(script).map((node) => gameNodeDef(node.type)?.trigger).filter(Boolean))];
    scripts.push({ id: script.id, name: script.name, type: script.type, triggers, entityId: script.entityId });
    lines.push(`export function ${name}(game, entity, event, dt) {`);
    lines.push(`  return game.runScript(${JSON.stringify(script.id)}, entity, event, dt);`);
    lines.push('}');
    lines.push('');
  }
  lines.push('export function attachScripts(game) {');
  for (const script of scripts) {
    for (const trigger of script.triggers.length ? script.triggers : [script.type === 'code' ? 'update' : 'update']) {
      lines.push(`  game.register(${JSON.stringify(script.id)}, ${JSON.stringify(trigger)}, ${JSON.stringify(script.entityId || null)});`);
    }
  }
  lines.push('}');
  const code = lines.join('\n') + '\n';
  return {
    ...validation,
    code,
    scripts,
    stats: {
      mode: project.mode,
      scenes: project.scenes.length,
      entities: project.scenes.reduce((sum, scene) => sum + scene.entities.length, 0),
      scripts: project.scripts.length,
      visualNodes: project.scripts.reduce((sum, script) => sum + graphNodes(script).length, 0),
      assets: project.assets.length,
      prefabs: project.prefabs.length,
    },
  };
}

export function nodeLabel(type) {
  return gameNodeDef(type)?.title || type;
}
