/* Flatten nested compositions to transparent QuickTime Animation layers.
 * Canvas and FFmpeg cannot share a scene graph, so compositions are rendered
 * once with the same filter planner and then composited as ordinary clips.
 * This keeps the canonical model authoritative for both preview and export. */
import fs from 'node:fs';
import path from 'node:path';
import { buildFilterScript } from './filtergraph.js';
import { spawnFfmpeg, binary } from './ffmpeg.js';
import { timelineDuration, TICKS } from '../../public/motion/schema.mjs';

function compDuration(comp) {
  return Math.max(0.001, (Number(comp.duration) || timelineDuration(comp)) / TICKS);
}

export async function renderCompositions({ project, assets, paths, settings, jobDir, warnings }) {
  const comps = new Map((project.compositions || []).map((c) => [c.id, c]));
  const used = [...new Set(project.clips.filter((c) => c.type === 'composition' && c.compositionId && comps.has(c.compositionId)).map((c) => c.compositionId))];
  if (!used.length) return null;
  const addedAssets = [];
  const addedPaths = {};
  const assetIds = new Map();
  for (let i = 0; i < used.length; i += 1) {
    const comp = comps.get(used[i]);
    if ((comp.clips || []).some((c) => c.type === 'composition')) {
      warnings.push(`Composition "${comp.name}" contains another composition; only one level is flattened in export`);
    }
    if ((comp.clips || []).some((c) => c.type === 'audio')) warnings.push(`Audio inside composition "${comp.name}" is not mixed into the parent timeline`);
    const compProject = {
      ...project,
      name: comp.name,
      width: Math.max(16, Math.round(comp.width || project.width)),
      height: Math.max(16, Math.round(comp.height || project.height)),
      fps: Number(comp.fps) || project.fps,
      duration: comp.duration || timelineDuration(comp),
      background: '#000000',
      tracks: comp.tracks || [],
      clips: comp.clips || [],
      compositions: [],
      markers: [],
    };
    let plan;
    try {
      plan = buildFilterScript(compProject, assets, paths, { transparent: true, videoOnly: true, warnings, jobDir });
    } catch (err) {
      warnings.push(`Composition "${comp.name}" could not be prepared: ${err.message}`);
      continue;
    }
    if (!plan.inputs.length) {
      warnings.push(`Composition "${comp.name}" has no renderable media`);
      continue;
    }
    const id = `composition_${i + 1}_${String(comp.id).replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const out = path.join(jobDir, `${id}.mov`);
    let script = plan.filterScript;
    if (plan.textClips) {
      const ass = path.join(jobDir, `${id}.ass`);
      fs.writeFileSync(ass, plan.ass, 'utf8');
      script += `\n[vout_pre]subtitles=filename=${path.basename(ass)}[vout_comp];`;
      plan.videoLabel = 'vout_comp';
    }
    const scriptPath = path.join(jobDir, `${id}.filter.txt`);
    fs.writeFileSync(scriptPath, script, 'utf8');
    const args = ['-y', '-v', 'error', '-hide_banner'];
    for (const input of plan.inputs) args.push(...input.opts, '-i', input.path);
    const map = plan.videoLabel || 'vout_pre';
    args.push('-filter_complex_script', scriptPath, '-map', `[${map}]`, '-t', String(compDuration(comp)), '-c:v', 'qtrle', '-pix_fmt', 'argb', out);
    try {
      await spawnFfmpeg(args, { binary: binary(settings), cwd: jobDir, timeoutMs: 20 * 60_000 });
      if (!fs.existsSync(out) || fs.statSync(out).size < 1000) throw new Error('the composition layer was empty');
      addedAssets.push({ id, kind: 'video', name: comp.name, meta: { width: compProject.width, height: compProject.height, duration: compDuration(comp), hasAudio: false } });
      addedPaths[id] = out;
      assetIds.set(comp.id, id);
    } catch (err) {
      warnings.push(`Composition "${comp.name}" could not be rendered: ${err.message}`);
    }
  }
  if (!addedAssets.length) return null;
  return {
    project: {
      ...project,
      clips: project.clips.map((clip) => clip.type === 'composition' && assetIds.has(clip.compositionId)
        ? { ...clip, type: 'video', name: clip.name, assetId: assetIds.get(clip.compositionId), compositionId: null }
        : clip),
    },
    assets: addedAssets,
    paths: addedPaths,
  };
}
