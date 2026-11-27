import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeProject, applyEdit, applyEdits, defaultTrack, wordsToCues, formatSrt, parseSrt,
  seconds, animatedTransform, snapTime,
  TRANSITIONS, SUBTITLE_STYLES, EFFECTS, COLOR_PRESETS, MOTION_TEMPLATES, EXPORT_PRESETS,
} from '../public/motion/schema.mjs';
import {
  buildAss, buildCommand, buildFilterScript, resolveExportSettings, validateExport,
} from '../src/motion/filtergraph.js';

function fixture() {
  return normalizeProject({
    id: 'motion-qa', name: 'Motion QA', width: 1280, height: 720, fps: 30, duration: 7_000_000,
    tracks: [defaultTrack('video', { id: 'v1' }), defaultTrack('text', { id: 't1' }), defaultTrack('subtitle', { id: 's1' }), defaultTrack('audio', { id: 'a1' })],
    clips: [],
  });
}

test('preset libraries meet the advertised counts and ids are unique', () => {
  assert.ok(TRANSITIONS.length >= 50, `expected 50 transitions, got ${TRANSITIONS.length}`);
  assert.equal(SUBTITLE_STYLES.length, 50);
  assert.ok(EFFECTS.length >= 100);
  assert.ok(COLOR_PRESETS.length >= 30);
  assert.ok(MOTION_TEMPLATES.length >= 50);
  for (const list of [TRANSITIONS, SUBTITLE_STYLES, EFFECTS, COLOR_PRESETS, MOTION_TEMPLATES]) {
    assert.equal(new Set(list.map((x) => x.id)).size, list.length, 'preset ids must be unique');
  }
});

test('canonical edits stay in integer timeline ticks and survive a save/load round trip', () => {
  let project = fixture();
  project = applyEdits(project, [
    { op: 'add_clip', clip: { id: 'clip-a', trackId: 'v1', type: 'video', assetId: 'asset-a', start: 1_000_000, duration: 2_500_000, inPoint: 0 } },
    { op: 'add_text', id: 'title-a', trackId: 't1', text: 'Cascade Motion', start: 200_000, duration: 2_000_000 },
    { op: 'add_subtitle', id: 'sub-a', trackId: 's1', text: 'Rendered, not previewed.', styleId: 'karaoke', start: 500_000, duration: 1_500_000, words: [{ text: 'Rendered,', start: 500_000, end: 1_000_000 }, { text: 'not', start: 1_000_000, end: 1_200_000 }, { text: 'previewed.', start: 1_200_000, end: 1_800_000 }] },
    { op: 'add_transition', clipId: 'clip-a', type: 'crossfade', side: 'in', duration: 300_000 },
  ]);
  assert.equal(project.clips.length, 3);
  assert.equal(project.clips.find((c) => c.id === 'clip-a').transitionIn.type, 'crossfade');
  assert.equal(project.clips.find((c) => c.id === 'sub-a').subtitle.styleId, 'karaoke');
  for (const clip of project.clips) {
    assert.equal(clip.start % 1000, 0);
    assert.equal(clip.duration % 1000, 0);
  }
  const restored = normalizeProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.clips.map((c) => c.id), project.clips.map((c) => c.id));
  assert.throws(() => applyEdits(project, [{ op: 'add_transition', clipId: 'clip-a', type: 'not-a-transition' }]), /unknown transition/);
});

test('burned-in subtitles use opaque ASS colours, real word timings and bounded shadows', () => {
  const project = applyEdits(fixture(), [
    { op: 'add_text', id: 'title-a', trackId: 't1', text: 'CASCADE', start: 0, duration: 1_000_000, style: { fontSize: 0.06, letterSpacing: 0.03 } },
    { op: 'add_subtitle', id: 'sub-a', trackId: 's1', text: 'one two', styleId: 'karaoke', start: 0, duration: 1_500_000, words: [{ text: 'one', start: 0, end: 700_000 }, { text: 'two', start: 700_000, end: 1_400_000 }] },
  ]);
  const ass = buildAss(project, []);
  assert.match(ass, /\\c&H00FFFFFF/, 'primary fill must be opaque in libass alpha space');
  assert.doesNotMatch(ass, /\\c&HFFFFFFFF/);
  assert.match(ass, /\\k70/, 'karaoke word durations must reach ASS');
  assert.doesNotMatch(ass, /\\shad[3-9]\d/, 'shadow must not turn into a second detached caption');
  assert.match(ass, /PlayResX: 1280/);
});

test('FFmpeg planner delays clips to their timeline position and keeps colours and transforms', () => {
  const project = applyEdits(fixture(), [
    { op: 'add_clip', clip: { id: 'clip-late', trackId: 'v1', type: 'video', assetId: 'asset-a', start: 4_000_000, duration: 2_000_000, inPoint: 0, transform: { x: -0.2, y: 0.15, scale: 0.5, opacity: 0.8 }, color: { contrast: 0.2, saturation: 0.1 } } },
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-motion-plan-'));
  const file = path.join(dir, 'source.mp4');
  fs.writeFileSync(file, Buffer.alloc(128));
  const plan = buildFilterScript(project, [{ id: 'asset-a', kind: 'video', meta: { width: 640, height: 360, duration: 3, hasAudio: false } }], { 'asset-a': file }, { warnings: [], jobDir: dir });
  assert.match(plan.filterScript, /setpts=PTS\+4\/TB/, 'clip must start at 4 seconds, not at zero');
  assert.match(plan.filterScript, /overlay=0:0/);
  assert.match(plan.filterScript, /eq=/, 'colour grade must reach the filter graph');
  assert.match(plan.filterScript, /scale=/, 'transform scale must reach the filter graph');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('caption text becomes timed SRT cues', () => {
  const cues = wordsToCues([
    { text: 'Hello', start: 0, end: 400_000 },
    { text: 'world.', start: 400_000, end: 900_000 },
    { text: 'Next', start: 1_400_000, end: 1_800_000 },
  ]);
  assert.ok(cues.length >= 1);
  const srt = formatSrt(cues);
  assert.match(srt, /00:00:00,000 --> /);
  assert.match(srt, /Hello world\./);
});

function mediaFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-motion-media-'));
  const file = path.join(dir, 'source.mp4');
  fs.writeFileSync(file, Buffer.alloc(256));
  return { dir, file, assets: [{ id: 'asset-a', kind: 'video', meta: { width: 640, height: 360, duration: 3, hasAudio: true } }], paths: { 'asset-a': file } };
}

test('audio-only exports map no video stream and never embed a cover frame', () => {
  const project = applyEdits(fixture(), [
    { op: 'add_clip', clip: { id: 'clip-a', trackId: 'v1', type: 'video', assetId: 'asset-a', start: 0, duration: 2_000_000 } },
  ]);
  const media = mediaFixture();
  try {
    const audio = buildCommand(project, media.assets, media.paths, { capabilities: { encoders: ['libx264', 'libmp3lame', 'aac'], subtitles: true } }, {
      exportSettings: { container: 'mp3', audioCodec: 'libmp3lame', videoCodec: null, width: 0, height: 0, fps: 0 },
      outputPath: path.join(media.dir, 'audio.mp3'), jobDir: media.dir, warnings: [],
    });
    const maps = audio.args.reduce((acc, arg, i) => (arg === '-map' ? [...acc, audio.args[i + 1]] : acc), []);
    assert.deepEqual(maps, ['[aout]'], 'audio exports must not map a video stream');
    assert.equal(audio.exportSettings.videoCodec, null);
    assert.ok(audio.args.includes('-vn'));

    const video = buildCommand(project, media.assets, media.paths, { capabilities: { encoders: ['libx264', 'aac'], subtitles: true } }, {
      exportSettings: { container: 'mp4', audioCodec: 'aac', videoCodec: 'libx264', width: 640, height: 360, fps: 30, crf: 28 },
      outputPath: path.join(media.dir, 'video.mp4'), jobDir: media.dir, warnings: [],
    });
    const videoMaps = video.args.reduce((acc, arg, i) => (arg === '-map' ? [...acc, video.args[i + 1]] : acc), []);
    assert.equal(videoMaps.length, 2);
    assert.match(videoMaps[0], /^\[vout(_scaled)?\]$/);
    assert.equal(videoMaps[1], '[aout]');
  } finally {
    fs.rmSync(media.dir, { recursive: true, force: true });
  }
});

test('every transition preset plans a real clip without throwing', () => {
  const media = mediaFixture();
  try {
    for (const preset of TRANSITIONS) {
      const project = applyEdits(fixture(), [
        { op: 'add_clip', clip: { id: 'clip-a', trackId: 'v1', type: 'video', assetId: 'asset-a', start: 0, duration: 2_000_000 } },
      ]);
      const withTransition = applyEdit(project, { op: 'add_transition', clipId: 'clip-a', type: preset.id, side: 'in', duration: 400_000 });
      const plan = buildFilterScript(withTransition, media.assets, media.paths, { warnings: [], jobDir: media.dir });
      assert.ok(plan.filterScript.includes('overlay'), `${preset.id} must still composite the clip`);
      assert.equal(plan.duration, 2);
    }
  } finally {
    fs.rmSync(media.dir, { recursive: true, force: true });
  }
});

test('every effect preset can be added and planned, with unknowns rejected', () => {
  const media = mediaFixture();
  try {
    for (const preset of EFFECTS) {
      const project = applyEdits(fixture(), [
        { op: 'add_clip', clip: { id: 'clip-a', trackId: 'v1', type: 'video', assetId: 'asset-a', start: 0, duration: 2_000_000 } },
        { op: 'add_effect', clipId: 'clip-a', type: preset.id },
      ]);
      const warnings = [];
      buildFilterScript(project, media.assets, media.paths, { warnings, jobDir: media.dir });
      assert.ok(Array.isArray(warnings));
    }
    assert.throws(() => applyEdits(fixture(), [{ op: 'add_effect', clipId: 'nope', type: 'not-an-effect' }]), /target not found|unknown effect/);
  } finally {
    fs.rmSync(media.dir, { recursive: true, force: true });
  }
});

test('every motion template becomes an editable title clip', () => {
  for (const template of MOTION_TEMPLATES) {
    const project = applyEdits(fixture(), [
      { op: 'add_text', id: `tpl-${template.id}`, trackId: 't1', text: template.text, start: 0, duration: seconds(2), style: template.style },
    ]);
    const clip = project.clips.find((c) => c.id === `tpl-${template.id}`);
    assert.ok(clip, `${template.id} should create a text clip`);
    assert.ok(clip.text.content.length > 0);
  }
});

test('every export preset resolves to a container/codec pair it can actually store', () => {
  const project = { width: 1920, height: 1080, fps: 30, channels: 2 };
  const caps = { encoders: ['libx264', 'libx265', 'libvpx-vp9', 'libaom-av1', 'aac', 'libopus', 'libmp3lame', 'flac', 'pcm_s16le', 'eac3'] };
  for (const preset of EXPORT_PRESETS) {
    const resolved = resolveExportSettings({ preset: preset.id }, project);
    const result = validateExport(resolved, caps);
    assert.deepEqual(result.errors, [], `${preset.id}: ${result.errors.join(' ')}`);
    assert.equal(resolved.container, preset.container);
  }
});

test('ASS captions escape override syntax and SRT/ASS round-trip', () => {
  const project = applyEdits(fixture(), [
    { op: 'add_text', id: 'title-a', trackId: 't1', text: 'Hello {\\pos(0,0)} <b>world</b>', start: 0, duration: 1_000_000 },
  ]);
  const ass = buildAss(project, []);
  const dialogue = ass.split('\n').filter((line) => line.startsWith('Dialogue:')).join('\n');
  assert.doesNotMatch(dialogue, /\{\\pos\(0,0\)\}/, 'user braces must not become ASS override tags');
  assert.match(dialogue, /Hello/);
  assert.match(dialogue, /world/);

  const cues = [{ start: 0, end: 1_500_000, text: 'one\\ntwo' }];
  const srt = formatSrt(cues);
  const parsed = parseSrt(srt);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].start, 0);
  assert.equal(parsed[0].end, 1_500_000);
  assert.match(parsed[0].text, /one/);
});

test('keyframes, transforms and snapping agree with export timing', () => {
  const clip = normalizeProject({
    clips: [{ id: 'c', trackId: 'v1', type: 'video', start: 0, duration: 4_000_000, keyframes: { opacity: [{ t: 0, value: 0 }, { t: 2_000_000, value: 1, easing: 'linear' }], x: [{ t: 0, value: -0.5 }, { t: 4_000_000, value: 0.5 }] } }],
    tracks: [defaultTrack('video', { id: 'v1' })],
  }).clips[0];
  assert.equal(animatedTransform(clip, 0).opacity, 0);
  assert.equal(animatedTransform(clip, 1_000_000).opacity, 0.5);
  assert.equal(animatedTransform(clip, 3_000_000).x, 0.25);
  const snapped = snapTime({ clips: [{ start: 1_000_000, duration: 1_000_000 }], markers: [] }, 1_030_000);
  assert.equal(snapped, 1_000_000);
});

test('splitting honours speed when it advances the source in-point', () => {
  const project = applyEdits(fixture(), [
    { op: 'add_clip', clip: { id: 'fast', trackId: 'v1', type: 'video', assetId: 'asset-a', start: 1_000_000, duration: 4_000_000, inPoint: 2_000_000, speed: 2 } },
  ]);
  const split = applyEdit(project, { op: 'split_clip', clipId: 'fast', at: 3_000_000, newId: 'right' });
  const left = split.clips.find((c) => c.id === 'fast');
  const right = split.clips.find((c) => c.id === 'right');
  assert.equal(left.duration, 2_000_000);
  assert.equal(right.start, 3_000_000);
  assert.equal(right.inPoint, 6_000_000, 'two source seconds pass for every timeline second at 2x');
});

test('export validation blocks impossible container/codec choices instead of claiming support', () => {
  const project = { width: 1920, height: 1080, fps: 30, channels: 2 };
  const caps = { encoders: ['libx264', 'libx265', 'aac', 'libopus', 'eac3'] };
  const ok = resolveExportSettings({ container: 'mp4', videoCodec: 'libx264', audioCodec: 'aac' }, project);
  assert.deepEqual(validateExport(ok, caps).errors, []);
  const opusInMp4 = resolveExportSettings({ container: 'mp4', videoCodec: 'libx264', audioCodec: 'libopus' }, project);
  assert.match(validateExport(opusInMp4, caps).errors.join(' '), /not broadly playable/);
  const missing = resolveExportSettings({ container: 'mp4', videoCodec: 'libaom-av1' }, project);
  assert.match(validateExport(missing, caps).errors.join(' '), /not installed/);
});
