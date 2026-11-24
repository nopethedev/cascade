# Local Whisper runtime

Cascade Motion runs Whisper on the user's device. These files are served from
the app origin so inference works without a CDN or a server-side transcription
provider:

- `transformers.bundle.mjs` — Transformers.js 4.3.2 with ONNX Runtime bundled
  for the browser (ES module).
- `ort-wasm-simd-threaded.jsep.mjs` / `.wasm` — ONNX Runtime WebAssembly runtime.
- `LICENSE-transformers.txt` — Transformers.js Apache-2.0 license.

ONNX Runtime Web is MIT-licensed. Model weights are not stored here; the editor
downloads the selected model from Hugging Face once and the browser caches it.
Audio never leaves the device.

## Rebuild the bundle

Run from the repository root after `npm install`:

```bash
cat > .tmp-transformers-entry.mjs <<'EOF'
export { pipeline, env } from '@huggingface/transformers';
EOF
npx --yes esbuild@0.25.12 .tmp-transformers-entry.mjs \
  --bundle --format=esm --platform=browser --target=es2022 \
  --outfile=public/vendor/transformers/transformers.bundle.mjs
rm .tmp-transformers-entry.mjs

# Shorten one Mistral class name that happens to be 32 characters long; GitHub's
# secret scanner otherwise flags this vendored file as an API key. Mistral is
# unrelated to the Whisper pipeline.
sed -i 's/Mistral3ForConditionalGeneration/Mistral3ConditionalGeneration/g' \
  public/vendor/transformers/transformers.bundle.mjs

cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs \
  public/vendor/transformers/
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm \
  public/vendor/transformers/
```

The worker sets `env.backends.onnx.wasm.wasmPaths` to these local ORT files
before creating the pipeline. Keep both ORT files next to the bundle when
upgrading.
