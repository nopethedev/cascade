/* Minimal Photoshop PSD reader for the Cascade Photo editor.
 *
 * Supports the flattened composite of 8-bit RGB and grayscale PSD files with
 * raw or PackBits (RLE) compression. Layer masks and 16/32-bit documents are
 * intentionally out of scope; we surface a clear error instead of guessing.
 * Exposes globalThis.CascadePSD.parse(ArrayBuffer) -> { width, height, data }.
 */
(function () {
  'use strict';

  function unpackBits(bytes, offset, length) {
    const out = new Uint8Array(length);
    let i = offset;
    const end = offset + length;
    let o = 0;
    while (i < end && o < length) {
      const n = (bytes[i++] << 24) >> 24;
      if (n >= 0) {
        const count = Math.min(n + 1, end - i, length - o);
        out.set(bytes.subarray(i, i + count), o);
        i += count;
        o += count;
      } else if (n !== -128) {
        const count = Math.min(1 - n, length - o);
        const value = bytes[i++] || 0;
        out.fill(value, o, o + count);
        o += count;
      }
    }
    return out;
  }

  function parse(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < 40) throw new Error('Not a PSD file');
    const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (signature !== '8BPS') throw new Error('Not a Photoshop document (missing 8BPS signature)');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = dv.getUint16(4);
    if (version !== 1) throw new Error(`Unsupported PSD version ${version}`);
    const channels = dv.getUint16(12);
    const height = dv.getUint32(14);
    const width = dv.getUint32(18);
    const depth = dv.getUint16(22);
    const mode = dv.getUint16(24);
    if (!width || !height) throw new Error('PSD has no canvas');
    if (depth !== 8) throw new Error(`Unsupported bit depth ${depth}. Save an 8-bit PSD and try again.`);
    if (mode !== 3 && mode !== 1) throw new Error('Only RGB and grayscale PSD files are supported.');
    if (channels < 1 || channels > 56) throw new Error('Unsupported channel count');

    let p = 26;
    const skipSection = () => {
      if (p + 4 > bytes.length) throw new Error('Truncated PSD');
      const length = dv.getUint32(p);
      p += 4 + length;
      if (p > bytes.length) throw new Error('Truncated PSD section');
    };
    skipSection(); // color mode data
    skipSection(); // image resources
    skipSection(); // layer and mask info
    if (p + 2 > bytes.length) throw new Error('PSD has no image data');
    const compression = dv.getUint16(p);
    p += 2;

    const pixels = width * height;
    const planes = [];
    if (compression === 0) {
      for (let c = 0; c < channels; c++) {
        if (p + pixels > bytes.length) throw new Error('Truncated PSD pixel data');
        planes.push(bytes.subarray(p, p + pixels));
        p += pixels;
      }
    } else if (compression === 1) {
      const rowCounts = new Uint16Array(channels * height);
      for (let i = 0; i < rowCounts.length; i++) {
        if (p + 2 > bytes.length) throw new Error('Truncated PSD RLE table');
        rowCounts[i] = dv.getUint16(p);
        p += 2;
      }
      for (let c = 0; c < channels; c++) {
        const plane = new Uint8Array(pixels);
        for (let y = 0; y < height; y++) {
          const count = rowCounts[c * height + y];
          if (p + count > bytes.length) throw new Error('Truncated PSD RLE row');
          plane.set(unpackBits(bytes, p, count).subarray(0, width), y * width);
          p += count;
        }
        planes.push(plane);
      }
    } else {
      throw new Error(`Unsupported PSD compression ${compression}`);
    }

    const data = new Uint8ClampedArray(pixels * 4);
    const alpha = channels >= 4 ? planes[3] : null;
    for (let i = 0; i < pixels; i++) {
      const o = i * 4;
      if (mode === 1) {
        const gray = planes[0][i];
        data[o] = gray;
        data[o + 1] = gray;
        data[o + 2] = gray;
      } else {
        data[o] = planes[0][i];
        data[o + 1] = planes[1][i];
        data[o + 2] = planes[2][i];
      }
      data[o + 3] = alpha ? alpha[i] : 255;
    }
    return { width, height, channels, depth, mode, data };
  }

  function isPsd(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    return bytes.length > 4 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === '8BPS';
  }

  globalThis.CascadePSD = { parse, isPsd };
})();
