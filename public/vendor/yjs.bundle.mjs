// node_modules/lib0/map.js
var create = () => /* @__PURE__ */ new Map(), copy = (m) => {
  let r = create();
  return m.forEach((v, k) => {
    r.set(k, v);
  }), r;
}, setIfUndefined = (map2, key, createT) => {
  let set = map2.get(key);
  return set === void 0 && map2.set(key, set = createT()), set;
}, map = (m, f) => {
  let res = [];
  for (let [key, value] of m)
    res.push(f(value, key));
  return res;
}, any = (m, f) => {
  for (let [key, value] of m)
    if (f(value, key))
      return !0;
  return !1;
};

// node_modules/lib0/set.js
var create2 = () => /* @__PURE__ */ new Set();

// node_modules/lib0/array.js
var last = (arr) => arr[arr.length - 1];
var appendTo = (dest, src) => {
  for (let i = 0; i < src.length; i++)
    dest.push(src[i]);
}, from = Array.from, every = (arr, f) => {
  for (let i = 0; i < arr.length; i++)
    if (!f(arr[i], i, arr))
      return !1;
  return !0;
}, some = (arr, f) => {
  for (let i = 0; i < arr.length; i++)
    if (f(arr[i], i, arr))
      return !0;
  return !1;
};
var unfold = (len, f) => {
  let array = new Array(len);
  for (let i = 0; i < len; i++)
    array[i] = f(i, array);
  return array;
};
var isArray = Array.isArray;

// node_modules/lib0/observable.js
var ObservableV2 = class {
  constructor() {
    this._observers = create();
  }
  /**
   * @template {keyof EVENTS & string} NAME
   * @param {NAME} name
   * @param {EVENTS[NAME]} f
   */
  on(name, f) {
    return setIfUndefined(
      this._observers,
      /** @type {string} */
      name,
      create2
    ).add(f), f;
  }
  /**
   * @template {keyof EVENTS & string} NAME
   * @param {NAME} name
   * @param {EVENTS[NAME]} f
   */
  once(name, f) {
    let _f = (...args2) => {
      this.off(
        name,
        /** @type {any} */
        _f
      ), f(...args2);
    };
    this.on(
      name,
      /** @type {any} */
      _f
    );
  }
  /**
   * @template {keyof EVENTS & string} NAME
   * @param {NAME} name
   * @param {EVENTS[NAME]} f
   */
  off(name, f) {
    let observers = this._observers.get(name);
    observers !== void 0 && (observers.delete(f), observers.size === 0 && this._observers.delete(name));
  }
  /**
   * Emit a named event. All registered event listeners that listen to the
   * specified name will receive the event.
   *
   * @todo This should catch exceptions
   *
   * @template {keyof EVENTS & string} NAME
   * @param {NAME} name The event name.
   * @param {Parameters<EVENTS[NAME]>} args The arguments that are applied to the event listener.
   */
  emit(name, args2) {
    return from((this._observers.get(name) || create()).values()).forEach((f) => f(...args2));
  }
  destroy() {
    this._observers = create();
  }
};

// node_modules/lib0/math.js
var floor = Math.floor;
var abs = Math.abs;
var min = (a, b) => a < b ? a : b, max = (a, b) => a > b ? a : b, isNaN = Number.isNaN;
var isNegativeZero = (n) => n !== 0 ? n < 0 : 1 / n < 0;

// node_modules/lib0/number.js
var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER, MIN_SAFE_INTEGER = Number.MIN_SAFE_INTEGER, LOWEST_INT32 = 1 << 31;
var isInteger = Number.isInteger || ((num) => typeof num == "number" && isFinite(num) && floor(num) === num), isNaN2 = Number.isNaN, parseInt = Number.parseInt;

// node_modules/lib0/string.js
var fromCharCode = String.fromCharCode, fromCodePoint = String.fromCodePoint, MAX_UTF16_CHARACTER = fromCharCode(65535), toLowerCase = (s) => s.toLowerCase(), trimLeftRegex = /^\s*/g, trimLeft = (s) => s.replace(trimLeftRegex, ""), fromCamelCaseRegex = /([A-Z])/g, fromCamelCase = (s, separator) => trimLeft(s.replace(fromCamelCaseRegex, (match2) => `${separator}${toLowerCase(match2)}`));
var _encodeUtf8Polyfill = (str) => {
  let encodedString = unescape(encodeURIComponent(str)), len = encodedString.length, buf = new Uint8Array(len);
  for (let i = 0; i < len; i++)
    buf[i] = /** @type {number} */
    encodedString.codePointAt(i);
  return buf;
}, utf8TextEncoder = (
  /** @type {TextEncoder} */
  typeof TextEncoder < "u" ? new TextEncoder() : null
), _encodeUtf8Native = (str) => utf8TextEncoder.encode(str), encodeUtf8 = utf8TextEncoder ? _encodeUtf8Native : _encodeUtf8Polyfill;
var utf8TextDecoder = typeof TextDecoder > "u" ? null : new TextDecoder("utf-8", { fatal: !0, ignoreBOM: !0 });
utf8TextDecoder && utf8TextDecoder.decode(new Uint8Array()).length === 1 && (utf8TextDecoder = null);
var repeat = (source, n) => unfold(n, () => source).join("");

// node_modules/lib0/encoding.js
var Encoder = class {
  constructor() {
    this.cpos = 0, this.cbuf = new Uint8Array(100), this.bufs = [];
  }
}, createEncoder = () => new Encoder();
var length = (encoder) => {
  let len = encoder.cpos;
  for (let i = 0; i < encoder.bufs.length; i++)
    len += encoder.bufs[i].length;
  return len;
};
var toUint8Array = (encoder) => {
  let uint8arr = new Uint8Array(length(encoder)), curPos = 0;
  for (let i = 0; i < encoder.bufs.length; i++) {
    let d = encoder.bufs[i];
    uint8arr.set(d, curPos), curPos += d.length;
  }
  return uint8arr.set(new Uint8Array(encoder.cbuf.buffer, 0, encoder.cpos), curPos), uint8arr;
}, verifyLen = (encoder, len) => {
  let bufferLen = encoder.cbuf.length;
  bufferLen - encoder.cpos < len && (encoder.bufs.push(new Uint8Array(encoder.cbuf.buffer, 0, encoder.cpos)), encoder.cbuf = new Uint8Array(max(bufferLen, len) * 2), encoder.cpos = 0);
}, write = (encoder, num) => {
  let bufferLen = encoder.cbuf.length;
  encoder.cpos === bufferLen && (encoder.bufs.push(encoder.cbuf), encoder.cbuf = new Uint8Array(bufferLen * 2), encoder.cpos = 0), encoder.cbuf[encoder.cpos++] = num;
};
var writeUint8 = write;
var writeVarUint = (encoder, num) => {
  for (; num > 127; )
    write(encoder, 128 | 127 & num), num = floor(num / 128);
  write(encoder, 127 & num);
}, writeVarInt = (encoder, num) => {
  let isNegative = isNegativeZero(num);
  for (isNegative && (num = -num), write(encoder, (num > 63 ? 128 : 0) | (isNegative ? 64 : 0) | 63 & num), num = floor(num / 64); num > 0; )
    write(encoder, (num > 127 ? 128 : 0) | 127 & num), num = floor(num / 128);
}, _strBuffer = new Uint8Array(3e4), _maxStrBSize = _strBuffer.length / 3, _writeVarStringNative = (encoder, str) => {
  if (str.length < _maxStrBSize) {
    let written = utf8TextEncoder.encodeInto(str, _strBuffer).written || 0;
    writeVarUint(encoder, written);
    for (let i = 0; i < written; i++)
      write(encoder, _strBuffer[i]);
  } else
    writeVarUint8Array(encoder, encodeUtf8(str));
}, _writeVarStringPolyfill = (encoder, str) => {
  let encodedString = unescape(encodeURIComponent(str)), len = encodedString.length;
  writeVarUint(encoder, len);
  for (let i = 0; i < len; i++)
    write(
      encoder,
      /** @type {number} */
      encodedString.codePointAt(i)
    );
}, writeVarString = utf8TextEncoder && /** @type {any} */
utf8TextEncoder.encodeInto ? _writeVarStringNative : _writeVarStringPolyfill;
var writeBinaryEncoder = (encoder, append2) => writeUint8Array(encoder, toUint8Array(append2)), writeUint8Array = (encoder, uint8Array) => {
  let bufferLen = encoder.cbuf.length, cpos = encoder.cpos, leftCopyLen = min(bufferLen - cpos, uint8Array.length), rightCopyLen = uint8Array.length - leftCopyLen;
  encoder.cbuf.set(uint8Array.subarray(0, leftCopyLen), cpos), encoder.cpos += leftCopyLen, rightCopyLen > 0 && (encoder.bufs.push(encoder.cbuf), encoder.cbuf = new Uint8Array(max(bufferLen * 2, rightCopyLen)), encoder.cbuf.set(uint8Array.subarray(leftCopyLen)), encoder.cpos = rightCopyLen);
}, writeVarUint8Array = (encoder, uint8Array) => {
  writeVarUint(encoder, uint8Array.byteLength), writeUint8Array(encoder, uint8Array);
}, writeOnDataView = (encoder, len) => {
  verifyLen(encoder, len);
  let dview = new DataView(encoder.cbuf.buffer, encoder.cpos, len);
  return encoder.cpos += len, dview;
}, writeFloat32 = (encoder, num) => writeOnDataView(encoder, 4).setFloat32(0, num, !1), writeFloat64 = (encoder, num) => writeOnDataView(encoder, 8).setFloat64(0, num, !1), writeBigInt64 = (encoder, num) => (
  /** @type {any} */
  writeOnDataView(encoder, 8).setBigInt64(0, num, !1)
);
var floatTestBed = new DataView(new ArrayBuffer(4)), isFloat32 = (num) => (floatTestBed.setFloat32(0, num), floatTestBed.getFloat32(0) === num), writeAny = (encoder, data) => {
  switch (typeof data) {
    case "string":
      write(encoder, 119), writeVarString(encoder, data);
      break;
    case "number":
      isInteger(data) && abs(data) <= 2147483647 ? (write(encoder, 125), writeVarInt(encoder, data)) : isFloat32(data) ? (write(encoder, 124), writeFloat32(encoder, data)) : (write(encoder, 123), writeFloat64(encoder, data));
      break;
    case "bigint":
      write(encoder, 122), writeBigInt64(encoder, data);
      break;
    case "object":
      if (data === null)
        write(encoder, 126);
      else if (isArray(data)) {
        write(encoder, 117), writeVarUint(encoder, data.length);
        for (let i = 0; i < data.length; i++)
          writeAny(encoder, data[i]);
      } else if (data instanceof Uint8Array)
        write(encoder, 116), writeVarUint8Array(encoder, data);
      else {
        write(encoder, 118);
        let keys2 = Object.keys(data);
        writeVarUint(encoder, keys2.length);
        for (let i = 0; i < keys2.length; i++) {
          let key = keys2[i];
          writeVarString(encoder, key), writeAny(encoder, data[key]);
        }
      }
      break;
    case "boolean":
      write(encoder, data ? 120 : 121);
      break;
    default:
      write(encoder, 127);
  }
}, RleEncoder = class extends Encoder {
  /**
   * @param {function(Encoder, T):void} writer
   */
  constructor(writer) {
    super(), this.w = writer, this.s = null, this.count = 0;
  }
  /**
   * @param {T} v
   */
  write(v) {
    this.s === v ? this.count++ : (this.count > 0 && writeVarUint(this, this.count - 1), this.count = 1, this.w(this, v), this.s = v);
  }
};
var flushUintOptRleEncoder = (encoder) => {
  encoder.count > 0 && (writeVarInt(encoder.encoder, encoder.count === 1 ? encoder.s : -encoder.s), encoder.count > 1 && writeVarUint(encoder.encoder, encoder.count - 2));
}, UintOptRleEncoder = class {
  constructor() {
    this.encoder = new Encoder(), this.s = 0, this.count = 0;
  }
  /**
   * @param {number} v
   */
  write(v) {
    this.s === v ? this.count++ : (flushUintOptRleEncoder(this), this.count = 1, this.s = v);
  }
  /**
   * Flush the encoded state and transform this to a Uint8Array.
   *
   * Note that this should only be called once.
   */
  toUint8Array() {
    return flushUintOptRleEncoder(this), toUint8Array(this.encoder);
  }
};
var flushIntDiffOptRleEncoder = (encoder) => {
  if (encoder.count > 0) {
    let encodedDiff = encoder.diff * 2 + (encoder.count === 1 ? 0 : 1);
    writeVarInt(encoder.encoder, encodedDiff), encoder.count > 1 && writeVarUint(encoder.encoder, encoder.count - 2);
  }
}, IntDiffOptRleEncoder = class {
  constructor() {
    this.encoder = new Encoder(), this.s = 0, this.count = 0, this.diff = 0;
  }
  /**
   * @param {number} v
   */
  write(v) {
    this.diff === v - this.s ? (this.s = v, this.count++) : (flushIntDiffOptRleEncoder(this), this.count = 1, this.diff = v - this.s, this.s = v);
  }
  /**
   * Flush the encoded state and transform this to a Uint8Array.
   *
   * Note that this should only be called once.
   */
  toUint8Array() {
    return flushIntDiffOptRleEncoder(this), toUint8Array(this.encoder);
  }
}, StringEncoder = class {
  constructor() {
    this.sarr = [], this.s = "", this.lensE = new UintOptRleEncoder();
  }
  /**
   * @param {string} string
   */
  write(string) {
    this.s += string, this.s.length > 19 && (this.sarr.push(this.s), this.s = ""), this.lensE.write(string.length);
  }
  toUint8Array() {
    let encoder = new Encoder();
    return this.sarr.push(this.s), this.s = "", writeVarString(encoder, this.sarr.join("")), writeUint8Array(encoder, this.lensE.toUint8Array()), toUint8Array(encoder);
  }
};

// node_modules/lib0/error.js
var create3 = (s) => new Error(s), methodUnimplemented = () => {
  throw create3("Method unimplemented");
}, unexpectedCase = () => {
  throw create3("Unexpected case");
};

// node_modules/lib0/decoding.js
var errorUnexpectedEndOfArray = create3("Unexpected end of array"), errorIntegerOutOfRange = create3("Integer out of Range"), subarray = (arr, begin, len) => {
  if (begin < 0 || len < 0 || begin + len > arr.length)
    throw errorUnexpectedEndOfArray;
  return new Uint8Array(arr.buffer, arr.byteOffset + begin, len);
}, subdataview = (arr, begin, len) => {
  if (begin < 0 || len < 0 || begin + len > arr.length)
    throw errorUnexpectedEndOfArray;
  return new DataView(arr.buffer, arr.byteOffset + begin, len);
}, Decoder = class {
  /**
   * @param {Uint8Array<Buf>} uint8Array Binary data to decode
   */
  constructor(uint8Array) {
    this.arr = uint8Array, this.pos = 0;
  }
}, createDecoder = (uint8Array) => new Decoder(uint8Array), hasContent = (decoder) => decoder.pos !== decoder.arr.length;
var readUint8Array = (decoder, len) => {
  let view = subarray(decoder.arr, decoder.pos, len);
  return decoder.pos += len, view;
}, readVarUint8Array = (decoder) => readUint8Array(decoder, readVarUint(decoder));
var readUint8 = (decoder) => decoder.arr[decoder.pos++];
var readVarUint = (decoder) => {
  let num = 0, mult = 1, len = decoder.arr.length;
  for (; decoder.pos < len; ) {
    let r = decoder.arr[decoder.pos++];
    if (num = num + (r & 127) * mult, mult *= 128, r < 128)
      return num;
    if (num > MAX_SAFE_INTEGER)
      throw errorIntegerOutOfRange;
  }
  throw errorUnexpectedEndOfArray;
}, readVarInt = (decoder) => {
  let r = decoder.arr[decoder.pos++], num = r & 63, mult = 64, sign = (r & 64) > 0 ? -1 : 1;
  if ((r & 128) === 0)
    return sign * num;
  let len = decoder.arr.length;
  for (; decoder.pos < len; ) {
    if (r = decoder.arr[decoder.pos++], num = num + (r & 127) * mult, mult *= 128, r < 128)
      return sign * num;
    if (num > MAX_SAFE_INTEGER)
      throw errorIntegerOutOfRange;
  }
  throw errorUnexpectedEndOfArray;
};
var _readVarStringPolyfill = (decoder) => {
  let remainingLen = readVarUint(decoder);
  if (remainingLen === 0)
    return "";
  {
    let encodedString = String.fromCodePoint(readUint8(decoder));
    if (--remainingLen < 100)
      for (; remainingLen--; )
        encodedString += String.fromCodePoint(readUint8(decoder));
    else
      for (; remainingLen > 0; ) {
        let nextLen = remainingLen < 1e4 ? remainingLen : 1e4, bytes = decoder.arr.subarray(decoder.pos, decoder.pos + nextLen);
        decoder.pos += nextLen, encodedString += String.fromCodePoint.apply(
          null,
          /** @type {any} */
          bytes
        ), remainingLen -= nextLen;
      }
    return decodeURIComponent(escape(encodedString));
  }
}, _readVarStringNative = (decoder) => (
  /** @type any */
  utf8TextDecoder.decode(readVarUint8Array(decoder))
), readVarString = utf8TextDecoder ? _readVarStringNative : _readVarStringPolyfill;
var readFromDataView = (decoder, len) => {
  let dv = subdataview(decoder.arr, decoder.pos, len);
  return decoder.pos += len, dv;
}, readFloat32 = (decoder) => readFromDataView(decoder, 4).getFloat32(0, !1), readFloat64 = (decoder) => readFromDataView(decoder, 8).getFloat64(0, !1), readBigInt64 = (decoder) => (
  /** @type {any} */
  readFromDataView(decoder, 8).getBigInt64(0, !1)
);
var readAnyLookupTable = [
  (decoder) => {
  },
  // CASE 127: undefined
  (decoder) => null,
  // CASE 126: null
  readVarInt,
  // CASE 125: integer
  readFloat32,
  // CASE 124: float32
  readFloat64,
  // CASE 123: float64
  readBigInt64,
  // CASE 122: bigint
  (decoder) => !1,
  // CASE 121: boolean (false)
  (decoder) => !0,
  // CASE 120: boolean (true)
  readVarString,
  // CASE 119: string
  (decoder) => {
    let len = readVarUint(decoder), obj = {};
    for (let i = 0; i < len; i++) {
      let key = readVarString(decoder);
      obj[key] = readAny(decoder);
    }
    return obj;
  },
  (decoder) => {
    let len = readVarUint(decoder), arr = [];
    for (let i = 0; i < len; i++)
      arr.push(readAny(decoder));
    return arr;
  },
  readVarUint8Array
  // CASE 116: Uint8Array
], readAny = (decoder) => readAnyLookupTable[127 - readUint8(decoder)](decoder), RleDecoder = class extends Decoder {
  /**
   * @param {Uint8Array} uint8Array
   * @param {function(Decoder):T} reader
   */
  constructor(uint8Array, reader) {
    super(uint8Array), this.reader = reader, this.s = null, this.count = 0;
  }
  read() {
    return this.count === 0 && (this.s = this.reader(this), hasContent(this) ? this.count = readVarUint(this) + 1 : this.count = -1), this.count--, /** @type {T} */
    this.s;
  }
};
var UintOptRleDecoder = class extends Decoder {
  /**
   * @param {Uint8Array} uint8Array
   */
  constructor(uint8Array) {
    super(uint8Array), this.s = 0, this.count = 0;
  }
  read() {
    if (this.count === 0) {
      this.s = readVarInt(this);
      let isNegative = isNegativeZero(this.s);
      this.count = 1, isNegative && (this.s = -this.s, this.count = readVarUint(this) + 2);
    }
    return this.count--, /** @type {number} */
    this.s;
  }
};
var IntDiffOptRleDecoder = class extends Decoder {
  /**
   * @param {Uint8Array} uint8Array
   */
  constructor(uint8Array) {
    super(uint8Array), this.s = 0, this.count = 0, this.diff = 0;
  }
  /**
   * @return {number}
   */
  read() {
    if (this.count === 0) {
      let diff = readVarInt(this), hasCount = diff & 1;
      this.diff = floor(diff / 2), this.count = 1, hasCount && (this.count = readVarUint(this) + 2);
    }
    return this.s += this.diff, this.count--, this.s;
  }
}, StringDecoder = class {
  /**
   * @param {Uint8Array} uint8Array
   */
  constructor(uint8Array) {
    this.decoder = new UintOptRleDecoder(uint8Array), this.str = readVarString(this.decoder), this.spos = 0;
  }
  /**
   * @return {string}
   */
  read() {
    let end = this.spos + this.decoder.read(), res = this.str.slice(this.spos, end);
    return this.spos = end, res;
  }
};

// node_modules/lib0/webcrypto.js
var subtle = crypto.subtle, getRandomValues = crypto.getRandomValues.bind(crypto);

// node_modules/lib0/random.js
var uint32 = () => getRandomValues(new Uint32Array(1))[0];
var uuidv4Template = "10000000-1000-4000-8000" + -1e11, uuidv4 = () => uuidv4Template.replace(
  /[018]/g,
  /** @param {number} c */
  (c) => (c ^ uint32() & 15 >> c / 4).toString(16)
);

// node_modules/lib0/time.js
var getUnixTime = Date.now;

// node_modules/lib0/promise.js
var create4 = (f) => (
  /** @type {Promise<T>} */
  new Promise(f)
);
var all = Promise.all.bind(Promise);

// node_modules/lib0/conditions.js
var undefinedToNull = (v) => v === void 0 ? null : v;

// node_modules/lib0/storage.js
var VarStoragePolyfill = class {
  constructor() {
    this.map = /* @__PURE__ */ new Map();
  }
  /**
   * @param {string} key
   * @param {any} newValue
   */
  setItem(key, newValue) {
    this.map.set(key, newValue);
  }
  /**
   * @param {string} key
   */
  getItem(key) {
    return this.map.get(key);
  }
}, _localStorage = new VarStoragePolyfill(), usePolyfill = !0;
try {
  typeof window < "u" && typeof localStorage < "u" && localStorage && (_localStorage = localStorage, usePolyfill = !1);
} catch {
}
var varStorage = _localStorage;

// node_modules/lib0/trait/equality.js
var EqualityTraitSymbol = /* @__PURE__ */ Symbol("Equality"), equals = (a, b) => a === b || !!a?.[EqualityTraitSymbol]?.(b) || !1;

// node_modules/lib0/object.js
var isObject = (o) => typeof o == "object", assign = Object.assign, keys = Object.keys;
var forEach = (obj, f) => {
  for (let key in obj)
    f(obj[key], key);
};
var size = (obj) => keys(obj).length;
var isEmpty = (obj) => {
  for (let _k in obj)
    return !1;
  return !0;
}, every2 = (obj, f) => {
  for (let key in obj)
    if (!f(obj[key], key))
      return !1;
  return !0;
}, hasProperty = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key), equalFlat = (a, b) => a === b || size(a) === size(b) && every2(a, (val, key) => (val !== void 0 || hasProperty(b, key)) && equals(b[key], val)), freeze = Object.freeze, deepFreeze = (o) => {
  for (let key in o) {
    let c = o[key];
    (typeof c == "object" || typeof c == "function") && deepFreeze(o[key]);
  }
  return freeze(o);
};

// node_modules/lib0/function.js
var callAll = (fs, args2, i = 0) => {
  try {
    for (; i < fs.length; i++)
      fs[i](...args2);
  } finally {
    i < fs.length && callAll(fs, args2, i + 1);
  }
};
var id = (a) => a;
var equalityDeep = (a, b) => {
  if (a === b)
    return !0;
  if (a == null || b == null || a.constructor !== b.constructor && (a.constructor || Object) !== (b.constructor || Object))
    return !1;
  if (a[EqualityTraitSymbol] != null)
    return a[EqualityTraitSymbol](b);
  switch (a.constructor) {
    case ArrayBuffer:
      a = new Uint8Array(a), b = new Uint8Array(b);
    // eslint-disable-next-line no-fallthrough
    case Uint8Array: {
      if (a.byteLength !== b.byteLength)
        return !1;
      for (let i = 0; i < a.length; i++)
        if (a[i] !== b[i])
          return !1;
      break;
    }
    case Set: {
      if (a.size !== b.size)
        return !1;
      for (let value of a)
        if (!b.has(value))
          return !1;
      break;
    }
    case Map: {
      if (a.size !== b.size)
        return !1;
      for (let key of a.keys())
        if (!b.has(key) || !equalityDeep(a.get(key), b.get(key)))
          return !1;
      break;
    }
    case void 0:
    case Object:
      if (size(a) !== size(b))
        return !1;
      for (let key in a)
        if (!hasProperty(a, key) || !equalityDeep(a[key], b[key]))
          return !1;
      break;
    case Array:
      if (a.length !== b.length)
        return !1;
      for (let i = 0; i < a.length; i++)
        if (!equalityDeep(a[i], b[i]))
          return !1;
      break;
    default:
      return !1;
  }
  return !0;
}, isOneOf = (value, options) => options.includes(value);

// node_modules/lib0/environment.js
var isNode = typeof process < "u" && process.release && /node|io\.js/.test(process.release.name) && Object.prototype.toString.call(typeof process < "u" ? process : 0) === "[object process]";
var isMac = typeof navigator < "u" ? /Mac/.test(navigator.platform) : !1, params, args = [], computeParams = () => {
  if (params === void 0)
    if (isNode) {
      params = create();
      let pargs = process.argv, currParamName = null;
      for (let i = 0; i < pargs.length; i++) {
        let parg = pargs[i];
        parg[0] === "-" ? (currParamName !== null && params.set(currParamName, ""), currParamName = parg) : currParamName !== null ? (params.set(currParamName, parg), currParamName = null) : args.push(parg);
      }
      currParamName !== null && params.set(currParamName, "");
    } else typeof location == "object" ? (params = create(), (location.search || "?").slice(1).split("&").forEach((kv) => {
      if (kv.length !== 0) {
        let [key, value] = kv.split("=");
        params.set(`--${fromCamelCase(key, "-")}`, value), params.set(`-${fromCamelCase(key, "-")}`, value);
      }
    })) : params = create();
  return params;
}, hasParam = (name) => computeParams().has(name);
var getVariable = (name) => isNode ? undefinedToNull(process.env[name.toUpperCase().replaceAll("-", "_")]) : undefinedToNull(varStorage.getItem(name));
var hasConf = (name) => hasParam("--" + name) || getVariable(name) !== null, production = hasConf("production"), forceColor = isNode && isOneOf(process.env.FORCE_COLOR, ["true", "1", "2"]), supportsColor = forceColor || !hasParam("--no-colors") && // @todo deprecate --no-colors
!hasConf("no-color") && (!isNode || process.stdout.isTTY) && (!isNode || hasParam("--color") || getVariable("COLORTERM") !== null || (getVariable("TERM") || "").includes("color"));

// node_modules/lib0/buffer.js
var createUint8ArrayFromLen = (len) => new Uint8Array(len);
var copyUint8Array = (uint8Array) => {
  let newBuf = createUint8ArrayFromLen(uint8Array.byteLength);
  return newBuf.set(uint8Array), newBuf;
};

// node_modules/lib0/pair.js
var Pair = class {
  /**
   * @param {L} left
   * @param {R} right
   */
  constructor(left, right) {
    this.left = left, this.right = right;
  }
}, create5 = (left, right) => new Pair(left, right);

// node_modules/lib0/prng.js
var bool = (gen) => gen.next() >= 0.5, int53 = (gen, min2, max2) => floor(gen.next() * (max2 + 1 - min2) + min2);
var int32 = (gen, min2, max2) => floor(gen.next() * (max2 + 1 - min2) + min2);
var int31 = (gen, min2, max2) => int32(gen, min2, max2);
var letter = (gen) => fromCharCode(int31(gen, 97, 122)), word = (gen, minLen = 0, maxLen = 20) => {
  let len = int31(gen, minLen, maxLen), str = "";
  for (let i = 0; i < len; i++)
    str += letter(gen);
  return str;
};
var oneOf = (gen, array) => array[int31(gen, 0, array.length - 1)];

// node_modules/lib0/schema.js
var schemaSymbol = /* @__PURE__ */ Symbol("0schema"), ValidationError = class {
  constructor() {
    this._rerrs = [];
  }
  /**
   * @param {string?} path
   * @param {string} expected
   * @param {string} has
   * @param {string?} message
   */
  extend(path, expected, has, message = null) {
    this._rerrs.push({ path, expected, has, message });
  }
  toString() {
    let s = [];
    for (let i = this._rerrs.length - 1; i > 0; i--) {
      let r = this._rerrs[i];
      s.push(repeat(" ", (this._rerrs.length - i) * 2) + `${r.path != null ? `[${r.path}] ` : ""}${r.has} doesn't match ${r.expected}. ${r.message}`);
    }
    return s.join(`
`);
  }
}, shapeExtends = (a, b) => a === b ? !0 : a == null || b == null || a.constructor !== b.constructor ? !1 : a[EqualityTraitSymbol] ? equals(a, b) : isArray(a) ? every(
  a,
  (aitem) => some(b, (bitem) => shapeExtends(aitem, bitem))
) : isObject(a) ? every2(
  a,
  (aitem, akey) => shapeExtends(aitem, b[akey])
) : !1, Schema = class {
  // this.shape must not be defined on Schema. Otherwise typecheck on metatypes (e.g. $$object) won't work as expected anymore
  /**
   * If true, the more things are added to the shape the more objects this schema will accept (e.g.
   * union). By default, the more objects are added, the the fewer objects this schema will accept.
   * @protected
   */
  static _dilutes = !1;
  /**
   * @param {Schema<any>} other
   */
  extends(other) {
    let [a, b] = [
      /** @type {any} */
      this.shape,
      /** @type {any} */
      other.shape
    ];
    return (
      /** @type {typeof Schema<any>} */
      this.constructor._dilutes && ([b, a] = [a, b]), shapeExtends(a, b)
    );
  }
  /**
   * Overwrite this when necessary. By default, we only check the `shape` property which every shape
   * should have.
   * @param {Schema<any>} other
   */
  equals(other) {
    return this.constructor === other.constructor && equalityDeep(this.shape, other.shape);
  }
  [schemaSymbol]() {
    return !0;
  }
  /**
   * @param {object} other
   */
  [EqualityTraitSymbol](other) {
    return this.equals(
      /** @type {any} */
      other
    );
  }
  /**
   * Use `schema.validate(obj)` with a typed parameter that is already of typed to be an instance of
   * Schema. Validate will check the structure of the parameter and return true iff the instance
   * really is an instance of Schema.
   *
   * @param {T} o
   * @return {boolean}
   */
  validate(o) {
    return this.check(o);
  }
  /* c8 ignore start */
  /**
   * Similar to validate, but this method accepts untyped parameters.
   *
   * @param {any} _o
   * @param {ValidationError} [_err]
   * @return {_o is T}
   */
  check(_o, _err) {
    methodUnimplemented();
  }
  /* c8 ignore stop */
  /**
   * @type {Schema<T?>}
   */
  get nullable() {
    return $union(this, $null);
  }
  /**
   * @type {$Optional<Schema<T>>}
   */
  get optional() {
    return new $Optional(
      /** @type {Schema<T>} */
      this
    );
  }
  /**
   * Cast a variable to a specific type. Returns the casted value, or throws an exception otherwise.
   * Use this if you know that the type is of a specific type and you just want to convince the type
   * system.
   *
   * **Do not rely on these error messages!**
   * Performs an assertion check only if not in a production environment.
   *
   * @template OO
   * @param {OO} o
   * @return {Extract<OO, T> extends never ? T : (OO extends Array<never> ? T : Extract<OO,T>)}
   */
  cast(o) {
    return assert(o, this), /** @type {any} */
    o;
  }
  /**
   * EXPECTO PATRONUM!! 🪄
   * This function protects against type errors. Though it may not work in the real world.
   *
   * "After all this time?"
   * "Always." - Snape, talking about type safety
   *
   * Ensures that a variable is a a specific type. Returns the value, or throws an exception if the assertion check failed.
   * Use this if you know that the type is of a specific type and you just want to convince the type
   * system.
   *
   * Can be useful when defining lambdas: `s.lambda(s.$number, s.$void).expect((n) => n + 1)`
   *
   * **Do not rely on these error messages!**
   * Performs an assertion check if not in a production environment.
   *
   * @param {T} o
   * @return {o extends T ? T : never}
   */
  expect(o) {
    return assert(o, this), o;
  }
}, $ConstructedBy = class extends Schema {
  /**
   * @param {C} c
   * @param {((o:Instance<C>)=>boolean)|null} check
   */
  constructor(c, check) {
    super(), this.shape = c, this._c = check;
  }
  /**
   * @param {any} o
   * @param {ValidationError} [err]
   * @return {o is C extends ((...args:any[]) => infer T) ? T : (C extends (new (...args:any[]) => any) ? InstanceType<C> : never)} o
   */
  check(o, err = void 0) {
    let c = o?.constructor === this.shape && (this._c == null || this._c(o));
    return !c && err?.extend(null, this.shape.name, o?.constructor.name, o?.constructor !== this.shape ? "Constructor match failed" : "Check failed"), c;
  }
}, $constructedBy = (c, check = null) => new $ConstructedBy(c, check), $$constructedBy = $constructedBy($ConstructedBy), $Custom = class extends Schema {
  /**
   * @param {(o:any) => boolean} check
   */
  constructor(check) {
    super(), this.shape = check;
  }
  /**
   * @param {any} o
   * @param {ValidationError} err
   * @return {o is any}
   */
  check(o, err) {
    let c = this.shape(o);
    return !c && err?.extend(null, "custom prop", o?.constructor.name, "failed to check custom prop"), c;
  }
}, $custom = (check) => new $Custom(check), $$custom = $constructedBy($Custom), $Literal = class extends Schema {
  /**
   * @param {Array<T>} literals
   */
  constructor(literals) {
    super(), this.shape = literals;
  }
  /**
   *
   * @param {any} o
   * @param {ValidationError} [err]
   * @return {o is T}
   */
  check(o, err) {
    let c = this.shape.some((a) => a === o);
    return !c && err?.extend(null, this.shape.join(" | "), o.toString()), c;
  }
}, $literal = (...literals) => new $Literal(literals), $$literal = $constructedBy($Literal), _regexEscape = (
  /** @type {any} */
  RegExp.escape || /** @type {(str:string) => string} */
  ((str) => str.replace(/[().|&,$^[\]]/g, (s) => "\\" + s))
), _schemaStringTemplateToRegex = (s) => {
  if ($string.check(s))
    return [_regexEscape(s)];
  if ($$literal.check(s))
    return (
      /** @type {Array<string|number>} */
      s.shape.map((v) => v + "")
    );
  if ($$number.check(s))
    return ["[+-]?\\d+.?\\d*"];
  if ($$string.check(s))
    return [".*"];
  if ($$union.check(s))
    return s.shape.map(_schemaStringTemplateToRegex).flat(1);
  unexpectedCase();
}, $StringTemplate = class extends Schema {
  /**
   * @param {T} shape
   */
  constructor(shape) {
    super(), this.shape = shape, this._r = new RegExp("^" + shape.map(_schemaStringTemplateToRegex).map((opts) => `(${opts.join("|")})`).join("") + "$");
  }
  /**
   * @param {any} o
   * @param {ValidationError} [err]
   * @return {o is CastStringTemplateArgsToTemplate<T>}
   */
  check(o, err) {
    let c = this._r.exec(o) != null;
    return !c && err?.extend(null, this._r.toString(), o.toString(), "String doesn't match string template."), c;
  }
};
var $$stringTemplate = $constructedBy($StringTemplate), isOptionalSymbol = /* @__PURE__ */ Symbol("optional"), $Optional = class extends Schema {
  /**
   * @param {S} shape
   */
  constructor(shape) {
    super(), this.shape = shape;
  }
  /**
   * @param {any} o
   * @param {ValidationError} [err]
   * @return {o is (Unwrap<S>|undefined)}
   */
  check(o, err) {
    let c = o === void 0 || this.shape.check(o);
    return !c && err?.extend(null, "undefined (optional)", "()"), c;
  }
  get [isOptionalSymbol]() {
    return !0;
  }
}, $$optional = $constructedBy($Optional), $Never = class extends Schema {
  /**
   * @param {any} _o
   * @param {ValidationError} [err]
   * @return {_o is never}
   */
  check(_o, err) {
    return err?.extend(null, "never", typeof _o), !1;
  }
}, $never = new $Never(), $$never = $constructedBy($Never), $Object = class _$Object extends Schema {
  /**
   * @param {S} shape
   * @param {boolean} partial
   */
  constructor(shape, partial = !1) {
    super(), this.shape = shape, this._isPartial = partial;
  }
  static _dilutes = !0;
  /**
   * @type {Schema<Partial<$ObjectToType<S>>>}
   */
  get partial() {
    return new _$Object(this.shape, !0);
  }
  /**
   * @param {any} o
   * @param {ValidationError} err
   * @return {o is $ObjectToType<S>}
   */
  check(o, err) {
    return o == null ? (err?.extend(null, "object", "null"), !1) : every2(this.shape, (vv, vk) => {
      let c = this._isPartial && !hasProperty(o, vk) || vv.check(o[vk], err);
      return !c && err?.extend(vk.toString(), vv.toString(), typeof o[vk], "Object property does not match"), c;
    });
  }
}, $object = (def) => (
  /** @type {any} */
  new $Object(def)
), $$object = $constructedBy($Object), $objectAny = $custom((o) => o != null && (o.constructor === Object || o.constructor == null)), $Record = class extends Schema {
  /**
   * @param {Keys} keys
   * @param {Values} values
   */
  constructor(keys2, values) {
    super(), this.shape = {
      keys: keys2,
      values
    };
  }
  /**
   * @param {any} o
   * @param {ValidationError} err
   * @return {o is { [key in Unwrap<Keys>]: Unwrap<Values> }}
   */
  check(o, err) {
    return o != null && every2(o, (vv, vk) => {
      let ck = this.shape.keys.check(vk, err);
      return !ck && err?.extend(vk + "", "Record", typeof o, ck ? "Key doesn't match schema" : "Value doesn't match value"), ck && this.shape.values.check(vv, err);
    });
  }
}, $record = (keys2, values) => new $Record(keys2, values), $$record = $constructedBy($Record), $Tuple = class extends Schema {
  /**
   * @param {S} shape
   */
  constructor(shape) {
    super(), this.shape = shape;
  }
  /**
   * @param {any} o
   * @param {ValidationError} err
   * @return {o is { [K in keyof S]: S[K] extends Schema<infer Type> ? Type : never }}
   */
  check(o, err) {
    return o != null && every2(this.shape, (vv, vk) => {
      let c = (
        /** @type {Schema<any>} */
        vv.check(o[vk], err)
      );
      return !c && err?.extend(vk.toString(), "Tuple", typeof vv), c;
    });
  }
}, $tuple = (...def) => new $Tuple(def), $$tuple = $constructedBy($Tuple), $Array = class extends Schema {
  /**
   * @param {Array<S>} v
   */
  constructor(v) {
    super(), this.shape = v.length === 1 ? v[0] : new $Union(v);
  }
  /**
   * @param {any} o
   * @param {ValidationError} [err]
   * @return {o is Array<S extends Schema<infer T> ? T : never>} o
   */
  check(o, err) {
    let c = isArray(o) && every(o, (oi) => this.shape.check(oi));
    return !c && err?.extend(null, "Array", ""), c;
  }
}, $array = (...def) => new $Array(def), $$array = $constructedBy($Array), $arrayAny = $custom((o) => isArray(o)), $InstanceOf = class extends Schema {
  /**
   * @param {new (...args:any) => T} constructor
   * @param {((o:T) => boolean)|null} check
   */
  constructor(constructor, check) {
    super(), this.shape = constructor, this._c = check;
  }
  /**
   * @param {any} o
   * @param {ValidationError} err
   * @return {o is T}
   */
  check(o, err) {
    let c = o instanceof this.shape && (this._c == null || this._c(o));
    return !c && err?.extend(null, this.shape.name, o?.constructor.name), c;
  }
}, $instanceOf = (c, check = null) => new $InstanceOf(c, check), $$instanceOf = $constructedBy($InstanceOf), $$schema = $instanceOf(Schema), $Lambda = class extends Schema {
  /**
   * @param {Args} args
   */
  constructor(args2) {
    super(), this.len = args2.length - 1, this.args = $tuple(...args2.slice(-1)), this.res = args2[this.len];
  }
  /**
   * @param {any} f
   * @param {ValidationError} err
   * @return {f is _LArgsToLambdaDef<Args>}
   */
  check(f, err) {
    let c = f.constructor === Function && f.length <= this.len;
    return !c && err?.extend(null, "function", typeof f), c;
  }
};
var $$lambda = $constructedBy($Lambda), $function = $custom((o) => typeof o == "function"), $Intersection = class extends Schema {
  /**
   * @param {T} v
   */
  constructor(v) {
    super(), this.shape = v;
  }
  /**
   * @param {any} o
   * @param {ValidationError} [err]
   * @return {o is Intersect<UnwrapArray<T>>}
   */
  check(o, err) {
    let c = every(this.shape, (check) => check.check(o, err));
    return !c && err?.extend(null, "Intersectinon", typeof o), c;
  }
};
var $$intersect = $constructedBy($Intersection, (o) => o.shape.length > 0), $Union = class extends Schema {
  static _dilutes = !0;
  /**
   * @param {Array<Schema<S>>} v
   */
  constructor(v) {
    super(), this.shape = v;
  }
  /**
   * @param {any} o
   * @param {ValidationError} [err]
   * @return {o is S}
   */
  check(o, err) {
    let c = some(this.shape, (vv) => vv.check(o, err));
    return err?.extend(null, "Union", typeof o), c;
  }
}, $union = (...schemas) => schemas.findIndex(($s) => $$union.check($s)) >= 0 ? $union(...schemas.map(($s) => $($s)).map(($s) => $$union.check($s) ? $s.shape : [$s]).flat(1)) : schemas.length === 1 ? schemas[0] : new $Union(schemas), $$union = (
  /** @type {Schema<$Union<any>>} */
  $constructedBy($Union)
), _t = () => !0, $any = $custom(_t), $$any = (
  /** @type {Schema<Schema<any>>} */
  $constructedBy($Custom, (o) => o.shape === _t)
), $bigint = $custom((o) => typeof o == "bigint"), $$bigint = (
  /** @type {Schema<Schema<BigInt>>} */
  $custom((o) => o === $bigint)
), $symbol = $custom((o) => typeof o == "symbol"), $$symbol = (
  /** @type {Schema<Schema<Symbol>>} */
  $custom((o) => o === $symbol)
), $number = $custom((o) => typeof o == "number"), $$number = (
  /** @type {Schema<Schema<number>>} */
  $custom((o) => o === $number)
), $string = $custom((o) => typeof o == "string"), $$string = (
  /** @type {Schema<Schema<string>>} */
  $custom((o) => o === $string)
), $boolean = $custom((o) => typeof o == "boolean"), $$boolean = (
  /** @type {Schema<Schema<Boolean>>} */
  $custom((o) => o === $boolean)
), $undefined = $literal(void 0), $$undefined = (
  /** @type {Schema<Schema<undefined>>} */
  $constructedBy($Literal, (o) => o.shape.length === 1 && o.shape[0] === void 0)
), $void = $literal(void 0);
var $null = $literal(null), $$null = (
  /** @type {Schema<Schema<null>>} */
  $constructedBy($Literal, (o) => o.shape.length === 1 && o.shape[0] === null)
), $uint8Array = $constructedBy(Uint8Array), $$uint8Array = (
  /** @type {Schema<Schema<Uint8Array>>} */
  $constructedBy($ConstructedBy, (o) => o.shape === Uint8Array)
), $primitive = $union($number, $string, $null, $undefined, $bigint, $boolean, $symbol), $json = (() => {
  let $jsonArr = (
    /** @type {$Array<$any>} */
    $array($any)
  ), $jsonRecord = (
    /** @type {$Record<$string,$any>} */
    $record($string, $any)
  ), $json2 = $union($number, $string, $null, $boolean, $jsonArr, $jsonRecord);
  return $jsonArr.shape = $json2, $jsonRecord.shape.values = $json2, $json2;
})(), $ = (o) => {
  if ($$schema.check(o))
    return (
      /** @type {any} */
      o
    );
  if ($objectAny.check(o)) {
    let o2 = {};
    for (let k in o)
      o2[k] = $(o[k]);
    return (
      /** @type {any} */
      $object(o2)
    );
  } else {
    if ($arrayAny.check(o))
      return (
        /** @type {any} */
        $union(...o.map($))
      );
    if ($primitive.check(o))
      return (
        /** @type {any} */
        $literal(o)
      );
    if ($function.check(o))
      return (
        /** @type {any} */
        $constructedBy(
          /** @type {any} */
          o
        )
      );
  }
  unexpectedCase();
}, assert = production ? () => {
} : (o, schema) => {
  let err = new ValidationError();
  if (!schema.check(o, err))
    throw create3(`Expected value to be of type ${schema.constructor.name}.
${err.toString()}`);
}, PatternMatcher = class {
  /**
   * @param {Schema<State>} [$state]
   */
  constructor($state) {
    this.patterns = [], this.$state = $state;
  }
  /**
   * @template P
   * @template R
   * @param {P} pattern
   * @param {(o:NoInfer<Unwrap<ReadSchema<P>>>,s:State)=>R} handler
   * @return {PatternMatcher<State,Patterns|Pattern<Unwrap<ReadSchema<P>>,R>>}
   */
  if(pattern, handler) {
    return this.patterns.push({ if: $(pattern), h: handler }), this;
  }
  /**
   * @template R
   * @param {(o:any,s:State)=>R} h
   */
  else(h) {
    return this.if($any, h);
  }
  /**
   * @return {State extends undefined
   *   ? <In extends Unwrap<Patterns['if']>>(o:In,state?:undefined)=>PatternMatchResult<Patterns,In>
   *   : <In extends Unwrap<Patterns['if']>>(o:In,state:State)=>PatternMatchResult<Patterns,In>}
   */
  done() {
    return (
      /** @type {any} */
      (o, s) => {
        for (let i = 0; i < this.patterns.length; i++) {
          let p = this.patterns[i];
          if (p.if.check(o))
            return p.h(o, s);
        }
        throw create3("Unhandled pattern");
      }
    );
  }
}, match = (state) => new PatternMatcher(
  /** @type {any} */
  state
), _random = (
  /** @type {any} */
  match(
    /** @type {Schema<prng.PRNG>} */
    $any
  ).if($$number, (_o, gen) => int53(gen, MIN_SAFE_INTEGER, MAX_SAFE_INTEGER)).if($$string, (_o, gen) => word(gen)).if($$boolean, (_o, gen) => bool(gen)).if($$bigint, (_o, gen) => BigInt(int53(gen, MIN_SAFE_INTEGER, MAX_SAFE_INTEGER))).if($$union, (o, gen) => random(gen, oneOf(gen, o.shape))).if($$object, (o, gen) => {
    let res = {};
    for (let k in o.shape) {
      let prop = o.shape[k];
      if ($$optional.check(prop)) {
        if (bool(gen))
          continue;
        prop = prop.shape;
      }
      res[k] = _random(prop, gen);
    }
    return res;
  }).if($$array, (o, gen) => {
    let arr = [], n = int32(gen, 0, 42);
    for (let i = 0; i < n; i++)
      arr.push(random(gen, o.shape));
    return arr;
  }).if($$literal, (o, gen) => oneOf(gen, o.shape)).if($$null, (o, gen) => null).if($$lambda, (o, gen) => {
    let res = random(gen, o.res);
    return () => res;
  }).if($$any, (o, gen) => random(gen, oneOf(gen, [
    $number,
    $string,
    $null,
    $undefined,
    $bigint,
    $boolean,
    $array($number),
    $record($union("a", "b", "c"), $number)
  ]))).if($$record, (o, gen) => {
    let res = {}, keysN = int53(gen, 0, 3);
    for (let i = 0; i < keysN; i++) {
      let key = random(gen, o.shape.keys), val = random(gen, o.shape.values);
      res[key] = val;
    }
    return res;
  }).done()
), random = (gen, schema) => (
  /** @type {any} */
  _random($(schema), gen)
);

// node_modules/lib0/dom.js
var doc = (
  /** @type {Document} */
  typeof document < "u" ? document : {}
);
var $fragment = $custom((el) => el.nodeType === DOCUMENT_FRAGMENT_NODE);
var domParser = (
  /** @type {DOMParser} */
  typeof DOMParser < "u" ? new DOMParser() : null
);
var $element = $custom((el) => el.nodeType === ELEMENT_NODE);
var $text = $custom((el) => el.nodeType === TEXT_NODE);
var mapToStyleString = (m) => map(m, (value, key) => `${key}:${value};`).join("");
var ELEMENT_NODE = doc.ELEMENT_NODE, TEXT_NODE = doc.TEXT_NODE, CDATA_SECTION_NODE = doc.CDATA_SECTION_NODE, COMMENT_NODE = doc.COMMENT_NODE, DOCUMENT_NODE = doc.DOCUMENT_NODE, DOCUMENT_TYPE_NODE = doc.DOCUMENT_TYPE_NODE, DOCUMENT_FRAGMENT_NODE = doc.DOCUMENT_FRAGMENT_NODE, $node = $custom((el) => el.nodeType === DOCUMENT_NODE);

// node_modules/lib0/symbol.js
var create6 = Symbol;

// node_modules/lib0/logging.common.js
var BOLD = create6(), UNBOLD = create6(), BLUE = create6(), GREY = create6(), GREEN = create6(), RED = create6(), PURPLE = create6(), ORANGE = create6(), UNCOLOR = create6(), computeNoColorLoggingArgs = (args2) => {
  args2.length === 1 && args2[0]?.constructor === Function && (args2 = /** @type {Array<string|Symbol|Object|number>} */
  /** @type {[function]} */
  args2[0]());
  let strBuilder = [], logArgs = [], i = 0;
  for (; i < args2.length; i++) {
    let arg = args2[i];
    if (arg === void 0)
      break;
    if (arg.constructor === String || arg.constructor === Number)
      strBuilder.push(arg);
    else if (arg.constructor === Object)
      break;
  }
  for (i > 0 && logArgs.push(strBuilder.join("")); i < args2.length; i++) {
    let arg = args2[i];
    arg instanceof Symbol || logArgs.push(arg);
  }
  return logArgs;
};
var lastLoggingTime = getUnixTime();

// node_modules/lib0/logging.js
var _browserStyleMap = {
  [BOLD]: create5("font-weight", "bold"),
  [UNBOLD]: create5("font-weight", "normal"),
  [BLUE]: create5("color", "blue"),
  [GREEN]: create5("color", "green"),
  [GREY]: create5("color", "grey"),
  [RED]: create5("color", "red"),
  [PURPLE]: create5("color", "purple"),
  [ORANGE]: create5("color", "orange"),
  // not well supported in chrome when debugging node with inspector - TODO: deprecate
  [UNCOLOR]: create5("color", "black")
}, computeBrowserLoggingArgs = (args2) => {
  args2.length === 1 && args2[0]?.constructor === Function && (args2 = /** @type {Array<string|Symbol|Object|number>} */
  /** @type {[function]} */
  args2[0]());
  let strBuilder = [], styles = [], currentStyle = create(), logArgs = [], i = 0;
  for (; i < args2.length; i++) {
    let arg = args2[i], style = _browserStyleMap[arg];
    if (style !== void 0)
      currentStyle.set(style.left, style.right);
    else {
      if (arg === void 0)
        break;
      if (arg.constructor === String || arg.constructor === Number) {
        let style2 = mapToStyleString(currentStyle);
        i > 0 || style2.length > 0 ? (strBuilder.push("%c" + arg), styles.push(style2)) : strBuilder.push(arg);
      } else
        break;
    }
  }
  for (i > 0 && (logArgs = styles, logArgs.unshift(strBuilder.join(""))); i < args2.length; i++) {
    let arg = args2[i];
    arg instanceof Symbol || logArgs.push(arg);
  }
  return logArgs;
}, computeLoggingArgs = supportsColor ? computeBrowserLoggingArgs : computeNoColorLoggingArgs, print = (...args2) => {
  console.log(...computeLoggingArgs(args2)), vconsoles.forEach((vc) => vc.print(args2));
}, warn = (...args2) => {
  console.warn(...computeLoggingArgs(args2)), args2.unshift(ORANGE), vconsoles.forEach((vc) => vc.print(args2));
};
var vconsoles = create2();

// node_modules/lib0/iterator.js
var createIterator = (next) => ({
  /**
   * @return {IterableIterator<T>}
   */
  [Symbol.iterator]() {
    return this;
  },
  // @ts-ignore
  next
}), iteratorFilter = (iterator, filter) => createIterator(() => {
  let res;
  do
    res = iterator.next();
  while (!res.done && !filter(res.value));
  return res;
}), iteratorMap = (iterator, fmap) => createIterator(() => {
  let { done, value } = iterator.next();
  return { done, value: done ? void 0 : fmap(value) };
});

// node_modules/yjs/dist/yjs.mjs
var AbstractConnector = class extends ObservableV2 {
  /**
   * @param {Doc} ydoc
   * @param {any} awareness
   */
  constructor(ydoc, awareness) {
    super(), this.doc = ydoc, this.awareness = awareness;
  }
}, DeleteItem = class {
  /**
   * @param {number} clock
   * @param {number} len
   */
  constructor(clock, len) {
    this.clock = clock, this.len = len;
  }
}, DeleteSet = class {
  constructor() {
    this.clients = /* @__PURE__ */ new Map();
  }
}, iterateDeletedStructs = (transaction, ds, f) => ds.clients.forEach((deletes, clientid) => {
  let structs = (
    /** @type {Array<GC|Item>} */
    transaction.doc.store.clients.get(clientid)
  );
  if (structs != null) {
    let lastStruct = structs[structs.length - 1], clockState = lastStruct.id.clock + lastStruct.length;
    for (let i = 0, del = deletes[i]; i < deletes.length && del.clock < clockState; del = deletes[++i])
      iterateStructs(transaction, structs, del.clock, del.len, f);
  }
}), findIndexDS = (dis, clock) => {
  let left = 0, right = dis.length - 1;
  for (; left <= right; ) {
    let midindex = floor((left + right) / 2), mid = dis[midindex], midclock = mid.clock;
    if (midclock <= clock) {
      if (clock < midclock + mid.len)
        return midindex;
      left = midindex + 1;
    } else
      right = midindex - 1;
  }
  return null;
}, isDeleted = (ds, id2) => {
  let dis = ds.clients.get(id2.client);
  return dis !== void 0 && findIndexDS(dis, id2.clock) !== null;
}, sortAndMergeDeleteSet = (ds) => {
  ds.clients.forEach((dels) => {
    dels.sort((a, b) => a.clock - b.clock);
    let i, j;
    for (i = 1, j = 1; i < dels.length; i++) {
      let left = dels[j - 1], right = dels[i];
      left.clock + left.len >= right.clock ? dels[j - 1] = new DeleteItem(left.clock, max(left.len, right.clock + right.len - left.clock)) : (j < i && (dels[j] = right), j++);
    }
    dels.length = j;
  });
}, mergeDeleteSets = (dss) => {
  let merged = new DeleteSet();
  for (let dssI = 0; dssI < dss.length; dssI++)
    dss[dssI].clients.forEach((delsLeft, client) => {
      if (!merged.clients.has(client)) {
        let dels = delsLeft.slice();
        for (let i = dssI + 1; i < dss.length; i++)
          appendTo(dels, dss[i].clients.get(client) || []);
        merged.clients.set(client, dels);
      }
    });
  return sortAndMergeDeleteSet(merged), merged;
}, addToDeleteSet = (ds, client, clock, length2) => {
  setIfUndefined(ds.clients, client, () => (
    /** @type {Array<DeleteItem>} */
    []
  )).push(new DeleteItem(clock, length2));
}, createDeleteSet = () => new DeleteSet(), createDeleteSetFromStructStore = (ss) => {
  let ds = createDeleteSet();
  return ss.clients.forEach((structs, client) => {
    let dsitems = [];
    for (let i = 0; i < structs.length; i++) {
      let struct = structs[i];
      if (struct.deleted) {
        let clock = struct.id.clock, len = struct.length;
        if (i + 1 < structs.length)
          for (let next = structs[i + 1]; i + 1 < structs.length && next.deleted; next = structs[++i + 1])
            len += next.length;
        dsitems.push(new DeleteItem(clock, len));
      }
    }
    dsitems.length > 0 && ds.clients.set(client, dsitems);
  }), ds;
}, writeDeleteSet = (encoder, ds) => {
  writeVarUint(encoder.restEncoder, ds.clients.size), from(ds.clients.entries()).sort((a, b) => b[0] - a[0]).forEach(([client, dsitems]) => {
    encoder.resetDsCurVal(), writeVarUint(encoder.restEncoder, client);
    let len = dsitems.length;
    writeVarUint(encoder.restEncoder, len);
    for (let i = 0; i < len; i++) {
      let item = dsitems[i];
      encoder.writeDsClock(item.clock), encoder.writeDsLen(item.len);
    }
  });
}, readDeleteSet = (decoder) => {
  let ds = new DeleteSet(), numClients = readVarUint(decoder.restDecoder);
  for (let i = 0; i < numClients; i++) {
    decoder.resetDsCurVal();
    let client = readVarUint(decoder.restDecoder), numberOfDeletes = readVarUint(decoder.restDecoder);
    if (numberOfDeletes > 0) {
      let dsField = setIfUndefined(ds.clients, client, () => (
        /** @type {Array<DeleteItem>} */
        []
      ));
      for (let i2 = 0; i2 < numberOfDeletes; i2++)
        dsField.push(new DeleteItem(decoder.readDsClock(), decoder.readDsLen()));
    }
  }
  return ds;
}, readAndApplyDeleteSet = (decoder, transaction, store) => {
  let unappliedDS = new DeleteSet(), numClients = readVarUint(decoder.restDecoder);
  for (let i = 0; i < numClients; i++) {
    decoder.resetDsCurVal();
    let client = readVarUint(decoder.restDecoder), numberOfDeletes = readVarUint(decoder.restDecoder), structs = store.clients.get(client) || [], state = getState(store, client);
    for (let i2 = 0; i2 < numberOfDeletes; i2++) {
      let clock = decoder.readDsClock(), clockEnd = clock + decoder.readDsLen();
      if (clock < state) {
        state < clockEnd && addToDeleteSet(unappliedDS, client, state, clockEnd - state);
        let index = findIndexSS(structs, clock), struct = structs[index];
        for (!struct.deleted && struct.id.clock < clock && (structs.splice(index + 1, 0, splitItem(transaction, struct, clock - struct.id.clock)), index++); index < structs.length && (struct = structs[index++], struct.id.clock < clockEnd); )
          struct.deleted || (clockEnd < struct.id.clock + struct.length && structs.splice(index, 0, splitItem(transaction, struct, clockEnd - struct.id.clock)), struct.delete(transaction));
      } else
        addToDeleteSet(unappliedDS, client, clock, clockEnd - clock);
    }
  }
  if (unappliedDS.clients.size > 0) {
    let ds = new UpdateEncoderV2();
    return writeVarUint(ds.restEncoder, 0), writeDeleteSet(ds, unappliedDS), ds.toUint8Array();
  }
  return null;
}, equalDeleteSets = (ds1, ds2) => {
  if (ds1.clients.size !== ds2.clients.size) return !1;
  for (let [client, deleteItems1] of ds1.clients.entries()) {
    let deleteItems2 = (
      /** @type {Array<import('../internals.js').DeleteItem>} */
      ds2.clients.get(client)
    );
    if (deleteItems2 === void 0 || deleteItems1.length !== deleteItems2.length) return !1;
    for (let i = 0; i < deleteItems1.length; i++) {
      let di1 = deleteItems1[i], di2 = deleteItems2[i];
      if (di1.clock !== di2.clock || di1.len !== di2.len)
        return !1;
    }
  }
  return !0;
}, generateNewClientId = uint32, Doc = class _Doc extends ObservableV2 {
  /**
   * @param {DocOpts} opts configuration
   */
  constructor({ guid = uuidv4(), collectionid = null, gc = !0, gcFilter = () => !0, meta = null, autoLoad = !1, shouldLoad = !0 } = {}) {
    super(), this.gc = gc, this.gcFilter = gcFilter, this.clientID = generateNewClientId(), this.guid = guid, this.collectionid = collectionid, this.share = /* @__PURE__ */ new Map(), this.store = new StructStore(), this._transaction = null, this._transactionCleanups = [], this.subdocs = /* @__PURE__ */ new Set(), this._item = null, this.shouldLoad = shouldLoad, this.autoLoad = autoLoad, this.meta = meta, this.isLoaded = !1, this.isSynced = !1, this.isDestroyed = !1, this.whenLoaded = create4((resolve) => {
      this.on("load", () => {
        this.isLoaded = !0, resolve(this);
      });
    });
    let provideSyncedPromise = () => create4((resolve) => {
      let eventHandler = (isSynced) => {
        (isSynced === void 0 || isSynced === !0) && (this.off("sync", eventHandler), resolve());
      };
      this.on("sync", eventHandler);
    });
    this.on("sync", (isSynced) => {
      isSynced === !1 && this.isSynced && (this.whenSynced = provideSyncedPromise()), this.isSynced = isSynced === void 0 || isSynced === !0, this.isSynced && !this.isLoaded && this.emit("load", [this]);
    }), this.whenSynced = provideSyncedPromise();
  }
  /**
   * Notify the parent document that you request to load data into this subdocument (if it is a subdocument).
   *
   * `load()` might be used in the future to request any provider to load the most current data.
   *
   * It is safe to call `load()` multiple times.
   */
  load() {
    let item = this._item;
    item !== null && !this.shouldLoad && transact(
      /** @type {any} */
      item.parent.doc,
      (transaction) => {
        transaction.subdocsLoaded.add(this);
      },
      null,
      !0
    ), this.shouldLoad = !0;
  }
  getSubdocs() {
    return this.subdocs;
  }
  getSubdocGuids() {
    return new Set(from(this.subdocs).map((doc2) => doc2.guid));
  }
  /**
   * Changes that happen inside of a transaction are bundled. This means that
   * the observer fires _after_ the transaction is finished and that all changes
   * that happened inside of the transaction are sent as one message to the
   * other peers.
   *
   * @template T
   * @param {function(Transaction):T} f The function that should be executed as a transaction
   * @param {any} [origin] Origin of who started the transaction. Will be stored on transaction.origin
   * @return T
   *
   * @public
   */
  transact(f, origin = null) {
    return transact(this, f, origin);
  }
  /**
   * Define a shared data type.
   *
   * Multiple calls of `ydoc.get(name, TypeConstructor)` yield the same result
   * and do not overwrite each other. I.e.
   * `ydoc.get(name, Y.Array) === ydoc.get(name, Y.Array)`
   *
   * After this method is called, the type is also available on `ydoc.share.get(name)`.
   *
   * *Best Practices:*
   * Define all types right after the Y.Doc instance is created and store them in a separate object.
   * Also use the typed methods `getText(name)`, `getArray(name)`, ..
   *
   * @template {typeof AbstractType<any>} Type
   * @example
   *   const ydoc = new Y.Doc(..)
   *   const appState = {
   *     document: ydoc.getText('document')
   *     comments: ydoc.getArray('comments')
   *   }
   *
   * @param {string} name
   * @param {Type} TypeConstructor The constructor of the type definition. E.g. Y.Text, Y.Array, Y.Map, ...
   * @return {InstanceType<Type>} The created type. Constructed with TypeConstructor
   *
   * @public
   */
  get(name, TypeConstructor = (
    /** @type {any} */
    AbstractType
  )) {
    let type = setIfUndefined(this.share, name, () => {
      let t = new TypeConstructor();
      return t._integrate(this, null), t;
    }), Constr = type.constructor;
    if (TypeConstructor !== AbstractType && Constr !== TypeConstructor)
      if (Constr === AbstractType) {
        let t = new TypeConstructor();
        t._map = type._map, type._map.forEach(
          /** @param {Item?} n */
          (n) => {
            for (; n !== null; n = n.left)
              n.parent = t;
          }
        ), t._start = type._start;
        for (let n = t._start; n !== null; n = n.right)
          n.parent = t;
        return t._length = type._length, this.share.set(name, t), t._integrate(this, null), /** @type {InstanceType<Type>} */
        t;
      } else
        throw new Error(`Type with the name ${name} has already been defined with a different constructor`);
    return (
      /** @type {InstanceType<Type>} */
      type
    );
  }
  /**
   * @template T
   * @param {string} [name]
   * @return {YArray<T>}
   *
   * @public
   */
  getArray(name = "") {
    return (
      /** @type {YArray<T>} */
      this.get(name, YArray)
    );
  }
  /**
   * @param {string} [name]
   * @return {YText}
   *
   * @public
   */
  getText(name = "") {
    return this.get(name, YText);
  }
  /**
   * @template T
   * @param {string} [name]
   * @return {YMap<T>}
   *
   * @public
   */
  getMap(name = "") {
    return (
      /** @type {YMap<T>} */
      this.get(name, YMap)
    );
  }
  /**
   * @param {string} [name]
   * @return {YXmlElement}
   *
   * @public
   */
  getXmlElement(name = "") {
    return (
      /** @type {YXmlElement<{[key:string]:string}>} */
      this.get(name, YXmlElement)
    );
  }
  /**
   * @param {string} [name]
   * @return {YXmlFragment}
   *
   * @public
   */
  getXmlFragment(name = "") {
    return this.get(name, YXmlFragment);
  }
  /**
   * Converts the entire document into a js object, recursively traversing each yjs type
   * Doesn't log types that have not been defined (using ydoc.getType(..)).
   *
   * @deprecated Do not use this method and rather call toJSON directly on the shared types.
   *
   * @return {Object<string, any>}
   */
  toJSON() {
    let doc2 = {};
    return this.share.forEach((value, key) => {
      doc2[key] = value.toJSON();
    }), doc2;
  }
  /**
   * Emit `destroy` event and unregister all event handlers.
   */
  destroy() {
    this.isDestroyed = !0, from(this.subdocs).forEach((subdoc) => subdoc.destroy());
    let item = this._item;
    if (item !== null) {
      this._item = null;
      let content = (
        /** @type {ContentDoc} */
        item.content
      );
      content.doc = new _Doc({ guid: this.guid, ...content.opts, shouldLoad: !1 }), content.doc._item = item, transact(
        /** @type {any} */
        item.parent.doc,
        (transaction) => {
          let doc2 = content.doc;
          item.deleted || transaction.subdocsAdded.add(doc2), transaction.subdocsRemoved.add(this);
        },
        null,
        !0
      );
    }
    this.emit("destroyed", [!0]), this.emit("destroy", [this]), super.destroy();
  }
}, DSDecoderV1 = class {
  /**
   * @param {decoding.Decoder} decoder
   */
  constructor(decoder) {
    this.restDecoder = decoder;
  }
  resetDsCurVal() {
  }
  /**
   * @return {number}
   */
  readDsClock() {
    return readVarUint(this.restDecoder);
  }
  /**
   * @return {number}
   */
  readDsLen() {
    return readVarUint(this.restDecoder);
  }
}, UpdateDecoderV1 = class extends DSDecoderV1 {
  /**
   * @return {ID}
   */
  readLeftID() {
    return createID(readVarUint(this.restDecoder), readVarUint(this.restDecoder));
  }
  /**
   * @return {ID}
   */
  readRightID() {
    return createID(readVarUint(this.restDecoder), readVarUint(this.restDecoder));
  }
  /**
   * Read the next client id.
   * Use this in favor of readID whenever possible to reduce the number of objects created.
   */
  readClient() {
    return readVarUint(this.restDecoder);
  }
  /**
   * @return {number} info An unsigned 8-bit integer
   */
  readInfo() {
    return readUint8(this.restDecoder);
  }
  /**
   * @return {string}
   */
  readString() {
    return readVarString(this.restDecoder);
  }
  /**
   * @return {boolean} isKey
   */
  readParentInfo() {
    return readVarUint(this.restDecoder) === 1;
  }
  /**
   * @return {number} info An unsigned 8-bit integer
   */
  readTypeRef() {
    return readVarUint(this.restDecoder);
  }
  /**
   * Write len of a struct - well suited for Opt RLE encoder.
   *
   * @return {number} len
   */
  readLen() {
    return readVarUint(this.restDecoder);
  }
  /**
   * @return {any}
   */
  readAny() {
    return readAny(this.restDecoder);
  }
  /**
   * @return {Uint8Array}
   */
  readBuf() {
    return copyUint8Array(readVarUint8Array(this.restDecoder));
  }
  /**
   * Legacy implementation uses JSON parse. We use any-decoding in v2.
   *
   * @return {any}
   */
  readJSON() {
    return JSON.parse(readVarString(this.restDecoder));
  }
  /**
   * @return {string}
   */
  readKey() {
    return readVarString(this.restDecoder);
  }
}, DSDecoderV2 = class {
  /**
   * @param {decoding.Decoder} decoder
   */
  constructor(decoder) {
    this.dsCurrVal = 0, this.restDecoder = decoder;
  }
  resetDsCurVal() {
    this.dsCurrVal = 0;
  }
  /**
   * @return {number}
   */
  readDsClock() {
    return this.dsCurrVal += readVarUint(this.restDecoder), this.dsCurrVal;
  }
  /**
   * @return {number}
   */
  readDsLen() {
    let diff = readVarUint(this.restDecoder) + 1;
    return this.dsCurrVal += diff, diff;
  }
}, UpdateDecoderV2 = class extends DSDecoderV2 {
  /**
   * @param {decoding.Decoder} decoder
   */
  constructor(decoder) {
    super(decoder), this.keys = [], readVarUint(decoder), this.keyClockDecoder = new IntDiffOptRleDecoder(readVarUint8Array(decoder)), this.clientDecoder = new UintOptRleDecoder(readVarUint8Array(decoder)), this.leftClockDecoder = new IntDiffOptRleDecoder(readVarUint8Array(decoder)), this.rightClockDecoder = new IntDiffOptRleDecoder(readVarUint8Array(decoder)), this.infoDecoder = new RleDecoder(readVarUint8Array(decoder), readUint8), this.stringDecoder = new StringDecoder(readVarUint8Array(decoder)), this.parentInfoDecoder = new RleDecoder(readVarUint8Array(decoder), readUint8), this.typeRefDecoder = new UintOptRleDecoder(readVarUint8Array(decoder)), this.lenDecoder = new UintOptRleDecoder(readVarUint8Array(decoder));
  }
  /**
   * @return {ID}
   */
  readLeftID() {
    return new ID(this.clientDecoder.read(), this.leftClockDecoder.read());
  }
  /**
   * @return {ID}
   */
  readRightID() {
    return new ID(this.clientDecoder.read(), this.rightClockDecoder.read());
  }
  /**
   * Read the next client id.
   * Use this in favor of readID whenever possible to reduce the number of objects created.
   */
  readClient() {
    return this.clientDecoder.read();
  }
  /**
   * @return {number} info An unsigned 8-bit integer
   */
  readInfo() {
    return (
      /** @type {number} */
      this.infoDecoder.read()
    );
  }
  /**
   * @return {string}
   */
  readString() {
    return this.stringDecoder.read();
  }
  /**
   * @return {boolean}
   */
  readParentInfo() {
    return this.parentInfoDecoder.read() === 1;
  }
  /**
   * @return {number} An unsigned 8-bit integer
   */
  readTypeRef() {
    return this.typeRefDecoder.read();
  }
  /**
   * Write len of a struct - well suited for Opt RLE encoder.
   *
   * @return {number}
   */
  readLen() {
    return this.lenDecoder.read();
  }
  /**
   * @return {any}
   */
  readAny() {
    return readAny(this.restDecoder);
  }
  /**
   * @return {Uint8Array}
   */
  readBuf() {
    return readVarUint8Array(this.restDecoder);
  }
  /**
   * This is mainly here for legacy purposes.
   *
   * Initial we incoded objects using JSON. Now we use the much faster lib0/any-encoder. This method mainly exists for legacy purposes for the v1 encoder.
   *
   * @return {any}
   */
  readJSON() {
    return readAny(this.restDecoder);
  }
  /**
   * @return {string}
   */
  readKey() {
    let keyClock = this.keyClockDecoder.read();
    if (keyClock < this.keys.length)
      return this.keys[keyClock];
    {
      let key = this.stringDecoder.read();
      return this.keys.push(key), key;
    }
  }
}, DSEncoderV1 = class {
  constructor() {
    this.restEncoder = createEncoder();
  }
  toUint8Array() {
    return toUint8Array(this.restEncoder);
  }
  resetDsCurVal() {
  }
  /**
   * @param {number} clock
   */
  writeDsClock(clock) {
    writeVarUint(this.restEncoder, clock);
  }
  /**
   * @param {number} len
   */
  writeDsLen(len) {
    writeVarUint(this.restEncoder, len);
  }
}, UpdateEncoderV1 = class extends DSEncoderV1 {
  /**
   * @param {ID} id
   */
  writeLeftID(id2) {
    writeVarUint(this.restEncoder, id2.client), writeVarUint(this.restEncoder, id2.clock);
  }
  /**
   * @param {ID} id
   */
  writeRightID(id2) {
    writeVarUint(this.restEncoder, id2.client), writeVarUint(this.restEncoder, id2.clock);
  }
  /**
   * Use writeClient and writeClock instead of writeID if possible.
   * @param {number} client
   */
  writeClient(client) {
    writeVarUint(this.restEncoder, client);
  }
  /**
   * @param {number} info An unsigned 8-bit integer
   */
  writeInfo(info) {
    writeUint8(this.restEncoder, info);
  }
  /**
   * @param {string} s
   */
  writeString(s) {
    writeVarString(this.restEncoder, s);
  }
  /**
   * @param {boolean} isYKey
   */
  writeParentInfo(isYKey) {
    writeVarUint(this.restEncoder, isYKey ? 1 : 0);
  }
  /**
   * @param {number} info An unsigned 8-bit integer
   */
  writeTypeRef(info) {
    writeVarUint(this.restEncoder, info);
  }
  /**
   * Write len of a struct - well suited for Opt RLE encoder.
   *
   * @param {number} len
   */
  writeLen(len) {
    writeVarUint(this.restEncoder, len);
  }
  /**
   * @param {any} any
   */
  writeAny(any2) {
    writeAny(this.restEncoder, any2);
  }
  /**
   * @param {Uint8Array} buf
   */
  writeBuf(buf) {
    writeVarUint8Array(this.restEncoder, buf);
  }
  /**
   * @param {any} embed
   */
  writeJSON(embed) {
    writeVarString(this.restEncoder, JSON.stringify(embed));
  }
  /**
   * @param {string} key
   */
  writeKey(key) {
    writeVarString(this.restEncoder, key);
  }
}, DSEncoderV2 = class {
  constructor() {
    this.restEncoder = createEncoder(), this.dsCurrVal = 0;
  }
  toUint8Array() {
    return toUint8Array(this.restEncoder);
  }
  resetDsCurVal() {
    this.dsCurrVal = 0;
  }
  /**
   * @param {number} clock
   */
  writeDsClock(clock) {
    let diff = clock - this.dsCurrVal;
    this.dsCurrVal = clock, writeVarUint(this.restEncoder, diff);
  }
  /**
   * @param {number} len
   */
  writeDsLen(len) {
    len === 0 && unexpectedCase(), writeVarUint(this.restEncoder, len - 1), this.dsCurrVal += len;
  }
}, UpdateEncoderV2 = class extends DSEncoderV2 {
  constructor() {
    super(), this.keyMap = /* @__PURE__ */ new Map(), this.keyClock = 0, this.keyClockEncoder = new IntDiffOptRleEncoder(), this.clientEncoder = new UintOptRleEncoder(), this.leftClockEncoder = new IntDiffOptRleEncoder(), this.rightClockEncoder = new IntDiffOptRleEncoder(), this.infoEncoder = new RleEncoder(writeUint8), this.stringEncoder = new StringEncoder(), this.parentInfoEncoder = new RleEncoder(writeUint8), this.typeRefEncoder = new UintOptRleEncoder(), this.lenEncoder = new UintOptRleEncoder();
  }
  toUint8Array() {
    let encoder = createEncoder();
    return writeVarUint(encoder, 0), writeVarUint8Array(encoder, this.keyClockEncoder.toUint8Array()), writeVarUint8Array(encoder, this.clientEncoder.toUint8Array()), writeVarUint8Array(encoder, this.leftClockEncoder.toUint8Array()), writeVarUint8Array(encoder, this.rightClockEncoder.toUint8Array()), writeVarUint8Array(encoder, toUint8Array(this.infoEncoder)), writeVarUint8Array(encoder, this.stringEncoder.toUint8Array()), writeVarUint8Array(encoder, toUint8Array(this.parentInfoEncoder)), writeVarUint8Array(encoder, this.typeRefEncoder.toUint8Array()), writeVarUint8Array(encoder, this.lenEncoder.toUint8Array()), writeUint8Array(encoder, toUint8Array(this.restEncoder)), toUint8Array(encoder);
  }
  /**
   * @param {ID} id
   */
  writeLeftID(id2) {
    this.clientEncoder.write(id2.client), this.leftClockEncoder.write(id2.clock);
  }
  /**
   * @param {ID} id
   */
  writeRightID(id2) {
    this.clientEncoder.write(id2.client), this.rightClockEncoder.write(id2.clock);
  }
  /**
   * @param {number} client
   */
  writeClient(client) {
    this.clientEncoder.write(client);
  }
  /**
   * @param {number} info An unsigned 8-bit integer
   */
  writeInfo(info) {
    this.infoEncoder.write(info);
  }
  /**
   * @param {string} s
   */
  writeString(s) {
    this.stringEncoder.write(s);
  }
  /**
   * @param {boolean} isYKey
   */
  writeParentInfo(isYKey) {
    this.parentInfoEncoder.write(isYKey ? 1 : 0);
  }
  /**
   * @param {number} info An unsigned 8-bit integer
   */
  writeTypeRef(info) {
    this.typeRefEncoder.write(info);
  }
  /**
   * Write len of a struct - well suited for Opt RLE encoder.
   *
   * @param {number} len
   */
  writeLen(len) {
    this.lenEncoder.write(len);
  }
  /**
   * @param {any} any
   */
  writeAny(any2) {
    writeAny(this.restEncoder, any2);
  }
  /**
   * @param {Uint8Array} buf
   */
  writeBuf(buf) {
    writeVarUint8Array(this.restEncoder, buf);
  }
  /**
   * This is mainly here for legacy purposes.
   *
   * Initial we incoded objects using JSON. Now we use the much faster lib0/any-encoder. This method mainly exists for legacy purposes for the v1 encoder.
   *
   * @param {any} embed
   */
  writeJSON(embed) {
    writeAny(this.restEncoder, embed);
  }
  /**
   * Property keys are often reused. For example, in y-prosemirror the key `bold` might
   * occur very often. For a 3d application, the key `position` might occur very often.
   *
   * We cache these keys in a Map and refer to them via a unique number.
   *
   * @param {string} key
   */
  writeKey(key) {
    let clock = this.keyMap.get(key);
    clock === void 0 ? (this.keyClockEncoder.write(this.keyClock++), this.stringEncoder.write(key)) : this.keyClockEncoder.write(clock);
  }
}, writeStructs = (encoder, structs, client, clock) => {
  clock = max(clock, structs[0].id.clock);
  let startNewStructs = findIndexSS(structs, clock);
  writeVarUint(encoder.restEncoder, structs.length - startNewStructs), encoder.writeClient(client), writeVarUint(encoder.restEncoder, clock);
  let firstStruct = structs[startNewStructs];
  firstStruct.write(encoder, clock - firstStruct.id.clock);
  for (let i = startNewStructs + 1; i < structs.length; i++)
    structs[i].write(encoder, 0);
}, writeClientsStructs = (encoder, store, _sm) => {
  let sm = /* @__PURE__ */ new Map();
  _sm.forEach((clock, client) => {
    getState(store, client) > clock && sm.set(client, clock);
  }), getStateVector(store).forEach((_clock, client) => {
    _sm.has(client) || sm.set(client, 0);
  }), writeVarUint(encoder.restEncoder, sm.size), from(sm.entries()).sort((a, b) => b[0] - a[0]).forEach(([client, clock]) => {
    writeStructs(
      encoder,
      /** @type {Array<GC|Item>} */
      store.clients.get(client),
      client,
      clock
    );
  });
}, readClientsStructRefs = (decoder, doc2) => {
  let clientRefs = create(), numOfStateUpdates = readVarUint(decoder.restDecoder);
  for (let i = 0; i < numOfStateUpdates; i++) {
    let numberOfStructs = readVarUint(decoder.restDecoder), refs = new Array(numberOfStructs), client = decoder.readClient(), clock = readVarUint(decoder.restDecoder);
    clientRefs.set(client, { i: 0, refs });
    for (let i2 = 0; i2 < numberOfStructs; i2++) {
      let info = decoder.readInfo();
      switch (31 & info) {
        case 0: {
          let len = decoder.readLen();
          refs[i2] = new GC(createID(client, clock), len), clock += len;
          break;
        }
        case 10: {
          let len = readVarUint(decoder.restDecoder);
          refs[i2] = new Skip(createID(client, clock), len), clock += len;
          break;
        }
        default: {
          let cantCopyParentInfo = (info & 192) === 0, struct = new Item(
            createID(client, clock),
            null,
            // left
            (info & 128) === 128 ? decoder.readLeftID() : null,
            // origin
            null,
            // right
            (info & 64) === 64 ? decoder.readRightID() : null,
            // right origin
            cantCopyParentInfo ? decoder.readParentInfo() ? doc2.get(decoder.readString()) : decoder.readLeftID() : null,
            // parent
            cantCopyParentInfo && (info & 32) === 32 ? decoder.readString() : null,
            // parentSub
            readItemContent(decoder, info)
            // item content
          );
          refs[i2] = struct, clock += struct.length;
        }
      }
    }
  }
  return clientRefs;
}, integrateStructs = (transaction, store, clientsStructRefs) => {
  let stack = [], clientsStructRefsIds = from(clientsStructRefs.keys()).sort((a, b) => a - b);
  if (clientsStructRefsIds.length === 0)
    return null;
  let getNextStructTarget = () => {
    if (clientsStructRefsIds.length === 0)
      return null;
    let nextStructsTarget = (
      /** @type {{i:number,refs:Array<GC|Item>}} */
      clientsStructRefs.get(clientsStructRefsIds[clientsStructRefsIds.length - 1])
    );
    for (; nextStructsTarget.refs.length === nextStructsTarget.i; )
      if (clientsStructRefsIds.pop(), clientsStructRefsIds.length > 0)
        nextStructsTarget = /** @type {{i:number,refs:Array<GC|Item>}} */
        clientsStructRefs.get(clientsStructRefsIds[clientsStructRefsIds.length - 1]);
      else
        return null;
    return nextStructsTarget;
  }, curStructsTarget = getNextStructTarget();
  if (curStructsTarget === null)
    return null;
  let restStructs = new StructStore(), missingSV = /* @__PURE__ */ new Map(), updateMissingSv = (client, clock) => {
    let mclock = missingSV.get(client);
    (mclock == null || mclock > clock) && missingSV.set(client, clock);
  }, stackHead = (
    /** @type {any} */
    curStructsTarget.refs[
      /** @type {any} */
      curStructsTarget.i++
    ]
  ), state = /* @__PURE__ */ new Map(), addStackToRestSS = () => {
    for (let item of stack) {
      let client = item.id.client, inapplicableItems = clientsStructRefs.get(client);
      inapplicableItems ? (inapplicableItems.i--, restStructs.clients.set(client, inapplicableItems.refs.slice(inapplicableItems.i)), clientsStructRefs.delete(client), inapplicableItems.i = 0, inapplicableItems.refs = []) : restStructs.clients.set(client, [item]), clientsStructRefsIds = clientsStructRefsIds.filter((c) => c !== client);
    }
    stack.length = 0;
  };
  for (; ; ) {
    if (stackHead.constructor !== Skip) {
      let offset = setIfUndefined(state, stackHead.id.client, () => getState(store, stackHead.id.client)) - stackHead.id.clock;
      if (offset < 0)
        stack.push(stackHead), updateMissingSv(stackHead.id.client, stackHead.id.clock - 1), addStackToRestSS();
      else {
        let missing = stackHead.getMissing(transaction, store);
        if (missing !== null) {
          stack.push(stackHead);
          let structRefs = clientsStructRefs.get(
            /** @type {number} */
            missing
          ) || { refs: [], i: 0 };
          if (structRefs.refs.length === structRefs.i)
            updateMissingSv(
              /** @type {number} */
              missing,
              getState(store, missing)
            ), addStackToRestSS();
          else {
            stackHead = structRefs.refs[structRefs.i++];
            continue;
          }
        } else (offset === 0 || offset < stackHead.length) && (stackHead.integrate(transaction, offset), state.set(stackHead.id.client, stackHead.id.clock + stackHead.length));
      }
    }
    if (stack.length > 0)
      stackHead = /** @type {GC|Item} */
      stack.pop();
    else if (curStructsTarget !== null && curStructsTarget.i < curStructsTarget.refs.length)
      stackHead = /** @type {GC|Item} */
      curStructsTarget.refs[curStructsTarget.i++];
    else {
      if (curStructsTarget = getNextStructTarget(), curStructsTarget === null)
        break;
      stackHead = /** @type {GC|Item} */
      curStructsTarget.refs[curStructsTarget.i++];
    }
  }
  if (restStructs.clients.size > 0) {
    let encoder = new UpdateEncoderV2();
    return writeClientsStructs(encoder, restStructs, /* @__PURE__ */ new Map()), writeVarUint(encoder.restEncoder, 0), { missing: missingSV, update: encoder.toUint8Array() };
  }
  return null;
}, writeStructsFromTransaction = (encoder, transaction) => writeClientsStructs(encoder, transaction.doc.store, transaction.beforeState), readUpdateV2 = (decoder, ydoc, transactionOrigin, structDecoder = new UpdateDecoderV2(decoder)) => transact(ydoc, (transaction) => {
  transaction.local = !1;
  let retry = !1, doc2 = transaction.doc, store = doc2.store, ss = readClientsStructRefs(structDecoder, doc2), restStructs = integrateStructs(transaction, store, ss), pending = store.pendingStructs;
  if (pending) {
    for (let [client, clock] of pending.missing)
      if (clock < getState(store, client)) {
        retry = !0;
        break;
      }
    if (restStructs) {
      for (let [client, clock] of restStructs.missing) {
        let mclock = pending.missing.get(client);
        (mclock == null || mclock > clock) && pending.missing.set(client, clock);
      }
      pending.update = mergeUpdatesV2([pending.update, restStructs.update]);
    }
  } else
    store.pendingStructs = restStructs;
  let dsRest = readAndApplyDeleteSet(structDecoder, transaction, store);
  if (store.pendingDs) {
    let pendingDSUpdate = new UpdateDecoderV2(createDecoder(store.pendingDs));
    readVarUint(pendingDSUpdate.restDecoder);
    let dsRest2 = readAndApplyDeleteSet(pendingDSUpdate, transaction, store);
    dsRest && dsRest2 ? store.pendingDs = mergeUpdatesV2([dsRest, dsRest2]) : store.pendingDs = dsRest || dsRest2;
  } else
    store.pendingDs = dsRest;
  if (retry) {
    let update = (
      /** @type {{update: Uint8Array}} */
      store.pendingStructs.update
    );
    store.pendingStructs = null, applyUpdateV2(transaction.doc, update);
  }
}, transactionOrigin, !1), readUpdate = (decoder, ydoc, transactionOrigin) => readUpdateV2(decoder, ydoc, transactionOrigin, new UpdateDecoderV1(decoder)), applyUpdateV2 = (ydoc, update, transactionOrigin, YDecoder = UpdateDecoderV2) => {
  let decoder = createDecoder(update);
  readUpdateV2(decoder, ydoc, transactionOrigin, new YDecoder(decoder));
}, applyUpdate = (ydoc, update, transactionOrigin) => applyUpdateV2(ydoc, update, transactionOrigin, UpdateDecoderV1), writeStateAsUpdate = (encoder, doc2, targetStateVector = /* @__PURE__ */ new Map()) => {
  writeClientsStructs(encoder, doc2.store, targetStateVector), writeDeleteSet(encoder, createDeleteSetFromStructStore(doc2.store));
}, encodeStateAsUpdateV2 = (doc2, encodedTargetStateVector = new Uint8Array([0]), encoder = new UpdateEncoderV2()) => {
  let targetStateVector = decodeStateVector(encodedTargetStateVector);
  writeStateAsUpdate(encoder, doc2, targetStateVector);
  let updates = [encoder.toUint8Array()];
  if (doc2.store.pendingDs && updates.push(doc2.store.pendingDs), doc2.store.pendingStructs && updates.push(diffUpdateV2(doc2.store.pendingStructs.update, encodedTargetStateVector)), updates.length > 1) {
    if (encoder.constructor === UpdateEncoderV1)
      return mergeUpdates(updates.map((update, i) => i === 0 ? update : convertUpdateFormatV2ToV1(update)));
    if (encoder.constructor === UpdateEncoderV2)
      return mergeUpdatesV2(updates);
  }
  return updates[0];
}, encodeStateAsUpdate = (doc2, encodedTargetStateVector) => encodeStateAsUpdateV2(doc2, encodedTargetStateVector, new UpdateEncoderV1()), readStateVector = (decoder) => {
  let ss = /* @__PURE__ */ new Map(), ssLength = readVarUint(decoder.restDecoder);
  for (let i = 0; i < ssLength; i++) {
    let client = readVarUint(decoder.restDecoder), clock = readVarUint(decoder.restDecoder);
    ss.set(client, clock);
  }
  return ss;
}, decodeStateVector = (decodedState) => readStateVector(new DSDecoderV1(createDecoder(decodedState))), writeStateVector = (encoder, sv) => (writeVarUint(encoder.restEncoder, sv.size), from(sv.entries()).sort((a, b) => b[0] - a[0]).forEach(([client, clock]) => {
  writeVarUint(encoder.restEncoder, client), writeVarUint(encoder.restEncoder, clock);
}), encoder), writeDocumentStateVector = (encoder, doc2) => writeStateVector(encoder, getStateVector(doc2.store)), encodeStateVectorV2 = (doc2, encoder = new DSEncoderV2()) => (doc2 instanceof Map ? writeStateVector(encoder, doc2) : writeDocumentStateVector(encoder, doc2), encoder.toUint8Array()), encodeStateVector = (doc2) => encodeStateVectorV2(doc2, new DSEncoderV1()), EventHandler = class {
  constructor() {
    this.l = [];
  }
}, createEventHandler = () => new EventHandler(), addEventHandlerListener = (eventHandler, f) => eventHandler.l.push(f), removeEventHandlerListener = (eventHandler, f) => {
  let l = eventHandler.l, len = l.length;
  eventHandler.l = l.filter((g) => f !== g), len === eventHandler.l.length && console.error("[yjs] Tried to remove event handler that doesn't exist.");
}, callEventHandlerListeners = (eventHandler, arg0, arg1) => callAll(eventHandler.l, [arg0, arg1]), ID = class {
  /**
   * @param {number} client client id
   * @param {number} clock unique per client id, continuous number
   */
  constructor(client, clock) {
    this.client = client, this.clock = clock;
  }
}, compareIDs = (a, b) => a === b || a !== null && b !== null && a.client === b.client && a.clock === b.clock, createID = (client, clock) => new ID(client, clock), writeID = (encoder, id2) => {
  writeVarUint(encoder, id2.client), writeVarUint(encoder, id2.clock);
}, readID = (decoder) => createID(readVarUint(decoder), readVarUint(decoder)), findRootTypeKey = (type) => {
  for (let [key, value] of type.doc.share.entries())
    if (value === type)
      return key;
  throw unexpectedCase();
}, isParentOf = (parent, child) => {
  for (; child !== null; ) {
    if (child.parent === parent)
      return !0;
    child = /** @type {AbstractType<any>} */
    child.parent._item;
  }
  return !1;
}, logType = (type) => {
  let res = [], n = type._start;
  for (; n; )
    res.push(n), n = n.right;
  console.log("Children: ", res), console.log("Children content: ", res.filter((m) => !m.deleted).map((m) => m.content));
}, PermanentUserData = class {
  /**
   * @param {Doc} doc
   * @param {YMap<any>} [storeType]
   */
  constructor(doc2, storeType = doc2.getMap("users")) {
    let dss = /* @__PURE__ */ new Map();
    this.yusers = storeType, this.doc = doc2, this.clients = /* @__PURE__ */ new Map(), this.dss = dss;
    let initUser = (user, userDescription) => {
      let ds = user.get("ds"), ids = user.get("ids"), addClientId = (
        /** @param {number} clientid */
        (clientid) => this.clients.set(clientid, userDescription)
      );
      ds.observe(
        /** @param {YArrayEvent<any>} event */
        (event) => {
          event.changes.added.forEach((item) => {
            item.content.getContent().forEach((encodedDs) => {
              encodedDs instanceof Uint8Array && this.dss.set(userDescription, mergeDeleteSets([this.dss.get(userDescription) || createDeleteSet(), readDeleteSet(new DSDecoderV1(createDecoder(encodedDs)))]));
            });
          });
        }
      ), this.dss.set(userDescription, mergeDeleteSets(ds.map((encodedDs) => readDeleteSet(new DSDecoderV1(createDecoder(encodedDs)))))), ids.observe(
        /** @param {YArrayEvent<any>} event */
        (event) => event.changes.added.forEach((item) => item.content.getContent().forEach(addClientId))
      ), ids.forEach(addClientId);
    };
    storeType.observe((event) => {
      event.keysChanged.forEach(
        (userDescription) => initUser(storeType.get(userDescription), userDescription)
      );
    }), storeType.forEach(initUser);
  }
  /**
   * @param {Doc} doc
   * @param {number} clientid
   * @param {string} userDescription
   * @param {Object} conf
   * @param {function(Transaction, DeleteSet):boolean} [conf.filter]
   */
  setUserMapping(doc2, clientid, userDescription, { filter = () => !0 } = {}) {
    let users = this.yusers, user = users.get(userDescription);
    user || (user = new YMap(), user.set("ids", new YArray()), user.set("ds", new YArray()), users.set(userDescription, user)), user.get("ids").push([clientid]), users.observe((_event) => {
      setTimeout(() => {
        let userOverwrite = users.get(userDescription);
        if (userOverwrite !== user) {
          user = userOverwrite, this.clients.forEach((_userDescription, clientid2) => {
            userDescription === _userDescription && user.get("ids").push([clientid2]);
          });
          let encoder = new DSEncoderV1(), ds = this.dss.get(userDescription);
          ds && (writeDeleteSet(encoder, ds), user.get("ds").push([encoder.toUint8Array()]));
        }
      }, 0);
    }), doc2.on(
      "afterTransaction",
      /** @param {Transaction} transaction */
      (transaction) => {
        setTimeout(() => {
          let yds = user.get("ds"), ds = transaction.deleteSet;
          if (transaction.local && ds.clients.size > 0 && filter(transaction, ds)) {
            let encoder = new DSEncoderV1();
            writeDeleteSet(encoder, ds), yds.push([encoder.toUint8Array()]);
          }
        });
      }
    );
  }
  /**
   * @param {number} clientid
   * @return {any}
   */
  getUserByClientId(clientid) {
    return this.clients.get(clientid) || null;
  }
  /**
   * @param {ID} id
   * @return {string | null}
   */
  getUserByDeletedId(id2) {
    for (let [userDescription, ds] of this.dss.entries())
      if (isDeleted(ds, id2))
        return userDescription;
    return null;
  }
}, RelativePosition = class {
  /**
   * @param {ID|null} type
   * @param {string|null} tname
   * @param {ID|null} item
   * @param {number} assoc
   */
  constructor(type, tname, item, assoc = 0) {
    this.type = type, this.tname = tname, this.item = item, this.assoc = assoc;
  }
}, relativePositionToJSON = (rpos) => {
  let json = {};
  return rpos.type && (json.type = rpos.type), rpos.tname && (json.tname = rpos.tname), rpos.item && (json.item = rpos.item), rpos.assoc != null && (json.assoc = rpos.assoc), json;
}, createRelativePositionFromJSON = (json) => new RelativePosition(json.type == null ? null : createID(json.type.client, json.type.clock), json.tname ?? null, json.item == null ? null : createID(json.item.client, json.item.clock), json.assoc == null ? 0 : json.assoc), AbsolutePosition = class {
  /**
   * @param {AbstractType<any>} type
   * @param {number} index
   * @param {number} [assoc]
   */
  constructor(type, index, assoc = 0) {
    this.type = type, this.index = index, this.assoc = assoc;
  }
}, createAbsolutePosition = (type, index, assoc = 0) => new AbsolutePosition(type, index, assoc), createRelativePosition = (type, item, assoc) => {
  let typeid = null, tname = null;
  return type._item === null ? tname = findRootTypeKey(type) : typeid = createID(type._item.id.client, type._item.id.clock), new RelativePosition(typeid, tname, item, assoc);
}, createRelativePositionFromTypeIndex = (type, index, assoc = 0) => {
  let t = type._start;
  if (assoc < 0) {
    if (index === 0)
      return createRelativePosition(type, null, assoc);
    index--;
  }
  for (; t !== null; ) {
    if (!t.deleted && t.countable) {
      if (t.length > index)
        return createRelativePosition(type, createID(t.id.client, t.id.clock + index), assoc);
      index -= t.length;
    }
    if (t.right === null && assoc < 0)
      return createRelativePosition(type, t.lastId, assoc);
    t = t.right;
  }
  return createRelativePosition(type, null, assoc);
}, writeRelativePosition = (encoder, rpos) => {
  let { type, tname, item, assoc } = rpos;
  if (item !== null)
    writeVarUint(encoder, 0), writeID(encoder, item);
  else if (tname !== null)
    writeUint8(encoder, 1), writeVarString(encoder, tname);
  else if (type !== null)
    writeUint8(encoder, 2), writeID(encoder, type);
  else
    throw unexpectedCase();
  return writeVarInt(encoder, assoc), encoder;
}, encodeRelativePosition = (rpos) => {
  let encoder = createEncoder();
  return writeRelativePosition(encoder, rpos), toUint8Array(encoder);
}, readRelativePosition = (decoder) => {
  let type = null, tname = null, itemID = null;
  switch (readVarUint(decoder)) {
    case 0:
      itemID = readID(decoder);
      break;
    case 1:
      tname = readVarString(decoder);
      break;
    case 2:
      type = readID(decoder);
  }
  let assoc = hasContent(decoder) ? readVarInt(decoder) : 0;
  return new RelativePosition(type, tname, itemID, assoc);
}, decodeRelativePosition = (uint8Array) => readRelativePosition(createDecoder(uint8Array)), getItemWithOffset = (store, id2) => {
  let item = getItem(store, id2), diff = id2.clock - item.id.clock;
  return {
    item,
    diff
  };
}, createAbsolutePositionFromRelativePosition = (rpos, doc2, followUndoneDeletions = !0) => {
  let store = doc2.store, rightID = rpos.item, typeID = rpos.type, tname = rpos.tname, assoc = rpos.assoc, type = null, index = 0;
  if (rightID !== null) {
    if (getState(store, rightID.client) <= rightID.clock)
      return null;
    let res = followUndoneDeletions ? followRedone(store, rightID) : getItemWithOffset(store, rightID), right = res.item;
    if (!(right instanceof Item))
      return null;
    if (type = /** @type {AbstractType<any>} */
    right.parent, type._item === null || !type._item.deleted) {
      index = right.deleted || !right.countable ? 0 : res.diff + (assoc >= 0 ? 0 : 1);
      let n = right.left;
      for (; n !== null; )
        !n.deleted && n.countable && (index += n.length), n = n.left;
    }
  } else {
    if (tname !== null)
      type = doc2.get(tname);
    else if (typeID !== null) {
      if (getState(store, typeID.client) <= typeID.clock)
        return null;
      let { item } = followUndoneDeletions ? followRedone(store, typeID) : { item: getItem(store, typeID) };
      if (item instanceof Item && item.content instanceof ContentType)
        type = item.content.type;
      else
        return null;
    } else
      throw unexpectedCase();
    assoc >= 0 ? index = type._length : index = 0;
  }
  return createAbsolutePosition(type, index, rpos.assoc);
}, compareRelativePositions = (a, b) => a === b || a !== null && b !== null && a.tname === b.tname && compareIDs(a.item, b.item) && compareIDs(a.type, b.type) && a.assoc === b.assoc, Snapshot = class {
  /**
   * @param {DeleteSet} ds
   * @param {Map<number,number>} sv state map
   */
  constructor(ds, sv) {
    this.ds = ds, this.sv = sv;
  }
}, equalSnapshots = (snap1, snap2) => {
  let ds1 = snap1.ds.clients, ds2 = snap2.ds.clients, sv1 = snap1.sv, sv2 = snap2.sv;
  if (sv1.size !== sv2.size || ds1.size !== ds2.size)
    return !1;
  for (let [key, value] of sv1.entries())
    if (sv2.get(key) !== value)
      return !1;
  for (let [client, dsitems1] of ds1.entries()) {
    let dsitems2 = ds2.get(client) || [];
    if (dsitems1.length !== dsitems2.length)
      return !1;
    for (let i = 0; i < dsitems1.length; i++) {
      let dsitem1 = dsitems1[i], dsitem2 = dsitems2[i];
      if (dsitem1.clock !== dsitem2.clock || dsitem1.len !== dsitem2.len)
        return !1;
    }
  }
  return !0;
}, encodeSnapshotV2 = (snapshot2, encoder = new DSEncoderV2()) => (writeDeleteSet(encoder, snapshot2.ds), writeStateVector(encoder, snapshot2.sv), encoder.toUint8Array()), encodeSnapshot = (snapshot2) => encodeSnapshotV2(snapshot2, new DSEncoderV1()), decodeSnapshotV2 = (buf, decoder = new DSDecoderV2(createDecoder(buf))) => new Snapshot(readDeleteSet(decoder), readStateVector(decoder)), decodeSnapshot = (buf) => decodeSnapshotV2(buf, new DSDecoderV1(createDecoder(buf))), createSnapshot = (ds, sm) => new Snapshot(ds, sm), emptySnapshot = createSnapshot(createDeleteSet(), /* @__PURE__ */ new Map()), snapshot = (doc2) => createSnapshot(createDeleteSetFromStructStore(doc2.store), getStateVector(doc2.store)), isVisible = (item, snapshot2) => snapshot2 === void 0 ? !item.deleted : snapshot2.sv.has(item.id.client) && (snapshot2.sv.get(item.id.client) || 0) > item.id.clock && !isDeleted(snapshot2.ds, item.id), splitSnapshotAffectedStructs = (transaction, snapshot2) => {
  let meta = setIfUndefined(transaction.meta, splitSnapshotAffectedStructs, create2), store = transaction.doc.store;
  meta.has(snapshot2) || (snapshot2.sv.forEach((clock, client) => {
    clock < getState(store, client) && getItemCleanStart(transaction, createID(client, clock));
  }), iterateDeletedStructs(transaction, snapshot2.ds, (_item) => {
  }), meta.add(snapshot2));
}, createDocFromSnapshot = (originDoc, snapshot2, newDoc = new Doc()) => {
  if (originDoc.gc)
    throw new Error("Garbage-collection must be disabled in `originDoc`!");
  let { sv, ds } = snapshot2, encoder = new UpdateEncoderV2();
  return originDoc.transact((transaction) => {
    let size2 = 0;
    sv.forEach((clock) => {
      clock > 0 && size2++;
    }), writeVarUint(encoder.restEncoder, size2);
    for (let [client, clock] of sv) {
      if (clock === 0)
        continue;
      clock < getState(originDoc.store, client) && getItemCleanStart(transaction, createID(client, clock));
      let structs = originDoc.store.clients.get(client) || [], lastStructIndex = findIndexSS(structs, clock - 1);
      writeVarUint(encoder.restEncoder, lastStructIndex + 1), encoder.writeClient(client), writeVarUint(encoder.restEncoder, 0);
      for (let i = 0; i <= lastStructIndex; i++)
        structs[i].write(encoder, 0);
    }
    writeDeleteSet(encoder, ds);
  }), applyUpdateV2(newDoc, encoder.toUint8Array(), "snapshot"), newDoc;
}, snapshotContainsUpdateV2 = (snapshot2, update, YDecoder = UpdateDecoderV2) => {
  let updateDecoder = new YDecoder(createDecoder(update)), lazyDecoder = new LazyStructReader(updateDecoder, !1);
  for (let curr = lazyDecoder.curr; curr !== null; curr = lazyDecoder.next())
    if ((snapshot2.sv.get(curr.id.client) || 0) < curr.id.clock + curr.length)
      return !1;
  let mergedDS = mergeDeleteSets([snapshot2.ds, readDeleteSet(updateDecoder)]);
  return equalDeleteSets(snapshot2.ds, mergedDS);
}, snapshotContainsUpdate = (snapshot2, update) => snapshotContainsUpdateV2(snapshot2, update, UpdateDecoderV1), StructStore = class {
  constructor() {
    this.clients = /* @__PURE__ */ new Map(), this.pendingStructs = null, this.pendingDs = null;
  }
}, getStateVector = (store) => {
  let sm = /* @__PURE__ */ new Map();
  return store.clients.forEach((structs, client) => {
    let struct = structs[structs.length - 1];
    sm.set(client, struct.id.clock + struct.length);
  }), sm;
}, getState = (store, client) => {
  let structs = store.clients.get(client);
  if (structs === void 0)
    return 0;
  let lastStruct = structs[structs.length - 1];
  return lastStruct.id.clock + lastStruct.length;
}, addStruct = (store, struct) => {
  let structs = store.clients.get(struct.id.client);
  if (structs === void 0)
    structs = [], store.clients.set(struct.id.client, structs);
  else {
    let lastStruct = structs[structs.length - 1];
    if (lastStruct.id.clock + lastStruct.length !== struct.id.clock)
      throw unexpectedCase();
  }
  structs.push(struct);
}, findIndexSS = (structs, clock) => {
  let left = 0, right = structs.length - 1, mid = structs[right], midclock = mid.id.clock;
  if (midclock === clock)
    return right;
  let midindex = floor(clock / (midclock + mid.length - 1) * right);
  for (; left <= right; ) {
    if (mid = structs[midindex], midclock = mid.id.clock, midclock <= clock) {
      if (clock < midclock + mid.length)
        return midindex;
      left = midindex + 1;
    } else
      right = midindex - 1;
    midindex = floor((left + right) / 2);
  }
  throw unexpectedCase();
}, find = (store, id2) => {
  let structs = store.clients.get(id2.client);
  return structs[findIndexSS(structs, id2.clock)];
}, getItem = (
  /** @type {function(StructStore,ID):Item} */
  find
), findIndexCleanStart = (transaction, structs, clock) => {
  let index = findIndexSS(structs, clock), struct = structs[index];
  return struct.id.clock < clock && struct instanceof Item ? (structs.splice(index + 1, 0, splitItem(transaction, struct, clock - struct.id.clock)), index + 1) : index;
}, getItemCleanStart = (transaction, id2) => {
  let structs = (
    /** @type {Array<Item>} */
    transaction.doc.store.clients.get(id2.client)
  );
  return structs[findIndexCleanStart(transaction, structs, id2.clock)];
}, getItemCleanEnd = (transaction, store, id2) => {
  let structs = store.clients.get(id2.client), index = findIndexSS(structs, id2.clock), struct = structs[index];
  return id2.clock !== struct.id.clock + struct.length - 1 && struct.constructor !== GC && structs.splice(index + 1, 0, splitItem(transaction, struct, id2.clock - struct.id.clock + 1)), struct;
}, replaceStruct = (store, struct, newStruct) => {
  let structs = (
    /** @type {Array<GC|Item>} */
    store.clients.get(struct.id.client)
  );
  structs[findIndexSS(structs, struct.id.clock)] = newStruct;
}, iterateStructs = (transaction, structs, clockStart, len, f) => {
  if (len === 0)
    return;
  let clockEnd = clockStart + len, index = findIndexCleanStart(transaction, structs, clockStart), struct;
  do
    struct = structs[index++], clockEnd < struct.id.clock + struct.length && findIndexCleanStart(transaction, structs, clockEnd), f(struct);
  while (index < structs.length && structs[index].id.clock < clockEnd);
}, Transaction = class {
  /**
   * @param {Doc} doc
   * @param {any} origin
   * @param {boolean} local
   */
  constructor(doc2, origin, local) {
    this.doc = doc2, this.deleteSet = new DeleteSet(), this.beforeState = getStateVector(doc2.store), this.afterState = /* @__PURE__ */ new Map(), this.changed = /* @__PURE__ */ new Map(), this.changedParentTypes = /* @__PURE__ */ new Map(), this._mergeStructs = [], this.origin = origin, this.meta = /* @__PURE__ */ new Map(), this.local = local, this.subdocsAdded = /* @__PURE__ */ new Set(), this.subdocsRemoved = /* @__PURE__ */ new Set(), this.subdocsLoaded = /* @__PURE__ */ new Set(), this._needFormattingCleanup = !1;
  }
}, writeUpdateMessageFromTransaction = (encoder, transaction) => transaction.deleteSet.clients.size === 0 && !any(transaction.afterState, (clock, client) => transaction.beforeState.get(client) !== clock) ? !1 : (sortAndMergeDeleteSet(transaction.deleteSet), writeStructsFromTransaction(encoder, transaction), writeDeleteSet(encoder, transaction.deleteSet), !0), addChangedTypeToTransaction = (transaction, type, parentSub) => {
  let item = type._item;
  (item === null || item.id.clock < (transaction.beforeState.get(item.id.client) || 0) && !item.deleted) && setIfUndefined(transaction.changed, type, create2).add(parentSub);
}, tryToMergeWithLefts = (structs, pos) => {
  let right = structs[pos], left = structs[pos - 1], i = pos;
  for (; i > 0; right = left, left = structs[--i - 1]) {
    if (left.deleted === right.deleted && left.constructor === right.constructor && left.mergeWith(right)) {
      right instanceof Item && right.parentSub !== null && /** @type {AbstractType<any>} */
      right.parent._map.get(right.parentSub) === right && right.parent._map.set(
        right.parentSub,
        /** @type {Item} */
        left
      );
      continue;
    }
    break;
  }
  let merged = pos - i;
  return merged && structs.splice(pos + 1 - merged, merged), merged;
}, tryGcDeleteSet = (ds, store, gcFilter) => {
  for (let [client, deleteItems] of ds.clients.entries()) {
    let structs = (
      /** @type {Array<GC|Item>} */
      store.clients.get(client)
    );
    for (let di = deleteItems.length - 1; di >= 0; di--) {
      let deleteItem = deleteItems[di], endDeleteItemClock = deleteItem.clock + deleteItem.len;
      for (let si = findIndexSS(structs, deleteItem.clock), struct = structs[si]; si < structs.length && struct.id.clock < endDeleteItemClock; struct = structs[++si]) {
        let struct2 = structs[si];
        if (deleteItem.clock + deleteItem.len <= struct2.id.clock)
          break;
        struct2 instanceof Item && struct2.deleted && !struct2.keep && gcFilter(struct2) && struct2.gc(store, !1);
      }
    }
  }
}, tryMergeDeleteSet = (ds, store) => {
  ds.clients.forEach((deleteItems, client) => {
    let structs = (
      /** @type {Array<GC|Item>} */
      store.clients.get(client)
    );
    for (let di = deleteItems.length - 1; di >= 0; di--) {
      let deleteItem = deleteItems[di], mostRightIndexToCheck = min(structs.length - 1, 1 + findIndexSS(structs, deleteItem.clock + deleteItem.len - 1));
      for (let si = mostRightIndexToCheck, struct = structs[si]; si > 0 && struct.id.clock >= deleteItem.clock; struct = structs[si])
        si -= 1 + tryToMergeWithLefts(structs, si);
    }
  });
}, tryGc = (ds, store, gcFilter) => {
  tryGcDeleteSet(ds, store, gcFilter), tryMergeDeleteSet(ds, store);
}, cleanupTransactions = (transactionCleanups, i) => {
  if (i < transactionCleanups.length) {
    let transaction = transactionCleanups[i], doc2 = transaction.doc, store = doc2.store, ds = transaction.deleteSet, mergeStructs = transaction._mergeStructs;
    try {
      sortAndMergeDeleteSet(ds), transaction.afterState = getStateVector(transaction.doc.store), doc2.emit("beforeObserverCalls", [transaction, doc2]);
      let fs = [];
      transaction.changed.forEach(
        (subs, itemtype) => fs.push(() => {
          (itemtype._item === null || !itemtype._item.deleted) && itemtype._callObserver(transaction, subs);
        })
      ), fs.push(() => {
        transaction.changedParentTypes.forEach((events, type) => {
          type._dEH.l.length > 0 && (type._item === null || !type._item.deleted) && fs.push(() => {
            events = events.filter(
              (event) => event.target._item === null || !event.target._item.deleted
            ), events.forEach((event) => {
              event.currentTarget = type, event._path = null;
            }), events.sort((event1, event2) => event1.path.length - event2.path.length), callEventHandlerListeners(type._dEH, events, transaction);
          });
        }), fs.push(() => doc2.emit("afterTransaction", [transaction, doc2])), fs.push(() => {
          transaction._needFormattingCleanup && cleanupYTextAfterTransaction(transaction);
        });
      }), callAll(fs, []);
    } finally {
      doc2.gc && tryGcDeleteSet(ds, store, doc2.gcFilter), tryMergeDeleteSet(ds, store), transaction.afterState.forEach((clock, client) => {
        let beforeClock = transaction.beforeState.get(client) || 0;
        if (beforeClock !== clock) {
          let structs = (
            /** @type {Array<GC|Item>} */
            store.clients.get(client)
          ), firstChangePos = max(findIndexSS(structs, beforeClock), 1);
          for (let i2 = structs.length - 1; i2 >= firstChangePos; )
            i2 -= 1 + tryToMergeWithLefts(structs, i2);
        }
      });
      for (let i2 = mergeStructs.length - 1; i2 >= 0; i2--) {
        let { client, clock } = mergeStructs[i2].id, structs = (
          /** @type {Array<GC|Item>} */
          store.clients.get(client)
        ), replacedStructPos = findIndexSS(structs, clock);
        replacedStructPos + 1 < structs.length && tryToMergeWithLefts(structs, replacedStructPos + 1) > 1 || replacedStructPos > 0 && tryToMergeWithLefts(structs, replacedStructPos);
      }
      if (!transaction.local && transaction.afterState.get(doc2.clientID) !== transaction.beforeState.get(doc2.clientID) && (print(ORANGE, BOLD, "[yjs] ", UNBOLD, RED, "Changed the client-id because another client seems to be using it."), doc2.clientID = generateNewClientId()), doc2.emit("afterTransactionCleanup", [transaction, doc2]), doc2._observers.has("update")) {
        let encoder = new UpdateEncoderV1();
        writeUpdateMessageFromTransaction(encoder, transaction) && doc2.emit("update", [encoder.toUint8Array(), transaction.origin, doc2, transaction]);
      }
      if (doc2._observers.has("updateV2")) {
        let encoder = new UpdateEncoderV2();
        writeUpdateMessageFromTransaction(encoder, transaction) && doc2.emit("updateV2", [encoder.toUint8Array(), transaction.origin, doc2, transaction]);
      }
      let { subdocsAdded, subdocsLoaded, subdocsRemoved } = transaction;
      (subdocsAdded.size > 0 || subdocsRemoved.size > 0 || subdocsLoaded.size > 0) && (subdocsAdded.forEach((subdoc) => {
        subdoc.clientID = doc2.clientID, subdoc.collectionid == null && (subdoc.collectionid = doc2.collectionid), doc2.subdocs.add(subdoc);
      }), subdocsRemoved.forEach((subdoc) => doc2.subdocs.delete(subdoc)), doc2.emit("subdocs", [{ loaded: subdocsLoaded, added: subdocsAdded, removed: subdocsRemoved }, doc2, transaction]), subdocsRemoved.forEach((subdoc) => subdoc.destroy())), transactionCleanups.length <= i + 1 ? (doc2._transactionCleanups = [], doc2.emit("afterAllTransactions", [doc2, transactionCleanups])) : cleanupTransactions(transactionCleanups, i + 1);
    }
  }
}, transact = (doc2, f, origin = null, local = !0) => {
  let transactionCleanups = doc2._transactionCleanups, initialCall = !1, result = null;
  doc2._transaction === null && (initialCall = !0, doc2._transaction = new Transaction(doc2, origin, local), transactionCleanups.push(doc2._transaction), transactionCleanups.length === 1 && doc2.emit("beforeAllTransactions", [doc2]), doc2.emit("beforeTransaction", [doc2._transaction, doc2]));
  try {
    result = f(doc2._transaction);
  } finally {
    if (initialCall) {
      let finishCleanup = doc2._transaction === transactionCleanups[0];
      doc2._transaction = null, finishCleanup && cleanupTransactions(transactionCleanups, 0);
    }
  }
  return result;
}, StackItem = class {
  /**
   * @param {DeleteSet} deletions
   * @param {DeleteSet} insertions
   */
  constructor(deletions, insertions) {
    this.insertions = insertions, this.deletions = deletions, this.meta = /* @__PURE__ */ new Map();
  }
}, clearUndoManagerStackItem = (tr, um, stackItem) => {
  iterateDeletedStructs(tr, stackItem.deletions, (item) => {
    item instanceof Item && um.scope.some((type) => type === tr.doc || isParentOf(
      /** @type {AbstractType<any>} */
      type,
      item
    )) && keepItem(item, !1);
  });
}, popStackItem = (undoManager, stack, eventType) => {
  let _tr = null, doc2 = undoManager.doc, scope = undoManager.scope;
  transact(doc2, (transaction) => {
    for (; stack.length > 0 && undoManager.currStackItem === null; ) {
      let store = doc2.store, stackItem = (
        /** @type {StackItem} */
        stack.pop()
      ), itemsToRedo = /* @__PURE__ */ new Set(), itemsToDelete = [], performedChange = !1;
      iterateDeletedStructs(transaction, stackItem.insertions, (struct) => {
        if (struct instanceof Item) {
          if (struct.redone !== null) {
            let { item, diff } = followRedone(store, struct.id);
            diff > 0 && (item = getItemCleanStart(transaction, createID(item.id.client, item.id.clock + diff))), struct = item;
          }
          !struct.deleted && scope.some((type) => type === transaction.doc || isParentOf(
            /** @type {AbstractType<any>} */
            type,
            /** @type {Item} */
            struct
          )) && itemsToDelete.push(struct);
        }
      }), iterateDeletedStructs(transaction, stackItem.deletions, (struct) => {
        struct instanceof Item && scope.some((type) => type === transaction.doc || isParentOf(
          /** @type {AbstractType<any>} */
          type,
          struct
        )) && // Never redo structs in stackItem.insertions because they were created and deleted in the same capture interval.
        !isDeleted(stackItem.insertions, struct.id) && itemsToRedo.add(struct);
      }), itemsToRedo.forEach((struct) => {
        performedChange = redoItem(transaction, struct, itemsToRedo, stackItem.insertions, undoManager.ignoreRemoteMapChanges, undoManager) !== null || performedChange;
      });
      for (let i = itemsToDelete.length - 1; i >= 0; i--) {
        let item = itemsToDelete[i];
        undoManager.deleteFilter(item) && (item.delete(transaction), performedChange = !0);
      }
      undoManager.currStackItem = performedChange ? stackItem : null;
    }
    transaction.changed.forEach((subProps, type) => {
      subProps.has(null) && type._searchMarker && (type._searchMarker.length = 0);
    }), _tr = transaction;
  }, undoManager);
  let res = undoManager.currStackItem;
  if (res != null) {
    let changedParentTypes = _tr.changedParentTypes;
    undoManager.emit("stack-item-popped", [{ stackItem: res, type: eventType, changedParentTypes, origin: undoManager }, undoManager]), undoManager.currStackItem = null;
  }
  return res;
}, UndoManager = class extends ObservableV2 {
  /**
   * @param {Doc|AbstractType<any>|Array<AbstractType<any>>} typeScope Limits the scope of the UndoManager. If this is set to a ydoc instance, all changes on that ydoc will be undone. If set to a specific type, only changes on that type or its children will be undone. Also accepts an array of types.
   * @param {UndoManagerOptions} options
   */
  constructor(typeScope, {
    captureTimeout = 500,
    captureTransaction = (_tr) => !0,
    deleteFilter = () => !0,
    trackedOrigins = /* @__PURE__ */ new Set([null]),
    ignoreRemoteMapChanges = !1,
    doc: doc2 = (
      /** @type {Doc} */
      isArray(typeScope) ? typeScope[0].doc : typeScope instanceof Doc ? typeScope : typeScope.doc
    )
  } = {}) {
    super(), this.scope = [], this.doc = doc2, this.addToScope(typeScope), this.deleteFilter = deleteFilter, trackedOrigins.add(this), this.trackedOrigins = trackedOrigins, this.captureTransaction = captureTransaction, this.undoStack = [], this.redoStack = [], this.undoing = !1, this.redoing = !1, this.currStackItem = null, this.lastChange = 0, this.ignoreRemoteMapChanges = ignoreRemoteMapChanges, this.captureTimeout = captureTimeout, this.afterTransactionHandler = (transaction) => {
      if (!this.captureTransaction(transaction) || !this.scope.some((type) => transaction.changedParentTypes.has(
        /** @type {AbstractType<any>} */
        type
      ) || type === this.doc) || !this.trackedOrigins.has(transaction.origin) && (!transaction.origin || !this.trackedOrigins.has(transaction.origin.constructor)))
        return;
      let undoing = this.undoing, redoing = this.redoing, stack = undoing ? this.redoStack : this.undoStack;
      undoing ? this.stopCapturing() : redoing || this.clear(!1, !0);
      let insertions = new DeleteSet();
      transaction.afterState.forEach((endClock, client) => {
        let startClock = transaction.beforeState.get(client) || 0, len = endClock - startClock;
        len > 0 && addToDeleteSet(insertions, client, startClock, len);
      });
      let now = getUnixTime(), didAdd = !1;
      if (this.lastChange > 0 && now - this.lastChange < this.captureTimeout && stack.length > 0 && !undoing && !redoing) {
        let lastOp = stack[stack.length - 1];
        lastOp.deletions = mergeDeleteSets([lastOp.deletions, transaction.deleteSet]), lastOp.insertions = mergeDeleteSets([lastOp.insertions, insertions]);
      } else
        stack.push(new StackItem(transaction.deleteSet, insertions)), didAdd = !0;
      !undoing && !redoing && (this.lastChange = now), iterateDeletedStructs(
        transaction,
        transaction.deleteSet,
        /** @param {Item|GC} item */
        (item) => {
          item instanceof Item && this.scope.some((type) => type === transaction.doc || isParentOf(
            /** @type {AbstractType<any>} */
            type,
            item
          )) && keepItem(item, !0);
        }
      );
      let changeEvent = [{ stackItem: stack[stack.length - 1], origin: transaction.origin, type: undoing ? "redo" : "undo", changedParentTypes: transaction.changedParentTypes }, this];
      didAdd ? this.emit("stack-item-added", changeEvent) : this.emit("stack-item-updated", changeEvent);
    }, this.destroy = this.destroy.bind(this), this.doc.on("afterTransaction", this.afterTransactionHandler), this.doc.on("destroy", this.destroy);
  }
  /**
   * Extend the scope.
   *
   * @param {Array<AbstractType<any> | Doc> | AbstractType<any> | Doc} ytypes
   */
  addToScope(ytypes) {
    let tmpSet = new Set(this.scope);
    ytypes = isArray(ytypes) ? ytypes : [ytypes], ytypes.forEach((ytype) => {
      tmpSet.has(ytype) || (tmpSet.add(ytype), (ytype instanceof AbstractType ? ytype.doc !== this.doc : ytype !== this.doc) && warn("[yjs#509] Not same Y.Doc"), this.scope.push(ytype));
    });
  }
  /**
   * @param {any} origin
   */
  addTrackedOrigin(origin) {
    this.trackedOrigins.add(origin);
  }
  /**
   * @param {any} origin
   */
  removeTrackedOrigin(origin) {
    this.trackedOrigins.delete(origin);
  }
  clear(clearUndoStack = !0, clearRedoStack = !0) {
    (clearUndoStack && this.canUndo() || clearRedoStack && this.canRedo()) && this.doc.transact((tr) => {
      clearUndoStack && (this.undoStack.forEach((item) => clearUndoManagerStackItem(tr, this, item)), this.undoStack = []), clearRedoStack && (this.redoStack.forEach((item) => clearUndoManagerStackItem(tr, this, item)), this.redoStack = []), this.emit("stack-cleared", [{ undoStackCleared: clearUndoStack, redoStackCleared: clearRedoStack }]);
    });
  }
  /**
   * UndoManager merges Undo-StackItem if they are created within time-gap
   * smaller than `options.captureTimeout`. Call `um.stopCapturing()` so that the next
   * StackItem won't be merged.
   *
   *
   * @example
   *     // without stopCapturing
   *     ytext.insert(0, 'a')
   *     ytext.insert(1, 'b')
   *     um.undo()
   *     ytext.toString() // => '' (note that 'ab' was removed)
   *     // with stopCapturing
   *     ytext.insert(0, 'a')
   *     um.stopCapturing()
   *     ytext.insert(0, 'b')
   *     um.undo()
   *     ytext.toString() // => 'a' (note that only 'b' was removed)
   *
   */
  stopCapturing() {
    this.lastChange = 0;
  }
  /**
   * Undo last changes on type.
   *
   * @return {StackItem?} Returns StackItem if a change was applied
   */
  undo() {
    this.undoing = !0;
    let res;
    try {
      res = popStackItem(this, this.undoStack, "undo");
    } finally {
      this.undoing = !1;
    }
    return res;
  }
  /**
   * Redo last undo operation.
   *
   * @return {StackItem?} Returns StackItem if a change was applied
   */
  redo() {
    this.redoing = !0;
    let res;
    try {
      res = popStackItem(this, this.redoStack, "redo");
    } finally {
      this.redoing = !1;
    }
    return res;
  }
  /**
   * Are undo steps available?
   *
   * @return {boolean} `true` if undo is possible
   */
  canUndo() {
    return this.undoStack.length > 0;
  }
  /**
   * Are redo steps available?
   *
   * @return {boolean} `true` if redo is possible
   */
  canRedo() {
    return this.redoStack.length > 0;
  }
  destroy() {
    this.trackedOrigins.delete(this), this.doc.off("afterTransaction", this.afterTransactionHandler), this.doc.off("destroy", this.destroy), super.destroy();
  }
};
function* lazyStructReaderGenerator(decoder) {
  let numOfStateUpdates = readVarUint(decoder.restDecoder);
  for (let i = 0; i < numOfStateUpdates; i++) {
    let numberOfStructs = readVarUint(decoder.restDecoder), client = decoder.readClient(), clock = readVarUint(decoder.restDecoder);
    for (let i2 = 0; i2 < numberOfStructs; i2++) {
      let info = decoder.readInfo();
      if (info === 10) {
        let len = readVarUint(decoder.restDecoder);
        yield new Skip(createID(client, clock), len), clock += len;
      } else if ((31 & info) !== 0) {
        let cantCopyParentInfo = (info & 192) === 0, struct = new Item(
          createID(client, clock),
          null,
          // left
          (info & 128) === 128 ? decoder.readLeftID() : null,
          // origin
          null,
          // right
          (info & 64) === 64 ? decoder.readRightID() : null,
          // right origin
          // @ts-ignore Force writing a string here.
          cantCopyParentInfo ? decoder.readParentInfo() ? decoder.readString() : decoder.readLeftID() : null,
          // parent
          cantCopyParentInfo && (info & 32) === 32 ? decoder.readString() : null,
          // parentSub
          readItemContent(decoder, info)
          // item content
        );
        yield struct, clock += struct.length;
      } else {
        let len = decoder.readLen();
        yield new GC(createID(client, clock), len), clock += len;
      }
    }
  }
}
var LazyStructReader = class {
  /**
   * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
   * @param {boolean} filterSkips
   */
  constructor(decoder, filterSkips) {
    this.gen = lazyStructReaderGenerator(decoder), this.curr = null, this.done = !1, this.filterSkips = filterSkips, this.next();
  }
  /**
   * @return {Item | GC | Skip |null}
   */
  next() {
    do
      this.curr = this.gen.next().value || null;
    while (this.filterSkips && this.curr !== null && this.curr.constructor === Skip);
    return this.curr;
  }
}, logUpdate = (update) => logUpdateV2(update, UpdateDecoderV1), logUpdateV2 = (update, YDecoder = UpdateDecoderV2) => {
  let structs = [], updateDecoder = new YDecoder(createDecoder(update)), lazyDecoder = new LazyStructReader(updateDecoder, !1);
  for (let curr = lazyDecoder.curr; curr !== null; curr = lazyDecoder.next())
    structs.push(curr);
  print("Structs: ", structs);
  let ds = readDeleteSet(updateDecoder);
  print("DeleteSet: ", ds);
}, decodeUpdate = (update) => decodeUpdateV2(update, UpdateDecoderV1), decodeUpdateV2 = (update, YDecoder = UpdateDecoderV2) => {
  let structs = [], updateDecoder = new YDecoder(createDecoder(update)), lazyDecoder = new LazyStructReader(updateDecoder, !1);
  for (let curr = lazyDecoder.curr; curr !== null; curr = lazyDecoder.next())
    structs.push(curr);
  return {
    structs,
    ds: readDeleteSet(updateDecoder)
  };
}, LazyStructWriter = class {
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   */
  constructor(encoder) {
    this.currClient = 0, this.startClock = 0, this.written = 0, this.encoder = encoder, this.clientStructs = [];
  }
}, mergeUpdates = (updates) => mergeUpdatesV2(updates, UpdateDecoderV1, UpdateEncoderV1), encodeStateVectorFromUpdateV2 = (update, YEncoder = DSEncoderV2, YDecoder = UpdateDecoderV2) => {
  let encoder = new YEncoder(), updateDecoder = new LazyStructReader(new YDecoder(createDecoder(update)), !1), curr = updateDecoder.curr;
  if (curr !== null) {
    let size2 = 0, currClient = curr.id.client, stopCounting = curr.id.clock !== 0, currClock = stopCounting ? 0 : curr.id.clock + curr.length;
    for (; curr !== null; curr = updateDecoder.next())
      currClient !== curr.id.client && (currClock !== 0 && (size2++, writeVarUint(encoder.restEncoder, currClient), writeVarUint(encoder.restEncoder, currClock)), currClient = curr.id.client, currClock = 0, stopCounting = curr.id.clock !== 0), curr.constructor === Skip && (stopCounting = !0), stopCounting || (currClock = curr.id.clock + curr.length);
    currClock !== 0 && (size2++, writeVarUint(encoder.restEncoder, currClient), writeVarUint(encoder.restEncoder, currClock));
    let enc = createEncoder();
    return writeVarUint(enc, size2), writeBinaryEncoder(enc, encoder.restEncoder), encoder.restEncoder = enc, encoder.toUint8Array();
  } else
    return writeVarUint(encoder.restEncoder, 0), encoder.toUint8Array();
}, encodeStateVectorFromUpdate = (update) => encodeStateVectorFromUpdateV2(update, DSEncoderV1, UpdateDecoderV1), parseUpdateMetaV2 = (update, YDecoder = UpdateDecoderV2) => {
  let from2 = /* @__PURE__ */ new Map(), to = /* @__PURE__ */ new Map(), updateDecoder = new LazyStructReader(new YDecoder(createDecoder(update)), !1), curr = updateDecoder.curr;
  if (curr !== null) {
    let currClient = curr.id.client, currClock = curr.id.clock;
    for (from2.set(currClient, currClock); curr !== null; curr = updateDecoder.next())
      currClient !== curr.id.client && (to.set(currClient, currClock), from2.set(curr.id.client, curr.id.clock), currClient = curr.id.client), currClock = curr.id.clock + curr.length;
    to.set(currClient, currClock);
  }
  return { from: from2, to };
}, parseUpdateMeta = (update) => parseUpdateMetaV2(update, UpdateDecoderV1), sliceStruct = (left, diff) => {
  if (left.constructor === GC) {
    let { client, clock } = left.id;
    return new GC(createID(client, clock + diff), left.length - diff);
  } else if (left.constructor === Skip) {
    let { client, clock } = left.id;
    return new Skip(createID(client, clock + diff), left.length - diff);
  } else {
    let leftItem = (
      /** @type {Item} */
      left
    ), { client, clock } = leftItem.id;
    return new Item(
      createID(client, clock + diff),
      null,
      createID(client, clock + diff - 1),
      null,
      leftItem.rightOrigin,
      leftItem.parent,
      leftItem.parentSub,
      leftItem.content.splice(diff)
    );
  }
}, mergeUpdatesV2 = (updates, YDecoder = UpdateDecoderV2, YEncoder = UpdateEncoderV2) => {
  if (updates.length === 1)
    return updates[0];
  let updateDecoders = updates.map((update) => new YDecoder(createDecoder(update))), lazyStructDecoders = updateDecoders.map((decoder) => new LazyStructReader(decoder, !0)), currWrite = null, updateEncoder = new YEncoder(), lazyStructEncoder = new LazyStructWriter(updateEncoder);
  for (; lazyStructDecoders = lazyStructDecoders.filter((dec) => dec.curr !== null), lazyStructDecoders.sort(
    /** @type {function(any,any):number} */
    (dec1, dec2) => {
      if (dec1.curr.id.client === dec2.curr.id.client) {
        let clockDiff = dec1.curr.id.clock - dec2.curr.id.clock;
        return clockDiff === 0 ? dec1.curr.constructor === dec2.curr.constructor ? 0 : dec1.curr.constructor === Skip ? 1 : -1 : clockDiff;
      } else
        return dec2.curr.id.client - dec1.curr.id.client;
    }
  ), lazyStructDecoders.length !== 0; ) {
    let currDecoder = lazyStructDecoders[0], firstClient = (
      /** @type {Item | GC} */
      currDecoder.curr.id.client
    );
    if (currWrite !== null) {
      let curr = (
        /** @type {Item | GC | null} */
        currDecoder.curr
      ), iterated = !1;
      for (; curr !== null && curr.id.clock + curr.length <= currWrite.struct.id.clock + currWrite.struct.length && curr.id.client >= currWrite.struct.id.client; )
        curr = currDecoder.next(), iterated = !0;
      if (curr === null || // current decoder is empty
      curr.id.client !== firstClient || // check whether there is another decoder that has has updates from `firstClient`
      iterated && curr.id.clock > currWrite.struct.id.clock + currWrite.struct.length)
        continue;
      if (firstClient !== currWrite.struct.id.client)
        writeStructToLazyStructWriter(lazyStructEncoder, currWrite.struct, currWrite.offset), currWrite = { struct: curr, offset: 0 }, currDecoder.next();
      else if (currWrite.struct.id.clock + currWrite.struct.length < curr.id.clock)
        if (currWrite.struct.constructor === Skip)
          currWrite.struct.length = curr.id.clock + curr.length - currWrite.struct.id.clock;
        else {
          writeStructToLazyStructWriter(lazyStructEncoder, currWrite.struct, currWrite.offset);
          let diff = curr.id.clock - currWrite.struct.id.clock - currWrite.struct.length;
          currWrite = { struct: new Skip(createID(firstClient, currWrite.struct.id.clock + currWrite.struct.length), diff), offset: 0 };
        }
      else {
        let diff = currWrite.struct.id.clock + currWrite.struct.length - curr.id.clock;
        diff > 0 && (currWrite.struct.constructor === Skip ? currWrite.struct.length -= diff : curr = sliceStruct(curr, diff)), currWrite.struct.mergeWith(
          /** @type {any} */
          curr
        ) || (writeStructToLazyStructWriter(lazyStructEncoder, currWrite.struct, currWrite.offset), currWrite = { struct: curr, offset: 0 }, currDecoder.next());
      }
    } else
      currWrite = { struct: (
        /** @type {Item | GC} */
        currDecoder.curr
      ), offset: 0 }, currDecoder.next();
    for (let next = currDecoder.curr; next !== null && next.id.client === firstClient && next.id.clock === currWrite.struct.id.clock + currWrite.struct.length && next.constructor !== Skip; next = currDecoder.next())
      writeStructToLazyStructWriter(lazyStructEncoder, currWrite.struct, currWrite.offset), currWrite = { struct: next, offset: 0 };
  }
  currWrite !== null && (writeStructToLazyStructWriter(lazyStructEncoder, currWrite.struct, currWrite.offset), currWrite = null), finishLazyStructWriting(lazyStructEncoder);
  let dss = updateDecoders.map((decoder) => readDeleteSet(decoder)), ds = mergeDeleteSets(dss);
  return writeDeleteSet(updateEncoder, ds), updateEncoder.toUint8Array();
}, diffUpdateV2 = (update, sv, YDecoder = UpdateDecoderV2, YEncoder = UpdateEncoderV2) => {
  let state = decodeStateVector(sv), encoder = new YEncoder(), lazyStructWriter = new LazyStructWriter(encoder), decoder = new YDecoder(createDecoder(update)), reader = new LazyStructReader(decoder, !1);
  for (; reader.curr; ) {
    let curr = reader.curr, currClient = curr.id.client, svClock = state.get(currClient) || 0;
    if (reader.curr.constructor === Skip) {
      reader.next();
      continue;
    }
    if (curr.id.clock + curr.length > svClock)
      for (writeStructToLazyStructWriter(lazyStructWriter, curr, max(svClock - curr.id.clock, 0)), reader.next(); reader.curr && reader.curr.id.client === currClient; )
        writeStructToLazyStructWriter(lazyStructWriter, reader.curr, 0), reader.next();
    else
      for (; reader.curr && reader.curr.id.client === currClient && reader.curr.id.clock + reader.curr.length <= svClock; )
        reader.next();
  }
  finishLazyStructWriting(lazyStructWriter);
  let ds = readDeleteSet(decoder);
  return writeDeleteSet(encoder, ds), encoder.toUint8Array();
}, diffUpdate = (update, sv) => diffUpdateV2(update, sv, UpdateDecoderV1, UpdateEncoderV1), flushLazyStructWriter = (lazyWriter) => {
  lazyWriter.written > 0 && (lazyWriter.clientStructs.push({ written: lazyWriter.written, restEncoder: toUint8Array(lazyWriter.encoder.restEncoder) }), lazyWriter.encoder.restEncoder = createEncoder(), lazyWriter.written = 0);
}, writeStructToLazyStructWriter = (lazyWriter, struct, offset) => {
  lazyWriter.written > 0 && lazyWriter.currClient !== struct.id.client && flushLazyStructWriter(lazyWriter), lazyWriter.written === 0 && (lazyWriter.currClient = struct.id.client, lazyWriter.encoder.writeClient(struct.id.client), writeVarUint(lazyWriter.encoder.restEncoder, struct.id.clock + offset)), struct.write(lazyWriter.encoder, offset), lazyWriter.written++;
}, finishLazyStructWriting = (lazyWriter) => {
  flushLazyStructWriter(lazyWriter);
  let restEncoder = lazyWriter.encoder.restEncoder;
  writeVarUint(restEncoder, lazyWriter.clientStructs.length);
  for (let i = 0; i < lazyWriter.clientStructs.length; i++) {
    let partStructs = lazyWriter.clientStructs[i];
    writeVarUint(restEncoder, partStructs.written), writeUint8Array(restEncoder, partStructs.restEncoder);
  }
}, convertUpdateFormat = (update, blockTransformer, YDecoder, YEncoder) => {
  let updateDecoder = new YDecoder(createDecoder(update)), lazyDecoder = new LazyStructReader(updateDecoder, !1), updateEncoder = new YEncoder(), lazyWriter = new LazyStructWriter(updateEncoder);
  for (let curr = lazyDecoder.curr; curr !== null; curr = lazyDecoder.next())
    writeStructToLazyStructWriter(lazyWriter, blockTransformer(curr), 0);
  finishLazyStructWriting(lazyWriter);
  let ds = readDeleteSet(updateDecoder);
  return writeDeleteSet(updateEncoder, ds), updateEncoder.toUint8Array();
}, createObfuscator = ({ formatting = !0, subdocs = !0, yxml = !0 } = {}) => {
  let i = 0, mapKeyCache = create(), nodeNameCache = create(), formattingKeyCache = create(), formattingValueCache = create();
  return formattingValueCache.set(null, null), (block) => {
    switch (block.constructor) {
      case GC:
      case Skip:
        return block;
      case Item: {
        let item = (
          /** @type {Item} */
          block
        ), content = item.content;
        switch (content.constructor) {
          case ContentDeleted:
            break;
          case ContentType: {
            if (yxml) {
              let type = (
                /** @type {ContentType} */
                content.type
              );
              type instanceof YXmlElement && (type.nodeName = setIfUndefined(nodeNameCache, type.nodeName, () => "node-" + i)), type instanceof YXmlHook && (type.hookName = setIfUndefined(nodeNameCache, type.hookName, () => "hook-" + i));
            }
            break;
          }
          case ContentAny: {
            let c = (
              /** @type {ContentAny} */
              content
            );
            c.arr = c.arr.map(() => i);
            break;
          }
          case ContentBinary: {
            let c = (
              /** @type {ContentBinary} */
              content
            );
            c.content = new Uint8Array([i]);
            break;
          }
          case ContentDoc: {
            let c = (
              /** @type {ContentDoc} */
              content
            );
            subdocs && (c.opts = {}, c.doc.guid = i + "");
            break;
          }
          case ContentEmbed: {
            let c = (
              /** @type {ContentEmbed} */
              content
            );
            c.embed = {};
            break;
          }
          case ContentFormat: {
            let c = (
              /** @type {ContentFormat} */
              content
            );
            formatting && (c.key = setIfUndefined(formattingKeyCache, c.key, () => i + ""), c.value = setIfUndefined(formattingValueCache, c.value, () => ({ i })));
            break;
          }
          case ContentJSON: {
            let c = (
              /** @type {ContentJSON} */
              content
            );
            c.arr = c.arr.map(() => i);
            break;
          }
          case ContentString: {
            let c = (
              /** @type {ContentString} */
              content
            );
            c.str = repeat(i % 10 + "", c.str.length);
            break;
          }
          default:
            unexpectedCase();
        }
        return item.parentSub && (item.parentSub = setIfUndefined(mapKeyCache, item.parentSub, () => i + "")), i++, block;
      }
      default:
        unexpectedCase();
    }
  };
}, obfuscateUpdate = (update, opts) => convertUpdateFormat(update, createObfuscator(opts), UpdateDecoderV1, UpdateEncoderV1), obfuscateUpdateV2 = (update, opts) => convertUpdateFormat(update, createObfuscator(opts), UpdateDecoderV2, UpdateEncoderV2), convertUpdateFormatV1ToV2 = (update) => convertUpdateFormat(update, id, UpdateDecoderV1, UpdateEncoderV2), convertUpdateFormatV2ToV1 = (update) => convertUpdateFormat(update, id, UpdateDecoderV2, UpdateEncoderV1), errorComputeChanges = "You must not compute changes after the event-handler fired.", YEvent = class {
  /**
   * @param {T} target The changed type.
   * @param {Transaction} transaction
   */
  constructor(target, transaction) {
    this.target = target, this.currentTarget = target, this.transaction = transaction, this._changes = null, this._keys = null, this._delta = null, this._path = null;
  }
  /**
   * Computes the path from `y` to the changed type.
   *
   * @todo v14 should standardize on path: Array<{parent, index}> because that is easier to work with.
   *
   * The following property holds:
   * @example
   *   let type = y
   *   event.path.forEach(dir => {
   *     type = type.get(dir)
   *   })
   *   type === event.target // => true
   */
  get path() {
    return this._path || (this._path = getPathTo(this.currentTarget, this.target));
  }
  /**
   * Check if a struct is deleted by this event.
   *
   * In contrast to change.deleted, this method also returns true if the struct was added and then deleted.
   *
   * @param {AbstractStruct} struct
   * @return {boolean}
   */
  deletes(struct) {
    return isDeleted(this.transaction.deleteSet, struct.id);
  }
  /**
   * @type {Map<string, { action: 'add' | 'update' | 'delete', oldValue: any }>}
   */
  get keys() {
    if (this._keys === null) {
      if (this.transaction.doc._transactionCleanups.length === 0)
        throw create3(errorComputeChanges);
      let keys2 = /* @__PURE__ */ new Map(), target = this.target;
      /** @type Set<string|null> */
      this.transaction.changed.get(target).forEach((key) => {
        if (key !== null) {
          let item = (
            /** @type {Item} */
            target._map.get(key)
          ), action, oldValue;
          if (this.adds(item)) {
            let prev = item.left;
            for (; prev !== null && this.adds(prev); )
              prev = prev.left;
            if (this.deletes(item))
              if (prev !== null && this.deletes(prev))
                action = "delete", oldValue = last(prev.content.getContent());
              else
                return;
            else
              prev !== null && this.deletes(prev) ? (action = "update", oldValue = last(prev.content.getContent())) : (action = "add", oldValue = void 0);
          } else if (this.deletes(item))
            action = "delete", oldValue = last(
              /** @type {Item} */
              item.content.getContent()
            );
          else
            return;
          keys2.set(key, { action, oldValue });
        }
      }), this._keys = keys2;
    }
    return this._keys;
  }
  /**
   * This is a computed property. Note that this can only be safely computed during the
   * event call. Computing this property after other changes happened might result in
   * unexpected behavior (incorrect computation of deltas). A safe way to collect changes
   * is to store the `changes` or the `delta` object. Avoid storing the `transaction` object.
   *
   * @type {Array<{insert?: string | Array<any> | object | AbstractType<any>, retain?: number, delete?: number, attributes?: Object<string, any>}>}
   */
  get delta() {
    return this.changes.delta;
  }
  /**
   * Check if a struct is added by this event.
   *
   * In contrast to change.deleted, this method also returns true if the struct was added and then deleted.
   *
   * @param {AbstractStruct} struct
   * @return {boolean}
   */
  adds(struct) {
    return struct.id.clock >= (this.transaction.beforeState.get(struct.id.client) || 0);
  }
  /**
   * This is a computed property. Note that this can only be safely computed during the
   * event call. Computing this property after other changes happened might result in
   * unexpected behavior (incorrect computation of deltas). A safe way to collect changes
   * is to store the `changes` or the `delta` object. Avoid storing the `transaction` object.
   *
   * @type {{added:Set<Item>,deleted:Set<Item>,keys:Map<string,{action:'add'|'update'|'delete',oldValue:any}>,delta:Array<{insert?:Array<any>|string, delete?:number, retain?:number}>}}
   */
  get changes() {
    let changes = this._changes;
    if (changes === null) {
      if (this.transaction.doc._transactionCleanups.length === 0)
        throw create3(errorComputeChanges);
      let target = this.target, added = create2(), deleted = create2(), delta = [];
      if (changes = {
        added,
        deleted,
        delta,
        keys: this.keys
      }, /** @type Set<string|null> */
      this.transaction.changed.get(target).has(null)) {
        let lastOp = null, packOp = () => {
          lastOp && delta.push(lastOp);
        };
        for (let item = target._start; item !== null; item = item.right)
          item.deleted ? this.deletes(item) && !this.adds(item) && ((lastOp === null || lastOp.delete === void 0) && (packOp(), lastOp = { delete: 0 }), lastOp.delete += item.length, deleted.add(item)) : this.adds(item) ? ((lastOp === null || lastOp.insert === void 0) && (packOp(), lastOp = { insert: [] }), lastOp.insert = lastOp.insert.concat(item.content.getContent()), added.add(item)) : ((lastOp === null || lastOp.retain === void 0) && (packOp(), lastOp = { retain: 0 }), lastOp.retain += item.length);
        lastOp !== null && lastOp.retain === void 0 && packOp();
      }
      this._changes = changes;
    }
    return (
      /** @type {any} */
      changes
    );
  }
}, getPathTo = (parent, child) => {
  let path = [];
  for (; child._item !== null && child !== parent; ) {
    if (child._item.parentSub !== null)
      path.unshift(child._item.parentSub);
    else {
      let i = 0, c = (
        /** @type {AbstractType<any>} */
        child._item.parent._start
      );
      for (; c !== child._item && c !== null; )
        !c.deleted && c.countable && (i += c.length), c = c.right;
      path.unshift(i);
    }
    child = /** @type {AbstractType<any>} */
    child._item.parent;
  }
  return path;
}, warnPrematureAccess = () => {
  warn("Invalid access: Add Yjs type to a document before reading data.");
}, maxSearchMarker = 80, globalSearchMarkerTimestamp = 0, ArraySearchMarker = class {
  /**
   * @param {Item} p
   * @param {number} index
   */
  constructor(p, index) {
    p.marker = !0, this.p = p, this.index = index, this.timestamp = globalSearchMarkerTimestamp++;
  }
}, refreshMarkerTimestamp = (marker) => {
  marker.timestamp = globalSearchMarkerTimestamp++;
}, overwriteMarker = (marker, p, index) => {
  marker.p.marker = !1, marker.p = p, p.marker = !0, marker.index = index, marker.timestamp = globalSearchMarkerTimestamp++;
}, markPosition = (searchMarker, p, index) => {
  if (searchMarker.length >= maxSearchMarker) {
    let marker = searchMarker.reduce((a, b) => a.timestamp < b.timestamp ? a : b);
    return overwriteMarker(marker, p, index), marker;
  } else {
    let pm = new ArraySearchMarker(p, index);
    return searchMarker.push(pm), pm;
  }
}, findMarker = (yarray, index) => {
  if (yarray._start === null || index === 0 || yarray._searchMarker === null)
    return null;
  let marker = yarray._searchMarker.length === 0 ? null : yarray._searchMarker.reduce((a, b) => abs(index - a.index) < abs(index - b.index) ? a : b), p = yarray._start, pindex = 0;
  for (marker !== null && (p = marker.p, pindex = marker.index, refreshMarkerTimestamp(marker)); p.right !== null && pindex < index; ) {
    if (!p.deleted && p.countable) {
      if (index < pindex + p.length)
        break;
      pindex += p.length;
    }
    p = p.right;
  }
  for (; p.left !== null && pindex > index; )
    p = p.left, !p.deleted && p.countable && (pindex -= p.length);
  for (; p.left !== null && p.left.id.client === p.id.client && p.left.id.clock + p.left.length === p.id.clock; )
    p = p.left, !p.deleted && p.countable && (pindex -= p.length);
  return marker !== null && abs(marker.index - pindex) < /** @type {YText|YArray<any>} */
  p.parent.length / maxSearchMarker ? (overwriteMarker(marker, p, pindex), marker) : markPosition(yarray._searchMarker, p, pindex);
}, updateMarkerChanges = (searchMarker, index, len) => {
  for (let i = searchMarker.length - 1; i >= 0; i--) {
    let m = searchMarker[i];
    if (len > 0) {
      let p = m.p;
      for (p.marker = !1; p && (p.deleted || !p.countable); )
        p = p.left, p && !p.deleted && p.countable && (m.index -= p.length);
      if (p === null || p.marker === !0) {
        searchMarker.splice(i, 1);
        continue;
      }
      m.p = p, p.marker = !0;
    }
    (index < m.index || len > 0 && index === m.index) && (m.index = max(index, m.index + len));
  }
}, getTypeChildren = (t) => {
  t.doc ?? warnPrematureAccess();
  let s = t._start, arr = [];
  for (; s; )
    arr.push(s), s = s.right;
  return arr;
}, callTypeObservers = (type, transaction, event) => {
  let changedType = type, changedParentTypes = transaction.changedParentTypes;
  for (; setIfUndefined(changedParentTypes, type, () => []).push(event), type._item !== null; )
    type = /** @type {AbstractType<any>} */
    type._item.parent;
  callEventHandlerListeners(changedType._eH, event, transaction);
}, AbstractType = class {
  constructor() {
    this._item = null, this._map = /* @__PURE__ */ new Map(), this._start = null, this.doc = null, this._length = 0, this._eH = createEventHandler(), this._dEH = createEventHandler(), this._searchMarker = null;
  }
  /**
   * @return {AbstractType<any>|null}
   */
  get parent() {
    return this._item ? (
      /** @type {AbstractType<any>} */
      this._item.parent
    ) : null;
  }
  /**
   * Integrate this type into the Yjs instance.
   *
   * * Save this struct in the os
   * * This type is sent to other client
   * * Observer functions are fired
   *
   * @param {Doc} y The Yjs instance
   * @param {Item|null} item
   */
  _integrate(y, item) {
    this.doc = y, this._item = item;
  }
  /**
   * @return {AbstractType<EventType>}
   */
  _copy() {
    throw methodUnimplemented();
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {AbstractType<EventType>}
   */
  clone() {
    throw methodUnimplemented();
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} _encoder
   */
  _write(_encoder) {
  }
  /**
   * The first non-deleted item
   */
  get _first() {
    let n = this._start;
    for (; n !== null && n.deleted; )
      n = n.right;
    return n;
  }
  /**
   * Creates YEvent and calls all type observers.
   * Must be implemented by each type.
   *
   * @param {Transaction} transaction
   * @param {Set<null|string>} _parentSubs Keys changed on this type. `null` if list was modified.
   */
  _callObserver(transaction, _parentSubs) {
    !transaction.local && this._searchMarker && (this._searchMarker.length = 0);
  }
  /**
   * Observe all events that are created on this type.
   *
   * @param {function(EventType, Transaction):void} f Observer function
   */
  observe(f) {
    addEventHandlerListener(this._eH, f);
  }
  /**
   * Observe all events that are created by this type and its children.
   *
   * @param {function(Array<YEvent<any>>,Transaction):void} f Observer function
   */
  observeDeep(f) {
    addEventHandlerListener(this._dEH, f);
  }
  /**
   * Unregister an observer function.
   *
   * @param {function(EventType,Transaction):void} f Observer function
   */
  unobserve(f) {
    removeEventHandlerListener(this._eH, f);
  }
  /**
   * Unregister an observer function.
   *
   * @param {function(Array<YEvent<any>>,Transaction):void} f Observer function
   */
  unobserveDeep(f) {
    removeEventHandlerListener(this._dEH, f);
  }
  /**
   * @abstract
   * @return {any}
   */
  toJSON() {
  }
}, typeListSlice = (type, start, end) => {
  type.doc ?? warnPrematureAccess(), start < 0 && (start = type._length + start), end < 0 && (end = type._length + end);
  let len = end - start, cs = [], n = type._start;
  for (; n !== null && len > 0; ) {
    if (n.countable && !n.deleted) {
      let c = n.content.getContent();
      if (c.length <= start)
        start -= c.length;
      else {
        for (let i = start; i < c.length && len > 0; i++)
          cs.push(c[i]), len--;
        start = 0;
      }
    }
    n = n.right;
  }
  return cs;
}, typeListToArray = (type) => {
  type.doc ?? warnPrematureAccess();
  let cs = [], n = type._start;
  for (; n !== null; ) {
    if (n.countable && !n.deleted) {
      let c = n.content.getContent();
      for (let i = 0; i < c.length; i++)
        cs.push(c[i]);
    }
    n = n.right;
  }
  return cs;
}, typeListToArraySnapshot = (type, snapshot2) => {
  let cs = [], n = type._start;
  for (; n !== null; ) {
    if (n.countable && isVisible(n, snapshot2)) {
      let c = n.content.getContent();
      for (let i = 0; i < c.length; i++)
        cs.push(c[i]);
    }
    n = n.right;
  }
  return cs;
}, typeListForEach = (type, f) => {
  let index = 0, n = type._start;
  for (type.doc ?? warnPrematureAccess(); n !== null; ) {
    if (n.countable && !n.deleted) {
      let c = n.content.getContent();
      for (let i = 0; i < c.length; i++)
        f(c[i], index++, type);
    }
    n = n.right;
  }
}, typeListMap = (type, f) => {
  let result = [];
  return typeListForEach(type, (c, i) => {
    result.push(f(c, i, type));
  }), result;
}, typeListCreateIterator = (type) => {
  let n = type._start, currentContent = null, currentContentIndex = 0;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next: () => {
      if (currentContent === null) {
        for (; n !== null && n.deleted; )
          n = n.right;
        if (n === null)
          return {
            done: !0,
            value: void 0
          };
        currentContent = n.content.getContent(), currentContentIndex = 0, n = n.right;
      }
      let value = currentContent[currentContentIndex++];
      return currentContent.length <= currentContentIndex && (currentContent = null), {
        done: !1,
        value
      };
    }
  };
}, typeListGet = (type, index) => {
  type.doc ?? warnPrematureAccess();
  let marker = findMarker(type, index), n = type._start;
  for (marker !== null && (n = marker.p, index -= marker.index); n !== null; n = n.right)
    if (!n.deleted && n.countable) {
      if (index < n.length)
        return n.content.getContent()[index];
      index -= n.length;
    }
}, typeListInsertGenericsAfter = (transaction, parent, referenceItem, content) => {
  let left = referenceItem, doc2 = transaction.doc, ownClientId = doc2.clientID, store = doc2.store, right = referenceItem === null ? parent._start : referenceItem.right, jsonContent = [], packJsonContent = () => {
    jsonContent.length > 0 && (left = new Item(createID(ownClientId, getState(store, ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentAny(jsonContent)), left.integrate(transaction, 0), jsonContent = []);
  };
  content.forEach((c) => {
    if (c === null)
      jsonContent.push(c);
    else
      switch (c.constructor) {
        case Number:
        case Object:
        case Boolean:
        case Array:
        case String:
          jsonContent.push(c);
          break;
        default:
          switch (packJsonContent(), c.constructor) {
            case Uint8Array:
            case ArrayBuffer:
              left = new Item(createID(ownClientId, getState(store, ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentBinary(new Uint8Array(
                /** @type {Uint8Array} */
                c
              ))), left.integrate(transaction, 0);
              break;
            case Doc:
              left = new Item(createID(ownClientId, getState(store, ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentDoc(
                /** @type {Doc} */
                c
              )), left.integrate(transaction, 0);
              break;
            default:
              if (c instanceof AbstractType)
                left = new Item(createID(ownClientId, getState(store, ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentType(c)), left.integrate(transaction, 0);
              else
                throw new Error("Unexpected content type in insert operation");
          }
      }
  }), packJsonContent();
}, lengthExceeded = () => create3("Length exceeded!"), typeListInsertGenerics = (transaction, parent, index, content) => {
  if (index > parent._length)
    throw lengthExceeded();
  if (index === 0)
    return parent._searchMarker && updateMarkerChanges(parent._searchMarker, index, content.length), typeListInsertGenericsAfter(transaction, parent, null, content);
  let startIndex = index, marker = findMarker(parent, index), n = parent._start;
  for (marker !== null && (n = marker.p, index -= marker.index, index === 0 && (n = n.prev, index += n && n.countable && !n.deleted ? n.length : 0)); n !== null; n = n.right)
    if (!n.deleted && n.countable) {
      if (index <= n.length) {
        index < n.length && getItemCleanStart(transaction, createID(n.id.client, n.id.clock + index));
        break;
      }
      index -= n.length;
    }
  return parent._searchMarker && updateMarkerChanges(parent._searchMarker, startIndex, content.length), typeListInsertGenericsAfter(transaction, parent, n, content);
}, typeListPushGenerics = (transaction, parent, content) => {
  let n = (parent._searchMarker || []).reduce((maxMarker, currMarker) => currMarker.index > maxMarker.index ? currMarker : maxMarker, { index: 0, p: parent._start }).p;
  if (n)
    for (; n.right; )
      n = n.right;
  return typeListInsertGenericsAfter(transaction, parent, n, content);
}, typeListDelete = (transaction, parent, index, length2) => {
  if (length2 === 0)
    return;
  let startIndex = index, startLength = length2, marker = findMarker(parent, index), n = parent._start;
  for (marker !== null && (n = marker.p, index -= marker.index); n !== null && index > 0; n = n.right)
    !n.deleted && n.countable && (index < n.length && getItemCleanStart(transaction, createID(n.id.client, n.id.clock + index)), index -= n.length);
  for (; length2 > 0 && n !== null; )
    n.deleted || (length2 < n.length && getItemCleanStart(transaction, createID(n.id.client, n.id.clock + length2)), n.delete(transaction), length2 -= n.length), n = n.right;
  if (length2 > 0)
    throw lengthExceeded();
  parent._searchMarker && updateMarkerChanges(
    parent._searchMarker,
    startIndex,
    -startLength + length2
    /* in case we remove the above exception */
  );
}, typeMapDelete = (transaction, parent, key) => {
  let c = parent._map.get(key);
  c !== void 0 && c.delete(transaction);
}, typeMapSet = (transaction, parent, key, value) => {
  let left = parent._map.get(key) || null, doc2 = transaction.doc, ownClientId = doc2.clientID, content;
  if (value == null)
    content = new ContentAny([value]);
  else
    switch (value.constructor) {
      case Number:
      case Object:
      case Boolean:
      case Array:
      case String:
      case Date:
      case BigInt:
        content = new ContentAny([value]);
        break;
      case Uint8Array:
        content = new ContentBinary(
          /** @type {Uint8Array} */
          value
        );
        break;
      case Doc:
        content = new ContentDoc(
          /** @type {Doc} */
          value
        );
        break;
      default:
        if (value instanceof AbstractType)
          content = new ContentType(value);
        else
          throw new Error("Unexpected content type");
    }
  new Item(createID(ownClientId, getState(doc2.store, ownClientId)), left, left && left.lastId, null, null, parent, key, content).integrate(transaction, 0);
}, typeMapGet = (parent, key) => {
  parent.doc ?? warnPrematureAccess();
  let val = parent._map.get(key);
  return val !== void 0 && !val.deleted ? val.content.getContent()[val.length - 1] : void 0;
}, typeMapGetAll = (parent) => {
  let res = {};
  return parent.doc ?? warnPrematureAccess(), parent._map.forEach((value, key) => {
    value.deleted || (res[key] = value.content.getContent()[value.length - 1]);
  }), res;
}, typeMapHas = (parent, key) => {
  parent.doc ?? warnPrematureAccess();
  let val = parent._map.get(key);
  return val !== void 0 && !val.deleted;
}, typeMapGetSnapshot = (parent, key, snapshot2) => {
  let v = parent._map.get(key) || null;
  for (; v !== null && (!snapshot2.sv.has(v.id.client) || v.id.clock >= (snapshot2.sv.get(v.id.client) || 0)); )
    v = v.left;
  return v !== null && isVisible(v, snapshot2) ? v.content.getContent()[v.length - 1] : void 0;
}, typeMapGetAllSnapshot = (parent, snapshot2) => {
  let res = {};
  return parent._map.forEach((value, key) => {
    let v = value;
    for (; v !== null && (!snapshot2.sv.has(v.id.client) || v.id.clock >= (snapshot2.sv.get(v.id.client) || 0)); )
      v = v.left;
    v !== null && isVisible(v, snapshot2) && (res[key] = v.content.getContent()[v.length - 1]);
  }), res;
}, createMapIterator = (type) => (type.doc ?? warnPrematureAccess(), iteratorFilter(
  type._map.entries(),
  /** @param {any} entry */
  (entry) => !entry[1].deleted
)), YArrayEvent = class extends YEvent {
}, YArray = class _YArray extends AbstractType {
  constructor() {
    super(), this._prelimContent = [], this._searchMarker = [];
  }
  /**
   * Construct a new YArray containing the specified items.
   * @template {Object<string,any>|Array<any>|number|null|string|Uint8Array} T
   * @param {Array<T>} items
   * @return {YArray<T>}
   */
  static from(items) {
    let a = new _YArray();
    return a.push(items), a;
  }
  /**
   * Integrate this type into the Yjs instance.
   *
   * * Save this struct in the os
   * * This type is sent to other client
   * * Observer functions are fired
   *
   * @param {Doc} y The Yjs instance
   * @param {Item} item
   */
  _integrate(y, item) {
    super._integrate(y, item), this.insert(
      0,
      /** @type {Array<any>} */
      this._prelimContent
    ), this._prelimContent = null;
  }
  /**
   * @return {YArray<T>}
   */
  _copy() {
    return new _YArray();
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {YArray<T>}
   */
  clone() {
    let arr = new _YArray();
    return arr.insert(0, this.toArray().map(
      (el) => el instanceof AbstractType ? (
        /** @type {typeof el} */
        el.clone()
      ) : el
    )), arr;
  }
  get length() {
    return this.doc ?? warnPrematureAccess(), this._length;
  }
  /**
   * Creates YArrayEvent and calls observers.
   *
   * @param {Transaction} transaction
   * @param {Set<null|string>} parentSubs Keys changed on this type. `null` if list was modified.
   */
  _callObserver(transaction, parentSubs) {
    super._callObserver(transaction, parentSubs), callTypeObservers(this, transaction, new YArrayEvent(this, transaction));
  }
  /**
   * Inserts new content at an index.
   *
   * Important: This function expects an array of content. Not just a content
   * object. The reason for this "weirdness" is that inserting several elements
   * is very efficient when it is done as a single operation.
   *
   * @example
   *  // Insert character 'a' at position 0
   *  yarray.insert(0, ['a'])
   *  // Insert numbers 1, 2 at position 1
   *  yarray.insert(1, [1, 2])
   *
   * @param {number} index The index to insert content at.
   * @param {Array<T>} content The array of content
   */
  insert(index, content) {
    this.doc !== null ? transact(this.doc, (transaction) => {
      typeListInsertGenerics(
        transaction,
        this,
        index,
        /** @type {any} */
        content
      );
    }) : this._prelimContent.splice(index, 0, ...content);
  }
  /**
   * Appends content to this YArray.
   *
   * @param {Array<T>} content Array of content to append.
   *
   * @todo Use the following implementation in all types.
   */
  push(content) {
    this.doc !== null ? transact(this.doc, (transaction) => {
      typeListPushGenerics(
        transaction,
        this,
        /** @type {any} */
        content
      );
    }) : this._prelimContent.push(...content);
  }
  /**
   * Prepends content to this YArray.
   *
   * @param {Array<T>} content Array of content to prepend.
   */
  unshift(content) {
    this.insert(0, content);
  }
  /**
   * Deletes elements starting from an index.
   *
   * @param {number} index Index at which to start deleting elements
   * @param {number} length The number of elements to remove. Defaults to 1.
   */
  delete(index, length2 = 1) {
    this.doc !== null ? transact(this.doc, (transaction) => {
      typeListDelete(transaction, this, index, length2);
    }) : this._prelimContent.splice(index, length2);
  }
  /**
   * Returns the i-th element from a YArray.
   *
   * @param {number} index The index of the element to return from the YArray
   * @return {T}
   */
  get(index) {
    return typeListGet(this, index);
  }
  /**
   * Transforms this YArray to a JavaScript Array.
   *
   * @return {Array<T>}
   */
  toArray() {
    return typeListToArray(this);
  }
  /**
   * Returns a portion of this YArray into a JavaScript Array selected
   * from start to end (end not included).
   *
   * @param {number} [start]
   * @param {number} [end]
   * @return {Array<T>}
   */
  slice(start = 0, end = this.length) {
    return typeListSlice(this, start, end);
  }
  /**
   * Transforms this Shared Type to a JSON object.
   *
   * @return {Array<any>}
   */
  toJSON() {
    return this.map((c) => c instanceof AbstractType ? c.toJSON() : c);
  }
  /**
   * Returns an Array with the result of calling a provided function on every
   * element of this YArray.
   *
   * @template M
   * @param {function(T,number,YArray<T>):M} f Function that produces an element of the new Array
   * @return {Array<M>} A new array with each element being the result of the
   *                 callback function
   */
  map(f) {
    return typeListMap(
      this,
      /** @type {any} */
      f
    );
  }
  /**
   * Executes a provided function once on every element of this YArray.
   *
   * @param {function(T,number,YArray<T>):void} f A function to execute on every element of this YArray.
   */
  forEach(f) {
    typeListForEach(this, f);
  }
  /**
   * @return {IterableIterator<T>}
   */
  [Symbol.iterator]() {
    return typeListCreateIterator(this);
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   */
  _write(encoder) {
    encoder.writeTypeRef(YArrayRefID);
  }
}, readYArray = (_decoder) => new YArray(), YMapEvent = class extends YEvent {
  /**
   * @param {YMap<T>} ymap The YArray that changed.
   * @param {Transaction} transaction
   * @param {Set<any>} subs The keys that changed.
   */
  constructor(ymap, transaction, subs) {
    super(ymap, transaction), this.keysChanged = subs;
  }
}, YMap = class _YMap extends AbstractType {
  /**
   *
   * @param {Iterable<readonly [string, any]>=} entries - an optional iterable to initialize the YMap
   */
  constructor(entries) {
    super(), this._prelimContent = null, entries === void 0 ? this._prelimContent = /* @__PURE__ */ new Map() : this._prelimContent = new Map(entries);
  }
  /**
   * Integrate this type into the Yjs instance.
   *
   * * Save this struct in the os
   * * This type is sent to other client
   * * Observer functions are fired
   *
   * @param {Doc} y The Yjs instance
   * @param {Item} item
   */
  _integrate(y, item) {
    super._integrate(y, item), this._prelimContent.forEach((value, key) => {
      this.set(key, value);
    }), this._prelimContent = null;
  }
  /**
   * @return {YMap<MapType>}
   */
  _copy() {
    return new _YMap();
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {YMap<MapType>}
   */
  clone() {
    let map2 = new _YMap();
    return this.forEach((value, key) => {
      map2.set(key, value instanceof AbstractType ? (
        /** @type {typeof value} */
        value.clone()
      ) : value);
    }), map2;
  }
  /**
   * Creates YMapEvent and calls observers.
   *
   * @param {Transaction} transaction
   * @param {Set<null|string>} parentSubs Keys changed on this type. `null` if list was modified.
   */
  _callObserver(transaction, parentSubs) {
    callTypeObservers(this, transaction, new YMapEvent(this, transaction, parentSubs));
  }
  /**
   * Transforms this Shared Type to a JSON object.
   *
   * @return {Object<string,any>}
   */
  toJSON() {
    this.doc ?? warnPrematureAccess();
    let map2 = {};
    return this._map.forEach((item, key) => {
      if (!item.deleted) {
        let v = item.content.getContent()[item.length - 1];
        map2[key] = v instanceof AbstractType ? v.toJSON() : v;
      }
    }), map2;
  }
  /**
   * Returns the size of the YMap (count of key/value pairs)
   *
   * @return {number}
   */
  get size() {
    return [...createMapIterator(this)].length;
  }
  /**
   * Returns the keys for each element in the YMap Type.
   *
   * @return {IterableIterator<string>}
   */
  keys() {
    return iteratorMap(
      createMapIterator(this),
      /** @param {any} v */
      (v) => v[0]
    );
  }
  /**
   * Returns the values for each element in the YMap Type.
   *
   * @return {IterableIterator<MapType>}
   */
  values() {
    return iteratorMap(
      createMapIterator(this),
      /** @param {any} v */
      (v) => v[1].content.getContent()[v[1].length - 1]
    );
  }
  /**
   * Returns an Iterator of [key, value] pairs
   *
   * @return {IterableIterator<[string, MapType]>}
   */
  entries() {
    return iteratorMap(
      createMapIterator(this),
      /** @param {any} v */
      (v) => (
        /** @type {any} */
        [v[0], v[1].content.getContent()[v[1].length - 1]]
      )
    );
  }
  /**
   * Executes a provided function on once on every key-value pair.
   *
   * @param {function(MapType,string,YMap<MapType>):void} f A function to execute on every element of this YArray.
   */
  forEach(f) {
    this.doc ?? warnPrematureAccess(), this._map.forEach((item, key) => {
      item.deleted || f(item.content.getContent()[item.length - 1], key, this);
    });
  }
  /**
   * Returns an Iterator of [key, value] pairs
   *
   * @return {IterableIterator<[string, MapType]>}
   */
  [Symbol.iterator]() {
    return this.entries();
  }
  /**
   * Remove a specified element from this YMap.
   *
   * @param {string} key The key of the element to remove.
   */
  delete(key) {
    this.doc !== null ? transact(this.doc, (transaction) => {
      typeMapDelete(transaction, this, key);
    }) : this._prelimContent.delete(key);
  }
  /**
   * Adds or updates an element with a specified key and value.
   * @template {MapType} VAL
   *
   * @param {string} key The key of the element to add to this YMap
   * @param {VAL} value The value of the element to add
   * @return {VAL}
   */
  set(key, value) {
    return this.doc !== null ? transact(this.doc, (transaction) => {
      typeMapSet(
        transaction,
        this,
        key,
        /** @type {any} */
        value
      );
    }) : this._prelimContent.set(key, value), value;
  }
  /**
   * Returns a specified element from this YMap.
   *
   * @param {string} key
   * @return {MapType|undefined}
   */
  get(key) {
    return (
      /** @type {any} */
      typeMapGet(this, key)
    );
  }
  /**
   * Returns a boolean indicating whether the specified key exists or not.
   *
   * @param {string} key The key to test.
   * @return {boolean}
   */
  has(key) {
    return typeMapHas(this, key);
  }
  /**
   * Removes all elements from this YMap.
   */
  clear() {
    this.doc !== null ? transact(this.doc, (transaction) => {
      this.forEach(function(_value, key, map2) {
        typeMapDelete(transaction, map2, key);
      });
    }) : this._prelimContent.clear();
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   */
  _write(encoder) {
    encoder.writeTypeRef(YMapRefID);
  }
}, readYMap = (_decoder) => new YMap(), equalAttrs = (a, b) => a === b || typeof a == "object" && typeof b == "object" && a && b && equalFlat(a, b), ItemTextListPosition = class {
  /**
   * @param {Item|null} left
   * @param {Item|null} right
   * @param {number} index
   * @param {Map<string,any>} currentAttributes
   */
  constructor(left, right, index, currentAttributes) {
    this.left = left, this.right = right, this.index = index, this.currentAttributes = currentAttributes;
  }
  /**
   * Only call this if you know that this.right is defined
   */
  forward() {
    this.right === null && unexpectedCase(), this.right.content.constructor === ContentFormat ? this.right.deleted || updateCurrentAttributes(
      this.currentAttributes,
      /** @type {ContentFormat} */
      this.right.content
    ) : this.right.deleted || (this.index += this.right.length), this.left = this.right, this.right = this.right.right;
  }
}, findNextPosition = (transaction, pos, count) => {
  for (; pos.right !== null && count > 0; )
    pos.right.content.constructor === ContentFormat ? pos.right.deleted || updateCurrentAttributes(
      pos.currentAttributes,
      /** @type {ContentFormat} */
      pos.right.content
    ) : pos.right.deleted || (count < pos.right.length && getItemCleanStart(transaction, createID(pos.right.id.client, pos.right.id.clock + count)), pos.index += pos.right.length, count -= pos.right.length), pos.left = pos.right, pos.right = pos.right.right;
  return pos;
}, findPosition = (transaction, parent, index, useSearchMarker) => {
  let currentAttributes = /* @__PURE__ */ new Map(), marker = useSearchMarker ? findMarker(parent, index) : null;
  if (marker) {
    let pos = new ItemTextListPosition(marker.p.left, marker.p, marker.index, currentAttributes);
    return findNextPosition(transaction, pos, index - marker.index);
  } else {
    let pos = new ItemTextListPosition(null, parent._start, 0, currentAttributes);
    return findNextPosition(transaction, pos, index);
  }
}, insertNegatedAttributes = (transaction, parent, currPos, negatedAttributes) => {
  for (; currPos.right !== null && (currPos.right.deleted === !0 || currPos.right.content.constructor === ContentFormat && equalAttrs(
    negatedAttributes.get(
      /** @type {ContentFormat} */
      currPos.right.content.key
    ),
    /** @type {ContentFormat} */
    currPos.right.content.value
  )); )
    currPos.right.deleted || negatedAttributes.delete(
      /** @type {ContentFormat} */
      currPos.right.content.key
    ), currPos.forward();
  let doc2 = transaction.doc, ownClientId = doc2.clientID;
  negatedAttributes.forEach((val, key) => {
    let left = currPos.left, right = currPos.right, nextFormat = new Item(createID(ownClientId, getState(doc2.store, ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentFormat(key, val));
    nextFormat.integrate(transaction, 0), currPos.right = nextFormat, currPos.forward();
  });
}, updateCurrentAttributes = (currentAttributes, format) => {
  let { key, value } = format;
  value === null ? currentAttributes.delete(key) : currentAttributes.set(key, value);
}, minimizeAttributeChanges = (currPos, attributes) => {
  for (; currPos.right !== null; ) {
    if (!(currPos.right.deleted || currPos.right.content.constructor === ContentFormat && equalAttrs(
      attributes[
        /** @type {ContentFormat} */
        currPos.right.content.key
      ] ?? null,
      /** @type {ContentFormat} */
      currPos.right.content.value
    ))) break;
    currPos.forward();
  }
}, insertAttributes = (transaction, parent, currPos, attributes) => {
  let doc2 = transaction.doc, ownClientId = doc2.clientID, negatedAttributes = /* @__PURE__ */ new Map();
  for (let key in attributes) {
    let val = attributes[key], currentVal = currPos.currentAttributes.get(key) ?? null;
    if (!equalAttrs(currentVal, val)) {
      negatedAttributes.set(key, currentVal);
      let { left, right } = currPos;
      currPos.right = new Item(createID(ownClientId, getState(doc2.store, ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentFormat(key, val)), currPos.right.integrate(transaction, 0), currPos.forward();
    }
  }
  return negatedAttributes;
}, insertText = (transaction, parent, currPos, text2, attributes) => {
  currPos.currentAttributes.forEach((_val, key) => {
    attributes[key] === void 0 && (attributes[key] = null);
  });
  let doc2 = transaction.doc, ownClientId = doc2.clientID;
  minimizeAttributeChanges(currPos, attributes);
  let negatedAttributes = insertAttributes(transaction, parent, currPos, attributes), content = text2.constructor === String ? new ContentString(
    /** @type {string} */
    text2
  ) : text2 instanceof AbstractType ? new ContentType(text2) : new ContentEmbed(text2), { left, right, index } = currPos;
  parent._searchMarker && updateMarkerChanges(parent._searchMarker, currPos.index, content.getLength()), right = new Item(createID(ownClientId, getState(doc2.store, ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, content), right.integrate(transaction, 0), currPos.right = right, currPos.index = index, currPos.forward(), insertNegatedAttributes(transaction, parent, currPos, negatedAttributes);
}, formatText = (transaction, parent, currPos, length2, attributes) => {
  let doc2 = transaction.doc, ownClientId = doc2.clientID;
  minimizeAttributeChanges(currPos, attributes);
  let negatedAttributes = insertAttributes(transaction, parent, currPos, attributes);
  iterationLoop: for (; currPos.right !== null && (length2 > 0 || negatedAttributes.size > 0 && (currPos.right.deleted || currPos.right.content.constructor === ContentFormat)); ) {
    if (!currPos.right.deleted)
      switch (currPos.right.content.constructor) {
        case ContentFormat: {
          let { key, value } = (
            /** @type {ContentFormat} */
            currPos.right.content
          ), attr = attributes[key];
          if (attr !== void 0) {
            if (equalAttrs(attr, value))
              negatedAttributes.delete(key);
            else {
              if (length2 === 0)
                break iterationLoop;
              negatedAttributes.set(key, value);
            }
            currPos.right.delete(transaction);
          } else
            currPos.currentAttributes.set(key, value);
          break;
        }
        default:
          length2 < currPos.right.length && getItemCleanStart(transaction, createID(currPos.right.id.client, currPos.right.id.clock + length2)), length2 -= currPos.right.length;
          break;
      }
    currPos.forward();
  }
  if (length2 > 0) {
    let newlines = "";
    for (; length2 > 0; length2--)
      newlines += `
`;
    currPos.right = new Item(createID(ownClientId, getState(doc2.store, ownClientId)), currPos.left, currPos.left && currPos.left.lastId, currPos.right, currPos.right && currPos.right.id, parent, null, new ContentString(newlines)), currPos.right.integrate(transaction, 0), currPos.forward();
  }
  insertNegatedAttributes(transaction, parent, currPos, negatedAttributes);
}, cleanupFormattingGap = (transaction, start, curr, startAttributes, currAttributes) => {
  let end = start, endFormats = create();
  for (; end && (!end.countable || end.deleted); ) {
    if (!end.deleted && end.content.constructor === ContentFormat) {
      let cf = (
        /** @type {ContentFormat} */
        end.content
      );
      endFormats.set(cf.key, cf);
    }
    end = end.right;
  }
  let cleanups = 0, reachedCurr = !1;
  for (; start !== end; ) {
    if (curr === start && (reachedCurr = !0), !start.deleted) {
      let content = start.content;
      if (content.constructor === ContentFormat) {
        let { key, value } = (
          /** @type {ContentFormat} */
          content
        ), startAttrValue = startAttributes.get(key) ?? null;
        (endFormats.get(key) !== content || startAttrValue === value) && (start.delete(transaction), cleanups++, !reachedCurr && (currAttributes.get(key) ?? null) === value && startAttrValue !== value && (startAttrValue === null ? currAttributes.delete(key) : currAttributes.set(key, startAttrValue))), !reachedCurr && !start.deleted && updateCurrentAttributes(
          currAttributes,
          /** @type {ContentFormat} */
          content
        );
      }
    }
    start = /** @type {Item} */
    start.right;
  }
  return cleanups;
}, cleanupContextlessFormattingGap = (transaction, item) => {
  for (; item && item.right && (item.right.deleted || !item.right.countable); )
    item = item.right;
  let attrs = /* @__PURE__ */ new Set();
  for (; item && (item.deleted || !item.countable); ) {
    if (!item.deleted && item.content.constructor === ContentFormat) {
      let key = (
        /** @type {ContentFormat} */
        item.content.key
      );
      attrs.has(key) ? item.delete(transaction) : attrs.add(key);
    }
    item = item.left;
  }
}, cleanupYTextFormatting = (type) => {
  let res = 0;
  return transact(
    /** @type {Doc} */
    type.doc,
    (transaction) => {
      let start = (
        /** @type {Item} */
        type._start
      ), end = type._start, startAttributes = create(), currentAttributes = copy(startAttributes);
      for (; end; )
        end.deleted === !1 && (end.content.constructor === ContentFormat ? updateCurrentAttributes(
          currentAttributes,
          /** @type {ContentFormat} */
          end.content
        ) : (res += cleanupFormattingGap(transaction, start, end, startAttributes, currentAttributes), startAttributes = copy(currentAttributes), start = end)), end = end.right;
    }
  ), res;
}, cleanupYTextAfterTransaction = (transaction) => {
  let needFullCleanup = /* @__PURE__ */ new Set(), doc2 = transaction.doc;
  for (let [client, afterClock] of transaction.afterState.entries()) {
    let clock = transaction.beforeState.get(client) || 0;
    afterClock !== clock && iterateStructs(
      transaction,
      /** @type {Array<Item|GC>} */
      doc2.store.clients.get(client),
      clock,
      afterClock,
      (item) => {
        !item.deleted && /** @type {Item} */
        item.content.constructor === ContentFormat && item.constructor !== GC && needFullCleanup.add(
          /** @type {any} */
          item.parent
        );
      }
    );
  }
  transact(doc2, (t) => {
    iterateDeletedStructs(transaction, transaction.deleteSet, (item) => {
      if (item instanceof GC || !/** @type {YText} */
      item.parent._hasFormatting || needFullCleanup.has(
        /** @type {YText} */
        item.parent
      ))
        return;
      let parent = (
        /** @type {YText} */
        item.parent
      );
      item.content.constructor === ContentFormat ? needFullCleanup.add(parent) : cleanupContextlessFormattingGap(t, item);
    });
    for (let yText of needFullCleanup)
      cleanupYTextFormatting(yText);
  });
}, deleteText = (transaction, currPos, length2) => {
  let startLength = length2, startAttrs = copy(currPos.currentAttributes), start = currPos.right;
  for (; length2 > 0 && currPos.right !== null; ) {
    if (currPos.right.deleted === !1)
      switch (currPos.right.content.constructor) {
        case ContentType:
        case ContentEmbed:
        case ContentString:
          length2 < currPos.right.length && getItemCleanStart(transaction, createID(currPos.right.id.client, currPos.right.id.clock + length2)), length2 -= currPos.right.length, currPos.right.delete(transaction);
          break;
      }
    currPos.forward();
  }
  start && cleanupFormattingGap(transaction, start, currPos.right, startAttrs, currPos.currentAttributes);
  let parent = (
    /** @type {AbstractType<any>} */
    /** @type {Item} */
    (currPos.left || currPos.right).parent
  );
  return parent._searchMarker && updateMarkerChanges(parent._searchMarker, currPos.index, -startLength + length2), currPos;
}, YTextEvent = class extends YEvent {
  /**
   * @param {YText} ytext
   * @param {Transaction} transaction
   * @param {Set<any>} subs The keys that changed
   */
  constructor(ytext, transaction, subs) {
    super(ytext, transaction), this.childListChanged = !1, this.keysChanged = /* @__PURE__ */ new Set(), subs.forEach((sub) => {
      sub === null ? this.childListChanged = !0 : this.keysChanged.add(sub);
    });
  }
  /**
   * @type {{added:Set<Item>,deleted:Set<Item>,keys:Map<string,{action:'add'|'update'|'delete',oldValue:any}>,delta:Array<{insert?:Array<any>|string, delete?:number, retain?:number}>}}
   */
  get changes() {
    if (this._changes === null) {
      let changes = {
        keys: this.keys,
        delta: this.delta,
        added: /* @__PURE__ */ new Set(),
        deleted: /* @__PURE__ */ new Set()
      };
      this._changes = changes;
    }
    return (
      /** @type {any} */
      this._changes
    );
  }
  /**
   * Compute the changes in the delta format.
   * A {@link https://quilljs.com/docs/delta/|Quill Delta}) that represents the changes on the document.
   *
   * @type {Array<{insert?:string|object|AbstractType<any>, delete?:number, retain?:number, attributes?: Object<string,any>}>}
   *
   * @public
   */
  get delta() {
    if (this._delta === null) {
      let y = (
        /** @type {Doc} */
        this.target.doc
      ), delta = [];
      transact(y, (transaction) => {
        let currentAttributes = /* @__PURE__ */ new Map(), oldAttributes = /* @__PURE__ */ new Map(), item = this.target._start, action = null, attributes = {}, insert = "", retain = 0, deleteLen = 0, addOp = () => {
          if (action !== null) {
            let op = null;
            switch (action) {
              case "delete":
                deleteLen > 0 && (op = { delete: deleteLen }), deleteLen = 0;
                break;
              case "insert":
                (typeof insert == "object" || insert.length > 0) && (op = { insert }, currentAttributes.size > 0 && (op.attributes = {}, currentAttributes.forEach((value, key) => {
                  value !== null && (op.attributes[key] = value);
                }))), insert = "";
                break;
              case "retain":
                retain > 0 && (op = { retain }, isEmpty(attributes) || (op.attributes = assign({}, attributes))), retain = 0;
                break;
            }
            op && delta.push(op), action = null;
          }
        };
        for (; item !== null; ) {
          switch (item.content.constructor) {
            case ContentType:
            case ContentEmbed:
              this.adds(item) ? this.deletes(item) || (addOp(), action = "insert", insert = item.content.getContent()[0], addOp()) : this.deletes(item) ? (action !== "delete" && (addOp(), action = "delete"), deleteLen += 1) : item.deleted || (action !== "retain" && (addOp(), action = "retain"), retain += 1);
              break;
            case ContentString:
              this.adds(item) ? this.deletes(item) || (action !== "insert" && (addOp(), action = "insert"), insert += /** @type {ContentString} */
              item.content.str) : this.deletes(item) ? (action !== "delete" && (addOp(), action = "delete"), deleteLen += item.length) : item.deleted || (action !== "retain" && (addOp(), action = "retain"), retain += item.length);
              break;
            case ContentFormat: {
              let { key, value } = (
                /** @type {ContentFormat} */
                item.content
              );
              if (this.adds(item)) {
                if (!this.deletes(item)) {
                  let curVal = currentAttributes.get(key) ?? null;
                  equalAttrs(curVal, value) ? value !== null && item.delete(transaction) : (action === "retain" && addOp(), equalAttrs(value, oldAttributes.get(key) ?? null) ? delete attributes[key] : attributes[key] = value);
                }
              } else if (this.deletes(item)) {
                oldAttributes.set(key, value);
                let curVal = currentAttributes.get(key) ?? null;
                equalAttrs(curVal, value) || (action === "retain" && addOp(), attributes[key] = curVal);
              } else if (!item.deleted) {
                oldAttributes.set(key, value);
                let attr = attributes[key];
                attr !== void 0 && (equalAttrs(attr, value) ? attr !== null && item.delete(transaction) : (action === "retain" && addOp(), value === null ? delete attributes[key] : attributes[key] = value));
              }
              item.deleted || (action === "insert" && addOp(), updateCurrentAttributes(
                currentAttributes,
                /** @type {ContentFormat} */
                item.content
              ));
              break;
            }
          }
          item = item.right;
        }
        for (addOp(); delta.length > 0; ) {
          let lastOp = delta[delta.length - 1];
          if (lastOp.retain !== void 0 && lastOp.attributes === void 0)
            delta.pop();
          else
            break;
        }
      }), this._delta = delta;
    }
    return (
      /** @type {any} */
      this._delta
    );
  }
}, YText = class _YText extends AbstractType {
  /**
   * @param {String} [string] The initial value of the YText.
   */
  constructor(string) {
    super(), this._pending = string !== void 0 ? [() => this.insert(0, string)] : [], this._searchMarker = [], this._hasFormatting = !1;
  }
  /**
   * Number of characters of this text type.
   *
   * @type {number}
   */
  get length() {
    return this.doc ?? warnPrematureAccess(), this._length;
  }
  /**
   * @param {Doc} y
   * @param {Item} item
   */
  _integrate(y, item) {
    super._integrate(y, item);
    try {
      this._pending.forEach((f) => f());
    } catch (e) {
      console.error(e);
    }
    this._pending = null;
  }
  _copy() {
    return new _YText();
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {YText}
   */
  clone() {
    let text2 = new _YText();
    return text2.applyDelta(this.toDelta()), text2;
  }
  /**
   * Creates YTextEvent and calls observers.
   *
   * @param {Transaction} transaction
   * @param {Set<null|string>} parentSubs Keys changed on this type. `null` if list was modified.
   */
  _callObserver(transaction, parentSubs) {
    super._callObserver(transaction, parentSubs);
    let event = new YTextEvent(this, transaction, parentSubs);
    callTypeObservers(this, transaction, event), !transaction.local && this._hasFormatting && (transaction._needFormattingCleanup = !0);
  }
  /**
   * Returns the unformatted string representation of this YText type.
   *
   * @public
   */
  toString() {
    this.doc ?? warnPrematureAccess();
    let str = "", n = this._start;
    for (; n !== null; )
      !n.deleted && n.countable && n.content.constructor === ContentString && (str += /** @type {ContentString} */
      n.content.str), n = n.right;
    return str;
  }
  /**
   * Returns the unformatted string representation of this YText type.
   *
   * @return {string}
   * @public
   */
  toJSON() {
    return this.toString();
  }
  /**
   * Apply a {@link Delta} on this shared YText type.
   *
   * @param {Array<any>} delta The changes to apply on this element.
   * @param {object}  opts
   * @param {boolean} [opts.sanitize] Sanitize input delta. Removes ending newlines if set to true.
   *
   *
   * @public
   */
  applyDelta(delta, { sanitize = !0 } = {}) {
    this.doc !== null ? transact(this.doc, (transaction) => {
      let currPos = new ItemTextListPosition(null, this._start, 0, /* @__PURE__ */ new Map());
      for (let i = 0; i < delta.length; i++) {
        let op = delta[i];
        if (op.insert !== void 0) {
          let ins = !sanitize && typeof op.insert == "string" && i === delta.length - 1 && currPos.right === null && op.insert.slice(-1) === `
` ? op.insert.slice(0, -1) : op.insert;
          (typeof ins != "string" || ins.length > 0) && insertText(transaction, this, currPos, ins, op.attributes || {});
        } else op.retain !== void 0 ? formatText(transaction, this, currPos, op.retain, op.attributes || {}) : op.delete !== void 0 && deleteText(transaction, currPos, op.delete);
      }
    }) : this._pending.push(() => this.applyDelta(delta));
  }
  /**
   * Returns the Delta representation of this YText type.
   *
   * @param {Snapshot} [snapshot]
   * @param {Snapshot} [prevSnapshot]
   * @param {function('removed' | 'added', ID):any} [computeYChange]
   * @return {any} The Delta representation of this type.
   *
   * @public
   */
  toDelta(snapshot2, prevSnapshot, computeYChange) {
    this.doc ?? warnPrematureAccess();
    let ops = [], currentAttributes = /* @__PURE__ */ new Map(), doc2 = (
      /** @type {Doc} */
      this.doc
    ), str = "", n = this._start;
    function packStr() {
      if (str.length > 0) {
        let attributes = {}, addAttributes = !1;
        currentAttributes.forEach((value, key) => {
          addAttributes = !0, attributes[key] = value;
        });
        let op = { insert: str };
        addAttributes && (op.attributes = attributes), ops.push(op), str = "";
      }
    }
    let computeDelta = () => {
      for (; n !== null; ) {
        if (isVisible(n, snapshot2) || prevSnapshot !== void 0 && isVisible(n, prevSnapshot))
          switch (n.content.constructor) {
            case ContentString: {
              let cur = currentAttributes.get("ychange");
              snapshot2 !== void 0 && !isVisible(n, snapshot2) ? (cur === void 0 || cur.user !== n.id.client || cur.type !== "removed") && (packStr(), currentAttributes.set("ychange", computeYChange ? computeYChange("removed", n.id) : { type: "removed" })) : prevSnapshot !== void 0 && !isVisible(n, prevSnapshot) ? (cur === void 0 || cur.user !== n.id.client || cur.type !== "added") && (packStr(), currentAttributes.set("ychange", computeYChange ? computeYChange("added", n.id) : { type: "added" })) : cur !== void 0 && (packStr(), currentAttributes.delete("ychange")), str += /** @type {ContentString} */
              n.content.str;
              break;
            }
            case ContentType:
            case ContentEmbed: {
              packStr();
              let op = {
                insert: n.content.getContent()[0]
              };
              if (currentAttributes.size > 0) {
                let attrs = (
                  /** @type {Object<string,any>} */
                  {}
                );
                op.attributes = attrs, currentAttributes.forEach((value, key) => {
                  attrs[key] = value;
                });
              }
              ops.push(op);
              break;
            }
            case ContentFormat:
              isVisible(n, snapshot2) && (packStr(), updateCurrentAttributes(
                currentAttributes,
                /** @type {ContentFormat} */
                n.content
              ));
              break;
          }
        n = n.right;
      }
      packStr();
    };
    return snapshot2 || prevSnapshot ? transact(doc2, (transaction) => {
      snapshot2 && splitSnapshotAffectedStructs(transaction, snapshot2), prevSnapshot && splitSnapshotAffectedStructs(transaction, prevSnapshot), computeDelta();
    }, "cleanup") : computeDelta(), ops;
  }
  /**
   * Insert text at a given index.
   *
   * @param {number} index The index at which to start inserting.
   * @param {String} text The text to insert at the specified position.
   * @param {TextAttributes} [attributes] Optionally define some formatting
   *                                    information to apply on the inserted
   *                                    Text.
   * @public
   */
  insert(index, text2, attributes) {
    if (text2.length <= 0)
      return;
    let y = this.doc;
    y !== null ? transact(y, (transaction) => {
      let pos = findPosition(transaction, this, index, !attributes);
      attributes || (attributes = {}, pos.currentAttributes.forEach((v, k) => {
        attributes[k] = v;
      })), insertText(transaction, this, pos, text2, attributes);
    }) : this._pending.push(() => this.insert(index, text2, attributes));
  }
  /**
   * Inserts an embed at a index.
   *
   * @param {number} index The index to insert the embed at.
   * @param {Object | AbstractType<any>} embed The Object that represents the embed.
   * @param {TextAttributes} [attributes] Attribute information to apply on the
   *                                    embed
   *
   * @public
   */
  insertEmbed(index, embed, attributes) {
    let y = this.doc;
    y !== null ? transact(y, (transaction) => {
      let pos = findPosition(transaction, this, index, !attributes);
      insertText(transaction, this, pos, embed, attributes || {});
    }) : this._pending.push(() => this.insertEmbed(index, embed, attributes || {}));
  }
  /**
   * Deletes text starting from an index.
   *
   * @param {number} index Index at which to start deleting.
   * @param {number} length The number of characters to remove. Defaults to 1.
   *
   * @public
   */
  delete(index, length2) {
    if (length2 === 0)
      return;
    let y = this.doc;
    y !== null ? transact(y, (transaction) => {
      deleteText(transaction, findPosition(transaction, this, index, !0), length2);
    }) : this._pending.push(() => this.delete(index, length2));
  }
  /**
   * Assigns properties to a range of text.
   *
   * @param {number} index The position where to start formatting.
   * @param {number} length The amount of characters to assign properties to.
   * @param {TextAttributes} attributes Attribute information to apply on the
   *                                    text.
   *
   * @public
   */
  format(index, length2, attributes) {
    if (length2 === 0)
      return;
    let y = this.doc;
    y !== null ? transact(y, (transaction) => {
      let pos = findPosition(transaction, this, index, !1);
      pos.right !== null && formatText(transaction, this, pos, length2, attributes);
    }) : this._pending.push(() => this.format(index, length2, attributes));
  }
  /**
   * Removes an attribute.
   *
   * @note Xml-Text nodes don't have attributes. You can use this feature to assign properties to complete text-blocks.
   *
   * @param {String} attributeName The attribute name that is to be removed.
   *
   * @public
   */
  removeAttribute(attributeName) {
    this.doc !== null ? transact(this.doc, (transaction) => {
      typeMapDelete(transaction, this, attributeName);
    }) : this._pending.push(() => this.removeAttribute(attributeName));
  }
  /**
   * Sets or updates an attribute.
   *
   * @note Xml-Text nodes don't have attributes. You can use this feature to assign properties to complete text-blocks.
   *
   * @param {String} attributeName The attribute name that is to be set.
   * @param {any} attributeValue The attribute value that is to be set.
   *
   * @public
   */
  setAttribute(attributeName, attributeValue) {
    this.doc !== null ? transact(this.doc, (transaction) => {
      typeMapSet(transaction, this, attributeName, attributeValue);
    }) : this._pending.push(() => this.setAttribute(attributeName, attributeValue));
  }
  /**
   * Returns an attribute value that belongs to the attribute name.
   *
   * @note Xml-Text nodes don't have attributes. You can use this feature to assign properties to complete text-blocks.
   *
   * @param {String} attributeName The attribute name that identifies the
   *                               queried value.
   * @return {any} The queried attribute value.
   *
   * @public
   */
  getAttribute(attributeName) {
    return (
      /** @type {any} */
      typeMapGet(this, attributeName)
    );
  }
  /**
   * Returns all attribute name/value pairs in a JSON Object.
   *
   * @note Xml-Text nodes don't have attributes. You can use this feature to assign properties to complete text-blocks.
   *
   * @return {Object<string, any>} A JSON Object that describes the attributes.
   *
   * @public
   */
  getAttributes() {
    return typeMapGetAll(this);
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   */
  _write(encoder) {
    encoder.writeTypeRef(YTextRefID);
  }
}, readYText = (_decoder) => new YText(), YXmlTreeWalker = class {
  /**
   * @param {YXmlFragment | YXmlElement} root
   * @param {function(AbstractType<any>):boolean} [f]
   */
  constructor(root, f = () => !0) {
    this._filter = f, this._root = root, this._currentNode = /** @type {Item} */
    root._start, this._firstCall = !0, root.doc ?? warnPrematureAccess();
  }
  [Symbol.iterator]() {
    return this;
  }
  /**
   * Get the next node.
   *
   * @return {IteratorResult<YXmlElement|YXmlText|YXmlHook>} The next node.
   *
   * @public
   */
  next() {
    let n = this._currentNode, type = n && n.content && /** @type {any} */
    n.content.type;
    if (n !== null && (!this._firstCall || n.deleted || !this._filter(type)))
      do
        if (type = /** @type {any} */
        n.content.type, !n.deleted && (type.constructor === YXmlElement || type.constructor === YXmlFragment) && type._start !== null)
          n = type._start;
        else
          for (; n !== null; ) {
            let nxt = n.next;
            if (nxt !== null) {
              n = nxt;
              break;
            } else n.parent === this._root ? n = null : n = /** @type {AbstractType<any>} */
            n.parent._item;
          }
      while (n !== null && (n.deleted || !this._filter(
        /** @type {ContentType} */
        n.content.type
      )));
    return this._firstCall = !1, n === null ? { value: void 0, done: !0 } : (this._currentNode = n, { value: (
      /** @type {any} */
      n.content.type
    ), done: !1 });
  }
}, YXmlFragment = class _YXmlFragment extends AbstractType {
  constructor() {
    super(), this._prelimContent = [];
  }
  /**
   * @type {YXmlElement|YXmlText|null}
   */
  get firstChild() {
    let first = this._first;
    return first ? first.content.getContent()[0] : null;
  }
  /**
   * Integrate this type into the Yjs instance.
   *
   * * Save this struct in the os
   * * This type is sent to other client
   * * Observer functions are fired
   *
   * @param {Doc} y The Yjs instance
   * @param {Item} item
   */
  _integrate(y, item) {
    super._integrate(y, item), this.insert(
      0,
      /** @type {Array<any>} */
      this._prelimContent
    ), this._prelimContent = null;
  }
  _copy() {
    return new _YXmlFragment();
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {YXmlFragment}
   */
  clone() {
    let el = new _YXmlFragment();
    return el.insert(0, this.toArray().map((item) => item instanceof AbstractType ? item.clone() : item)), el;
  }
  get length() {
    return this.doc ?? warnPrematureAccess(), this._prelimContent === null ? this._length : this._prelimContent.length;
  }
  /**
   * Create a subtree of childNodes.
   *
   * @example
   * const walker = elem.createTreeWalker(dom => dom.nodeName === 'div')
   * for (let node in walker) {
   *   // `node` is a div node
   *   nop(node)
   * }
   *
   * @param {function(AbstractType<any>):boolean} filter Function that is called on each child element and
   *                          returns a Boolean indicating whether the child
   *                          is to be included in the subtree.
   * @return {YXmlTreeWalker} A subtree and a position within it.
   *
   * @public
   */
  createTreeWalker(filter) {
    return new YXmlTreeWalker(this, filter);
  }
  /**
   * Returns the first YXmlElement that matches the query.
   * Similar to DOM's {@link querySelector}.
   *
   * Query support:
   *   - tagname
   * TODO:
   *   - id
   *   - attribute
   *
   * @param {CSS_Selector} query The query on the children.
   * @return {YXmlElement|YXmlText|YXmlHook|null} The first element that matches the query or null.
   *
   * @public
   */
  querySelector(query) {
    query = query.toUpperCase();
    let next = new YXmlTreeWalker(this, (element2) => element2.nodeName && element2.nodeName.toUpperCase() === query).next();
    return next.done ? null : next.value;
  }
  /**
   * Returns all YXmlElements that match the query.
   * Similar to Dom's {@link querySelectorAll}.
   *
   * @todo Does not yet support all queries. Currently only query by tagName.
   *
   * @param {CSS_Selector} query The query on the children
   * @return {Array<YXmlElement|YXmlText|YXmlHook|null>} The elements that match this query.
   *
   * @public
   */
  querySelectorAll(query) {
    return query = query.toUpperCase(), from(new YXmlTreeWalker(this, (element2) => element2.nodeName && element2.nodeName.toUpperCase() === query));
  }
  /**
   * Creates YXmlEvent and calls observers.
   *
   * @param {Transaction} transaction
   * @param {Set<null|string>} parentSubs Keys changed on this type. `null` if list was modified.
   */
  _callObserver(transaction, parentSubs) {
    callTypeObservers(this, transaction, new YXmlEvent(this, parentSubs, transaction));
  }
  /**
   * Get the string representation of all the children of this YXmlFragment.
   *
   * @return {string} The string representation of all children.
   */
  toString() {
    return typeListMap(this, (xml) => xml.toString()).join("");
  }
  /**
   * @return {string}
   */
  toJSON() {
    return this.toString();
  }
  /**
   * Creates a Dom Element that mirrors this YXmlElement.
   *
   * @param {Document} [_document=document] The document object (you must define
   *                                        this when calling this method in
   *                                        nodejs)
   * @param {Object<string, any>} [hooks={}] Optional property to customize how hooks
   *                                             are presented in the DOM
   * @param {any} [binding] You should not set this property. This is
   *                               used if DomBinding wants to create a
   *                               association to the created DOM type.
   * @return {Node} The {@link https://developer.mozilla.org/en-US/docs/Web/API/Element|Dom Element}
   *
   * @public
   */
  toDOM(_document = document, hooks = {}, binding) {
    let fragment = _document.createDocumentFragment();
    return binding !== void 0 && binding._createAssociation(fragment, this), typeListForEach(this, (xmlType) => {
      fragment.insertBefore(xmlType.toDOM(_document, hooks, binding), null);
    }), fragment;
  }
  /**
   * Inserts new content at an index.
   *
   * @example
   *  // Insert character 'a' at position 0
   *  xml.insert(0, [new Y.XmlText('text')])
   *
   * @param {number} index The index to insert content at
   * @param {Array<YXmlElement|YXmlText>} content The array of content
   */
  insert(index, content) {
    this.doc !== null ? transact(this.doc, (transaction) => {
      typeListInsertGenerics(transaction, this, index, content);
    }) : this._prelimContent.splice(index, 0, ...content);
  }
  /**
   * Inserts new content at an index.
   *
   * @example
   *  // Insert character 'a' at position 0
   *  xml.insert(0, [new Y.XmlText('text')])
   *
   * @param {null|Item|YXmlElement|YXmlText} ref The index to insert content at
   * @param {Array<YXmlElement|YXmlText>} content The array of content
   */
  insertAfter(ref, content) {
    if (this.doc !== null)
      transact(this.doc, (transaction) => {
        let refItem = ref && ref instanceof AbstractType ? ref._item : ref;
        typeListInsertGenericsAfter(transaction, this, refItem, content);
      });
    else {
      let pc = (
        /** @type {Array<any>} */
        this._prelimContent
      ), index = ref === null ? 0 : pc.findIndex((el) => el === ref) + 1;
      if (index === 0 && ref !== null)
        throw create3("Reference item not found");
      pc.splice(index, 0, ...content);
    }
  }
  /**
   * Deletes elements starting from an index.
   *
   * @param {number} index Index at which to start deleting elements
   * @param {number} [length=1] The number of elements to remove. Defaults to 1.
   */
  delete(index, length2 = 1) {
    this.doc !== null ? transact(this.doc, (transaction) => {
      typeListDelete(transaction, this, index, length2);
    }) : this._prelimContent.splice(index, length2);
  }
  /**
   * Transforms this YArray to a JavaScript Array.
   *
   * @return {Array<YXmlElement|YXmlText|YXmlHook>}
   */
  toArray() {
    return typeListToArray(this);
  }
  /**
   * Appends content to this YArray.
   *
   * @param {Array<YXmlElement|YXmlText>} content Array of content to append.
   */
  push(content) {
    this.insert(this.length, content);
  }
  /**
   * Prepends content to this YArray.
   *
   * @param {Array<YXmlElement|YXmlText>} content Array of content to prepend.
   */
  unshift(content) {
    this.insert(0, content);
  }
  /**
   * Returns the i-th element from a YArray.
   *
   * @param {number} index The index of the element to return from the YArray
   * @return {YXmlElement|YXmlText}
   */
  get(index) {
    return typeListGet(this, index);
  }
  /**
   * Returns a portion of this YXmlFragment into a JavaScript Array selected
   * from start to end (end not included).
   *
   * @param {number} [start]
   * @param {number} [end]
   * @return {Array<YXmlElement|YXmlText>}
   */
  slice(start = 0, end = this.length) {
    return typeListSlice(this, start, end);
  }
  /**
   * Executes a provided function on once on every child element.
   *
   * @param {function(YXmlElement|YXmlText,number, typeof self):void} f A function to execute on every element of this YArray.
   */
  forEach(f) {
    typeListForEach(this, f);
  }
  /**
   * Transform the properties of this type to binary and write it to an
   * BinaryEncoder.
   *
   * This is called when this Item is sent to a remote peer.
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder The encoder to write data to.
   */
  _write(encoder) {
    encoder.writeTypeRef(YXmlFragmentRefID);
  }
}, readYXmlFragment = (_decoder) => new YXmlFragment(), YXmlElement = class _YXmlElement extends YXmlFragment {
  constructor(nodeName = "UNDEFINED") {
    super(), this.nodeName = nodeName, this._prelimAttrs = /* @__PURE__ */ new Map();
  }
  /**
   * @type {YXmlElement|YXmlText|null}
   */
  get nextSibling() {
    let n = this._item ? this._item.next : null;
    return n ? (
      /** @type {YXmlElement|YXmlText} */
      /** @type {ContentType} */
      n.content.type
    ) : null;
  }
  /**
   * @type {YXmlElement|YXmlText|null}
   */
  get prevSibling() {
    let n = this._item ? this._item.prev : null;
    return n ? (
      /** @type {YXmlElement|YXmlText} */
      /** @type {ContentType} */
      n.content.type
    ) : null;
  }
  /**
   * Integrate this type into the Yjs instance.
   *
   * * Save this struct in the os
   * * This type is sent to other client
   * * Observer functions are fired
   *
   * @param {Doc} y The Yjs instance
   * @param {Item} item
   */
  _integrate(y, item) {
    super._integrate(y, item), /** @type {Map<string, any>} */
    this._prelimAttrs.forEach((value, key) => {
      this.setAttribute(key, value);
    }), this._prelimAttrs = null;
  }
  /**
   * Creates an Item with the same effect as this Item (without position effect)
   *
   * @return {YXmlElement}
   */
  _copy() {
    return new _YXmlElement(this.nodeName);
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {YXmlElement<KV>}
   */
  clone() {
    let el = new _YXmlElement(this.nodeName), attrs = this.getAttributes();
    return forEach(attrs, (value, key) => {
      el.setAttribute(
        key,
        /** @type {any} */
        value
      );
    }), el.insert(0, this.toArray().map((v) => v instanceof AbstractType ? v.clone() : v)), el;
  }
  /**
   * Returns the XML serialization of this YXmlElement.
   * The attributes are ordered by attribute-name, so you can easily use this
   * method to compare YXmlElements
   *
   * @return {string} The string representation of this type.
   *
   * @public
   */
  toString() {
    let attrs = this.getAttributes(), stringBuilder = [], keys2 = [];
    for (let key in attrs)
      keys2.push(key);
    keys2.sort();
    let keysLen = keys2.length;
    for (let i = 0; i < keysLen; i++) {
      let key = keys2[i];
      stringBuilder.push(key + '="' + attrs[key] + '"');
    }
    let nodeName = this.nodeName.toLocaleLowerCase(), attrsString = stringBuilder.length > 0 ? " " + stringBuilder.join(" ") : "";
    return `<${nodeName}${attrsString}>${super.toString()}</${nodeName}>`;
  }
  /**
   * Removes an attribute from this YXmlElement.
   *
   * @param {string} attributeName The attribute name that is to be removed.
   *
   * @public
   */
  removeAttribute(attributeName) {
    this.doc !== null ? transact(this.doc, (transaction) => {
      typeMapDelete(transaction, this, attributeName);
    }) : this._prelimAttrs.delete(attributeName);
  }
  /**
   * Sets or updates an attribute.
   *
   * @template {keyof KV & string} KEY
   *
   * @param {KEY} attributeName The attribute name that is to be set.
   * @param {KV[KEY]} attributeValue The attribute value that is to be set.
   *
   * @public
   */
  setAttribute(attributeName, attributeValue) {
    this.doc !== null ? transact(this.doc, (transaction) => {
      typeMapSet(transaction, this, attributeName, attributeValue);
    }) : this._prelimAttrs.set(attributeName, attributeValue);
  }
  /**
   * Returns an attribute value that belongs to the attribute name.
   *
   * @template {keyof KV & string} KEY
   *
   * @param {KEY} attributeName The attribute name that identifies the
   *                               queried value.
   * @return {KV[KEY]|undefined} The queried attribute value.
   *
   * @public
   */
  getAttribute(attributeName) {
    return (
      /** @type {any} */
      typeMapGet(this, attributeName)
    );
  }
  /**
   * Returns whether an attribute exists
   *
   * @param {string} attributeName The attribute name to check for existence.
   * @return {boolean} whether the attribute exists.
   *
   * @public
   */
  hasAttribute(attributeName) {
    return (
      /** @type {any} */
      typeMapHas(this, attributeName)
    );
  }
  /**
   * Returns all attribute name/value pairs in a JSON Object.
   *
   * @param {Snapshot} [snapshot]
   * @return {{ [Key in Extract<keyof KV,string>]?: KV[Key]}} A JSON Object that describes the attributes.
   *
   * @public
   */
  getAttributes(snapshot2) {
    return (
      /** @type {any} */
      snapshot2 ? typeMapGetAllSnapshot(this, snapshot2) : typeMapGetAll(this)
    );
  }
  /**
   * Creates a Dom Element that mirrors this YXmlElement.
   *
   * @param {Document} [_document=document] The document object (you must define
   *                                        this when calling this method in
   *                                        nodejs)
   * @param {Object<string, any>} [hooks={}] Optional property to customize how hooks
   *                                             are presented in the DOM
   * @param {any} [binding] You should not set this property. This is
   *                               used if DomBinding wants to create a
   *                               association to the created DOM type.
   * @return {Node} The {@link https://developer.mozilla.org/en-US/docs/Web/API/Element|Dom Element}
   *
   * @public
   */
  toDOM(_document = document, hooks = {}, binding) {
    let dom = _document.createElement(this.nodeName), attrs = this.getAttributes();
    for (let key in attrs) {
      let value = attrs[key];
      typeof value == "string" && dom.setAttribute(key, value);
    }
    return typeListForEach(this, (yxml) => {
      dom.appendChild(yxml.toDOM(_document, hooks, binding));
    }), binding !== void 0 && binding._createAssociation(dom, this), dom;
  }
  /**
   * Transform the properties of this type to binary and write it to an
   * BinaryEncoder.
   *
   * This is called when this Item is sent to a remote peer.
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder The encoder to write data to.
   */
  _write(encoder) {
    encoder.writeTypeRef(YXmlElementRefID), encoder.writeKey(this.nodeName);
  }
}, readYXmlElement = (decoder) => new YXmlElement(decoder.readKey()), YXmlEvent = class extends YEvent {
  /**
   * @param {YXmlElement|YXmlText|YXmlFragment} target The target on which the event is created.
   * @param {Set<string|null>} subs The set of changed attributes. `null` is included if the
   *                   child list changed.
   * @param {Transaction} transaction The transaction instance with which the
   *                                  change was created.
   */
  constructor(target, subs, transaction) {
    super(target, transaction), this.childListChanged = !1, this.attributesChanged = /* @__PURE__ */ new Set(), subs.forEach((sub) => {
      sub === null ? this.childListChanged = !0 : this.attributesChanged.add(sub);
    });
  }
}, YXmlHook = class _YXmlHook extends YMap {
  /**
   * @param {string} hookName nodeName of the Dom Node.
   */
  constructor(hookName) {
    super(), this.hookName = hookName;
  }
  /**
   * Creates an Item with the same effect as this Item (without position effect)
   */
  _copy() {
    return new _YXmlHook(this.hookName);
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {YXmlHook}
   */
  clone() {
    let el = new _YXmlHook(this.hookName);
    return this.forEach((value, key) => {
      el.set(key, value);
    }), el;
  }
  /**
   * Creates a Dom Element that mirrors this YXmlElement.
   *
   * @param {Document} [_document=document] The document object (you must define
   *                                        this when calling this method in
   *                                        nodejs)
   * @param {Object.<string, any>} [hooks] Optional property to customize how hooks
   *                                             are presented in the DOM
   * @param {any} [binding] You should not set this property. This is
   *                               used if DomBinding wants to create a
   *                               association to the created DOM type
   * @return {Element} The {@link https://developer.mozilla.org/en-US/docs/Web/API/Element|Dom Element}
   *
   * @public
   */
  toDOM(_document = document, hooks = {}, binding) {
    let hook = hooks[this.hookName], dom;
    return hook !== void 0 ? dom = hook.createDom(this) : dom = document.createElement(this.hookName), dom.setAttribute("data-yjs-hook", this.hookName), binding !== void 0 && binding._createAssociation(dom, this), dom;
  }
  /**
   * Transform the properties of this type to binary and write it to an
   * BinaryEncoder.
   *
   * This is called when this Item is sent to a remote peer.
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder The encoder to write data to.
   */
  _write(encoder) {
    encoder.writeTypeRef(YXmlHookRefID), encoder.writeKey(this.hookName);
  }
}, readYXmlHook = (decoder) => new YXmlHook(decoder.readKey()), YXmlText = class _YXmlText extends YText {
  /**
   * @type {YXmlElement|YXmlText|null}
   */
  get nextSibling() {
    let n = this._item ? this._item.next : null;
    return n ? (
      /** @type {YXmlElement|YXmlText} */
      /** @type {ContentType} */
      n.content.type
    ) : null;
  }
  /**
   * @type {YXmlElement|YXmlText|null}
   */
  get prevSibling() {
    let n = this._item ? this._item.prev : null;
    return n ? (
      /** @type {YXmlElement|YXmlText} */
      /** @type {ContentType} */
      n.content.type
    ) : null;
  }
  _copy() {
    return new _YXmlText();
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {YXmlText}
   */
  clone() {
    let text2 = new _YXmlText();
    return text2.applyDelta(this.toDelta()), text2;
  }
  /**
   * Creates a Dom Element that mirrors this YXmlText.
   *
   * @param {Document} [_document=document] The document object (you must define
   *                                        this when calling this method in
   *                                        nodejs)
   * @param {Object<string, any>} [hooks] Optional property to customize how hooks
   *                                             are presented in the DOM
   * @param {any} [binding] You should not set this property. This is
   *                               used if DomBinding wants to create a
   *                               association to the created DOM type.
   * @return {Text} The {@link https://developer.mozilla.org/en-US/docs/Web/API/Element|Dom Element}
   *
   * @public
   */
  toDOM(_document = document, hooks, binding) {
    let dom = _document.createTextNode(this.toString());
    return binding !== void 0 && binding._createAssociation(dom, this), dom;
  }
  toString() {
    return this.toDelta().map((delta) => {
      let nestedNodes = [];
      for (let nodeName in delta.attributes) {
        let attrs = [];
        for (let key in delta.attributes[nodeName])
          attrs.push({ key, value: delta.attributes[nodeName][key] });
        attrs.sort((a, b) => a.key < b.key ? -1 : 1), nestedNodes.push({ nodeName, attrs });
      }
      nestedNodes.sort((a, b) => a.nodeName < b.nodeName ? -1 : 1);
      let str = "";
      for (let i = 0; i < nestedNodes.length; i++) {
        let node = nestedNodes[i];
        str += `<${node.nodeName}`;
        for (let j = 0; j < node.attrs.length; j++) {
          let attr = node.attrs[j];
          str += ` ${attr.key}="${attr.value}"`;
        }
        str += ">";
      }
      str += delta.insert;
      for (let i = nestedNodes.length - 1; i >= 0; i--)
        str += `</${nestedNodes[i].nodeName}>`;
      return str;
    }).join("");
  }
  /**
   * @return {string}
   */
  toJSON() {
    return this.toString();
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   */
  _write(encoder) {
    encoder.writeTypeRef(YXmlTextRefID);
  }
}, readYXmlText = (decoder) => new YXmlText(), AbstractStruct = class {
  /**
   * @param {ID} id
   * @param {number} length
   */
  constructor(id2, length2) {
    this.id = id2, this.length = length2;
  }
  /**
   * @type {boolean}
   */
  get deleted() {
    throw methodUnimplemented();
  }
  /**
   * Merge this struct with the item to the right.
   * This method is already assuming that `this.id.clock + this.length === this.id.clock`.
   * Also this method does *not* remove right from StructStore!
   * @param {AbstractStruct} right
   * @return {boolean} whether this merged with right
   */
  mergeWith(right) {
    return !1;
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder The encoder to write data to.
   * @param {number} offset
   * @param {number} encodingRef
   */
  write(encoder, offset, encodingRef) {
    throw methodUnimplemented();
  }
  /**
   * @param {Transaction} transaction
   * @param {number} offset
   */
  integrate(transaction, offset) {
    throw methodUnimplemented();
  }
}, structGCRefNumber = 0, GC = class extends AbstractStruct {
  get deleted() {
    return !0;
  }
  delete() {
  }
  /**
   * @param {GC} right
   * @return {boolean}
   */
  mergeWith(right) {
    return this.constructor !== right.constructor ? !1 : (this.length += right.length, !0);
  }
  /**
   * @param {Transaction} transaction
   * @param {number} offset
   */
  integrate(transaction, offset) {
    offset > 0 && (this.id.clock += offset, this.length -= offset), addStruct(transaction.doc.store, this);
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder, offset) {
    encoder.writeInfo(structGCRefNumber), encoder.writeLen(this.length - offset);
  }
  /**
   * @param {Transaction} transaction
   * @param {StructStore} store
   * @return {null | number}
   */
  getMissing(transaction, store) {
    return null;
  }
}, ContentBinary = class _ContentBinary {
  /**
   * @param {Uint8Array} content
   */
  constructor(content) {
    this.content = content;
  }
  /**
   * @return {number}
   */
  getLength() {
    return 1;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return [this.content];
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return !0;
  }
  /**
   * @return {ContentBinary}
   */
  copy() {
    return new _ContentBinary(this.content);
  }
  /**
   * @param {number} offset
   * @return {ContentBinary}
   */
  splice(offset) {
    throw methodUnimplemented();
  }
  /**
   * @param {ContentBinary} right
   * @return {boolean}
   */
  mergeWith(right) {
    return !1;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder, offset) {
    encoder.writeBuf(this.content);
  }
  /**
   * @return {number}
   */
  getRef() {
    return 3;
  }
}, readContentBinary = (decoder) => new ContentBinary(decoder.readBuf()), ContentDeleted = class _ContentDeleted {
  /**
   * @param {number} len
   */
  constructor(len) {
    this.len = len;
  }
  /**
   * @return {number}
   */
  getLength() {
    return this.len;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return [];
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return !1;
  }
  /**
   * @return {ContentDeleted}
   */
  copy() {
    return new _ContentDeleted(this.len);
  }
  /**
   * @param {number} offset
   * @return {ContentDeleted}
   */
  splice(offset) {
    let right = new _ContentDeleted(this.len - offset);
    return this.len = offset, right;
  }
  /**
   * @param {ContentDeleted} right
   * @return {boolean}
   */
  mergeWith(right) {
    return this.len += right.len, !0;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
    addToDeleteSet(transaction.deleteSet, item.id.client, item.id.clock, this.len), item.markDeleted();
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder, offset) {
    encoder.writeLen(this.len - offset);
  }
  /**
   * @return {number}
   */
  getRef() {
    return 1;
  }
}, readContentDeleted = (decoder) => new ContentDeleted(decoder.readLen()), createDocFromOpts = (guid, opts) => new Doc({ guid, ...opts, shouldLoad: opts.shouldLoad || opts.autoLoad || !1 }), ContentDoc = class _ContentDoc {
  /**
   * @param {Doc} doc
   */
  constructor(doc2) {
    doc2._item && console.error("This document was already integrated as a sub-document. You should create a second instance instead with the same guid."), this.doc = doc2;
    let opts = {};
    this.opts = opts, doc2.gc || (opts.gc = !1), doc2.autoLoad && (opts.autoLoad = !0), doc2.meta !== null && (opts.meta = doc2.meta);
  }
  /**
   * @return {number}
   */
  getLength() {
    return 1;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return [this.doc];
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return !0;
  }
  /**
   * @return {ContentDoc}
   */
  copy() {
    return new _ContentDoc(createDocFromOpts(this.doc.guid, this.opts));
  }
  /**
   * @param {number} offset
   * @return {ContentDoc}
   */
  splice(offset) {
    throw methodUnimplemented();
  }
  /**
   * @param {ContentDoc} right
   * @return {boolean}
   */
  mergeWith(right) {
    return !1;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
    this.doc._item = item, transaction.subdocsAdded.add(this.doc), this.doc.shouldLoad && transaction.subdocsLoaded.add(this.doc);
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
    transaction.subdocsAdded.has(this.doc) ? transaction.subdocsAdded.delete(this.doc) : transaction.subdocsRemoved.add(this.doc);
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder, offset) {
    encoder.writeString(this.doc.guid), encoder.writeAny(this.opts);
  }
  /**
   * @return {number}
   */
  getRef() {
    return 9;
  }
}, readContentDoc = (decoder) => new ContentDoc(createDocFromOpts(decoder.readString(), decoder.readAny())), ContentEmbed = class _ContentEmbed {
  /**
   * @param {Object} embed
   */
  constructor(embed) {
    this.embed = embed;
  }
  /**
   * @return {number}
   */
  getLength() {
    return 1;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return [this.embed];
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return !0;
  }
  /**
   * @return {ContentEmbed}
   */
  copy() {
    return new _ContentEmbed(this.embed);
  }
  /**
   * @param {number} offset
   * @return {ContentEmbed}
   */
  splice(offset) {
    throw methodUnimplemented();
  }
  /**
   * @param {ContentEmbed} right
   * @return {boolean}
   */
  mergeWith(right) {
    return !1;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder, offset) {
    encoder.writeJSON(this.embed);
  }
  /**
   * @return {number}
   */
  getRef() {
    return 5;
  }
}, readContentEmbed = (decoder) => new ContentEmbed(decoder.readJSON()), ContentFormat = class _ContentFormat {
  /**
   * @param {string} key
   * @param {Object} value
   */
  constructor(key, value) {
    this.key = key, this.value = value;
  }
  /**
   * @return {number}
   */
  getLength() {
    return 1;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return [];
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return !1;
  }
  /**
   * @return {ContentFormat}
   */
  copy() {
    return new _ContentFormat(this.key, this.value);
  }
  /**
   * @param {number} _offset
   * @return {ContentFormat}
   */
  splice(_offset) {
    throw methodUnimplemented();
  }
  /**
   * @param {ContentFormat} _right
   * @return {boolean}
   */
  mergeWith(_right) {
    return !1;
  }
  /**
   * @param {Transaction} _transaction
   * @param {Item} item
   */
  integrate(_transaction, item) {
    let p = (
      /** @type {YText} */
      item.parent
    );
    p._searchMarker = null, p._hasFormatting = !0;
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder, offset) {
    encoder.writeKey(this.key), encoder.writeJSON(this.value);
  }
  /**
   * @return {number}
   */
  getRef() {
    return 6;
  }
}, readContentFormat = (decoder) => new ContentFormat(decoder.readKey(), decoder.readJSON()), ContentJSON = class _ContentJSON {
  /**
   * @param {Array<any>} arr
   */
  constructor(arr) {
    this.arr = arr;
  }
  /**
   * @return {number}
   */
  getLength() {
    return this.arr.length;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return this.arr;
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return !0;
  }
  /**
   * @return {ContentJSON}
   */
  copy() {
    return new _ContentJSON(this.arr);
  }
  /**
   * @param {number} offset
   * @return {ContentJSON}
   */
  splice(offset) {
    let right = new _ContentJSON(this.arr.slice(offset));
    return this.arr = this.arr.slice(0, offset), right;
  }
  /**
   * @param {ContentJSON} right
   * @return {boolean}
   */
  mergeWith(right) {
    return this.arr = this.arr.concat(right.arr), !0;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder, offset) {
    let len = this.arr.length;
    encoder.writeLen(len - offset);
    for (let i = offset; i < len; i++) {
      let c = this.arr[i];
      encoder.writeString(c === void 0 ? "undefined" : JSON.stringify(c));
    }
  }
  /**
   * @return {number}
   */
  getRef() {
    return 2;
  }
}, readContentJSON = (decoder) => {
  let len = decoder.readLen(), cs = [];
  for (let i = 0; i < len; i++) {
    let c = decoder.readString();
    c === "undefined" ? cs.push(void 0) : cs.push(JSON.parse(c));
  }
  return new ContentJSON(cs);
}, isDevMode = getVariable("node_env") === "development", ContentAny = class _ContentAny {
  /**
   * @param {Array<any>} arr
   */
  constructor(arr) {
    this.arr = arr, isDevMode && deepFreeze(arr);
  }
  /**
   * @return {number}
   */
  getLength() {
    return this.arr.length;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return this.arr;
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return !0;
  }
  /**
   * @return {ContentAny}
   */
  copy() {
    return new _ContentAny(this.arr);
  }
  /**
   * @param {number} offset
   * @return {ContentAny}
   */
  splice(offset) {
    let right = new _ContentAny(this.arr.slice(offset));
    return this.arr = this.arr.slice(0, offset), right;
  }
  /**
   * @param {ContentAny} right
   * @return {boolean}
   */
  mergeWith(right) {
    return this.arr = this.arr.concat(right.arr), !0;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder, offset) {
    let len = this.arr.length;
    encoder.writeLen(len - offset);
    for (let i = offset; i < len; i++) {
      let c = this.arr[i];
      encoder.writeAny(c);
    }
  }
  /**
   * @return {number}
   */
  getRef() {
    return 8;
  }
}, readContentAny = (decoder) => {
  let len = decoder.readLen(), cs = [];
  for (let i = 0; i < len; i++)
    cs.push(decoder.readAny());
  return new ContentAny(cs);
}, ContentString = class _ContentString {
  /**
   * @param {string} str
   */
  constructor(str) {
    this.str = str;
  }
  /**
   * @return {number}
   */
  getLength() {
    return this.str.length;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return this.str.split("");
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return !0;
  }
  /**
   * @return {ContentString}
   */
  copy() {
    return new _ContentString(this.str);
  }
  /**
   * @param {number} offset
   * @return {ContentString}
   */
  splice(offset) {
    let right = new _ContentString(this.str.slice(offset));
    this.str = this.str.slice(0, offset);
    let firstCharCode = this.str.charCodeAt(offset - 1);
    return firstCharCode >= 55296 && firstCharCode <= 56319 && (this.str = this.str.slice(0, offset - 1) + "\uFFFD", right.str = "\uFFFD" + right.str.slice(1)), right;
  }
  /**
   * @param {ContentString} right
   * @return {boolean}
   */
  mergeWith(right) {
    return this.str += right.str, !0;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder, offset) {
    encoder.writeString(offset === 0 ? this.str : this.str.slice(offset));
  }
  /**
   * @return {number}
   */
  getRef() {
    return 4;
  }
}, readContentString = (decoder) => new ContentString(decoder.readString()), typeRefs = [
  readYArray,
  readYMap,
  readYText,
  readYXmlElement,
  readYXmlFragment,
  readYXmlHook,
  readYXmlText
], YArrayRefID = 0, YMapRefID = 1, YTextRefID = 2, YXmlElementRefID = 3, YXmlFragmentRefID = 4, YXmlHookRefID = 5, YXmlTextRefID = 6, ContentType = class _ContentType {
  /**
   * @param {AbstractType<any>} type
   */
  constructor(type) {
    this.type = type;
  }
  /**
   * @return {number}
   */
  getLength() {
    return 1;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return [this.type];
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return !0;
  }
  /**
   * @return {ContentType}
   */
  copy() {
    return new _ContentType(this.type._copy());
  }
  /**
   * @param {number} offset
   * @return {ContentType}
   */
  splice(offset) {
    throw methodUnimplemented();
  }
  /**
   * @param {ContentType} right
   * @return {boolean}
   */
  mergeWith(right) {
    return !1;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
    this.type._integrate(transaction.doc, item);
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
    let item = this.type._start;
    for (; item !== null; )
      item.deleted ? item.id.clock < (transaction.beforeState.get(item.id.client) || 0) && transaction._mergeStructs.push(item) : item.delete(transaction), item = item.right;
    this.type._map.forEach((item2) => {
      item2.deleted ? item2.id.clock < (transaction.beforeState.get(item2.id.client) || 0) && transaction._mergeStructs.push(item2) : item2.delete(transaction);
    }), transaction.changed.delete(this.type);
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
    let item = this.type._start;
    for (; item !== null; )
      item.gc(store, !0), item = item.right;
    this.type._start = null, this.type._map.forEach(
      /** @param {Item | null} item */
      (item2) => {
        for (; item2 !== null; )
          item2.gc(store, !0), item2 = item2.left;
      }
    ), this.type._map = /* @__PURE__ */ new Map();
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder, offset) {
    this.type._write(encoder);
  }
  /**
   * @return {number}
   */
  getRef() {
    return 7;
  }
}, readContentType = (decoder) => new ContentType(typeRefs[decoder.readTypeRef()](decoder)), followRedone = (store, id2) => {
  let nextID = id2, diff = 0, item;
  do
    diff > 0 && (nextID = createID(nextID.client, nextID.clock + diff)), item = getItem(store, nextID), diff = nextID.clock - item.id.clock, nextID = item.redone;
  while (nextID !== null && item instanceof Item);
  return {
    item,
    diff
  };
}, keepItem = (item, keep) => {
  for (; item !== null && item.keep !== keep; )
    item.keep = keep, item = /** @type {AbstractType<any>} */
    item.parent._item;
}, splitItem = (transaction, leftItem, diff) => {
  let { client, clock } = leftItem.id, rightItem = new Item(
    createID(client, clock + diff),
    leftItem,
    createID(client, clock + diff - 1),
    leftItem.right,
    leftItem.rightOrigin,
    leftItem.parent,
    leftItem.parentSub,
    leftItem.content.splice(diff)
  );
  return leftItem.deleted && rightItem.markDeleted(), leftItem.keep && (rightItem.keep = !0), leftItem.redone !== null && (rightItem.redone = createID(leftItem.redone.client, leftItem.redone.clock + diff)), leftItem.right = rightItem, rightItem.right !== null && (rightItem.right.left = rightItem), transaction._mergeStructs.push(rightItem), rightItem.parentSub !== null && rightItem.right === null && rightItem.parent._map.set(rightItem.parentSub, rightItem), leftItem.length = diff, rightItem;
}, isDeletedByUndoStack = (stack, id2) => some(
  stack,
  /** @param {StackItem} s */
  (s) => isDeleted(s.deletions, id2)
), redoItem = (transaction, item, redoitems, itemsToDelete, ignoreRemoteMapChanges, um) => {
  let doc2 = transaction.doc, store = doc2.store, ownClientID = doc2.clientID, redone = item.redone;
  if (redone !== null)
    return getItemCleanStart(transaction, redone);
  let parentItem = (
    /** @type {AbstractType<any>} */
    item.parent._item
  ), left = null, right;
  if (parentItem !== null && parentItem.deleted === !0) {
    if (parentItem.redone === null && (!redoitems.has(parentItem) || redoItem(transaction, parentItem, redoitems, itemsToDelete, ignoreRemoteMapChanges, um) === null))
      return null;
    for (; parentItem.redone !== null; )
      parentItem = getItemCleanStart(transaction, parentItem.redone);
  }
  let parentType = parentItem === null ? (
    /** @type {AbstractType<any>} */
    item.parent
  ) : (
    /** @type {ContentType} */
    parentItem.content.type
  );
  if (item.parentSub === null) {
    for (left = item.left, right = item; left !== null; ) {
      let leftTrace = left;
      for (; leftTrace !== null && /** @type {AbstractType<any>} */
      leftTrace.parent._item !== parentItem; )
        leftTrace = leftTrace.redone === null ? null : getItemCleanStart(transaction, leftTrace.redone);
      if (leftTrace !== null && /** @type {AbstractType<any>} */
      leftTrace.parent._item === parentItem) {
        left = leftTrace;
        break;
      }
      left = left.left;
    }
    for (; right !== null; ) {
      let rightTrace = right;
      for (; rightTrace !== null && /** @type {AbstractType<any>} */
      rightTrace.parent._item !== parentItem; )
        rightTrace = rightTrace.redone === null ? null : getItemCleanStart(transaction, rightTrace.redone);
      if (rightTrace !== null && /** @type {AbstractType<any>} */
      rightTrace.parent._item === parentItem) {
        right = rightTrace;
        break;
      }
      right = right.right;
    }
  } else {
    if (right = null, item.right && !ignoreRemoteMapChanges) {
      for (left = item; left !== null && left.right !== null && (left.right.redone || isDeleted(itemsToDelete, left.right.id) || isDeletedByUndoStack(um.undoStack, left.right.id) || isDeletedByUndoStack(um.redoStack, left.right.id)); )
        for (left = left.right; left.redone; ) left = getItemCleanStart(transaction, left.redone);
      if (left && left.right !== null)
        return null;
    } else
      left = parentType._map.get(item.parentSub) || null;
    left !== null && /** @type {AbstractType<any>} */
    left.parent._item !== parentItem && (left = parentType._map.get(item.parentSub) || null);
  }
  let nextClock = getState(store, ownClientID), nextId = createID(ownClientID, nextClock), redoneItem = new Item(
    nextId,
    left,
    left && left.lastId,
    right,
    right && right.id,
    parentType,
    item.parentSub,
    item.content.copy()
  );
  return item.redone = nextId, keepItem(redoneItem, !0), redoneItem.integrate(transaction, 0), redoneItem;
}, Item = class _Item extends AbstractStruct {
  /**
   * @param {ID} id
   * @param {Item | null} left
   * @param {ID | null} origin
   * @param {Item | null} right
   * @param {ID | null} rightOrigin
   * @param {AbstractType<any>|ID|null} parent Is a type if integrated, is null if it is possible to copy parent from left or right, is ID before integration to search for it.
   * @param {string | null} parentSub
   * @param {AbstractContent} content
   */
  constructor(id2, left, origin, right, rightOrigin, parent, parentSub, content) {
    super(id2, content.getLength()), this.origin = origin, this.left = left, this.right = right, this.rightOrigin = rightOrigin, this.parent = parent, this.parentSub = parentSub, this.redone = null, this.content = content, this.info = this.content.isCountable() ? 2 : 0;
  }
  /**
   * This is used to mark the item as an indexed fast-search marker
   *
   * @type {boolean}
   */
  set marker(isMarked) {
    (this.info & 8) > 0 !== isMarked && (this.info ^= 8);
  }
  get marker() {
    return (this.info & 8) > 0;
  }
  /**
   * If true, do not garbage collect this Item.
   */
  get keep() {
    return (this.info & 1) > 0;
  }
  set keep(doKeep) {
    this.keep !== doKeep && (this.info ^= 1);
  }
  get countable() {
    return (this.info & 2) > 0;
  }
  /**
   * Whether this item was deleted or not.
   * @type {Boolean}
   */
  get deleted() {
    return (this.info & 4) > 0;
  }
  set deleted(doDelete) {
    this.deleted !== doDelete && (this.info ^= 4);
  }
  markDeleted() {
    this.info |= 4;
  }
  /**
   * Return the creator clientID of the missing op or define missing items and return null.
   *
   * @param {Transaction} transaction
   * @param {StructStore} store
   * @return {null | number}
   */
  getMissing(transaction, store) {
    if (this.origin && this.origin.client !== this.id.client && this.origin.clock >= getState(store, this.origin.client))
      return this.origin.client;
    if (this.rightOrigin && this.rightOrigin.client !== this.id.client && this.rightOrigin.clock >= getState(store, this.rightOrigin.client))
      return this.rightOrigin.client;
    if (this.parent && this.parent.constructor === ID && this.id.client !== this.parent.client && this.parent.clock >= getState(store, this.parent.client))
      return this.parent.client;
    if (this.origin && (this.left = getItemCleanEnd(transaction, store, this.origin), this.origin = this.left.lastId), this.rightOrigin && (this.right = getItemCleanStart(transaction, this.rightOrigin), this.rightOrigin = this.right.id), this.left && this.left.constructor === GC || this.right && this.right.constructor === GC)
      this.parent = null;
    else if (!this.parent)
      this.left && this.left.constructor === _Item ? (this.parent = this.left.parent, this.parentSub = this.left.parentSub) : this.right && this.right.constructor === _Item && (this.parent = this.right.parent, this.parentSub = this.right.parentSub);
    else if (this.parent.constructor === ID) {
      let parentItem = getItem(store, this.parent);
      parentItem.constructor === GC ? this.parent = null : this.parent = /** @type {ContentType} */
      parentItem.content.type;
    }
    return null;
  }
  /**
   * @param {Transaction} transaction
   * @param {number} offset
   */
  integrate(transaction, offset) {
    if (offset > 0 && (this.id.clock += offset, this.left = getItemCleanEnd(transaction, transaction.doc.store, createID(this.id.client, this.id.clock - 1)), this.origin = this.left.lastId, this.content = this.content.splice(offset), this.length -= offset), this.parent) {
      if (!this.left && (!this.right || this.right.left !== null) || this.left && this.left.right !== this.right) {
        let left = this.left, o;
        if (left !== null)
          o = left.right;
        else if (this.parentSub !== null)
          for (o = /** @type {AbstractType<any>} */
          this.parent._map.get(this.parentSub) || null; o !== null && o.left !== null; )
            o = o.left;
        else
          o = /** @type {AbstractType<any>} */
          this.parent._start;
        let conflictingItems = /* @__PURE__ */ new Set(), itemsBeforeOrigin = /* @__PURE__ */ new Set();
        for (; o !== null && o !== this.right; ) {
          if (itemsBeforeOrigin.add(o), conflictingItems.add(o), compareIDs(this.origin, o.origin)) {
            if (o.id.client < this.id.client)
              left = o, conflictingItems.clear();
            else if (compareIDs(this.rightOrigin, o.rightOrigin))
              break;
          } else if (o.origin !== null && itemsBeforeOrigin.has(getItem(transaction.doc.store, o.origin)))
            conflictingItems.has(getItem(transaction.doc.store, o.origin)) || (left = o, conflictingItems.clear());
          else
            break;
          o = o.right;
        }
        this.left = left;
      }
      if (this.left !== null) {
        let right = this.left.right;
        this.right = right, this.left.right = this;
      } else {
        let r;
        if (this.parentSub !== null)
          for (r = /** @type {AbstractType<any>} */
          this.parent._map.get(this.parentSub) || null; r !== null && r.left !== null; )
            r = r.left;
        else
          r = /** @type {AbstractType<any>} */
          this.parent._start, this.parent._start = this;
        this.right = r;
      }
      this.right !== null ? this.right.left = this : this.parentSub !== null && (this.parent._map.set(this.parentSub, this), this.left !== null && this.left.delete(transaction)), this.parentSub === null && this.countable && !this.deleted && (this.parent._length += this.length), addStruct(transaction.doc.store, this), this.content.integrate(transaction, this), addChangedTypeToTransaction(
        transaction,
        /** @type {AbstractType<any>} */
        this.parent,
        this.parentSub
      ), /** @type {AbstractType<any>} */
      (this.parent._item !== null && /** @type {AbstractType<any>} */
      this.parent._item.deleted || this.parentSub !== null && this.right !== null) && this.delete(transaction);
    } else
      new GC(this.id, this.length).integrate(transaction, 0);
  }
  /**
   * Returns the next non-deleted item
   */
  get next() {
    let n = this.right;
    for (; n !== null && n.deleted; )
      n = n.right;
    return n;
  }
  /**
   * Returns the previous non-deleted item
   */
  get prev() {
    let n = this.left;
    for (; n !== null && n.deleted; )
      n = n.left;
    return n;
  }
  /**
   * Computes the last content address of this Item.
   */
  get lastId() {
    return this.length === 1 ? this.id : createID(this.id.client, this.id.clock + this.length - 1);
  }
  /**
   * Try to merge two items
   *
   * @param {Item} right
   * @return {boolean}
   */
  mergeWith(right) {
    if (this.constructor === right.constructor && compareIDs(right.origin, this.lastId) && this.right === right && compareIDs(this.rightOrigin, right.rightOrigin) && this.id.client === right.id.client && this.id.clock + this.length === right.id.clock && this.deleted === right.deleted && this.redone === null && right.redone === null && this.content.constructor === right.content.constructor && this.content.mergeWith(right.content)) {
      let searchMarker = (
        /** @type {AbstractType<any>} */
        this.parent._searchMarker
      );
      return searchMarker && searchMarker.forEach((marker) => {
        marker.p === right && (marker.p = this, !this.deleted && this.countable && (marker.index -= this.length));
      }), right.keep && (this.keep = !0), this.right = right.right, this.right !== null && (this.right.left = this), this.length += right.length, !0;
    }
    return !1;
  }
  /**
   * Mark this Item as deleted.
   *
   * @param {Transaction} transaction
   */
  delete(transaction) {
    if (!this.deleted) {
      let parent = (
        /** @type {AbstractType<any>} */
        this.parent
      );
      this.countable && this.parentSub === null && (parent._length -= this.length), this.markDeleted(), addToDeleteSet(transaction.deleteSet, this.id.client, this.id.clock, this.length), addChangedTypeToTransaction(transaction, parent, this.parentSub), this.content.delete(transaction);
    }
  }
  /**
   * @param {StructStore} store
   * @param {boolean} parentGCd
   */
  gc(store, parentGCd) {
    if (!this.deleted)
      throw unexpectedCase();
    this.content.gc(store), parentGCd ? replaceStruct(store, this, new GC(this.id, this.length)) : this.content = new ContentDeleted(this.length);
  }
  /**
   * Transform the properties of this type to binary and write it to an
   * BinaryEncoder.
   *
   * This is called when this Item is sent to a remote peer.
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder The encoder to write data to.
   * @param {number} offset
   */
  write(encoder, offset) {
    let origin = offset > 0 ? createID(this.id.client, this.id.clock + offset - 1) : this.origin, rightOrigin = this.rightOrigin, parentSub = this.parentSub, info = this.content.getRef() & 31 | (origin === null ? 0 : 128) | // origin is defined
    (rightOrigin === null ? 0 : 64) | // right origin is defined
    (parentSub === null ? 0 : 32);
    if (encoder.writeInfo(info), origin !== null && encoder.writeLeftID(origin), rightOrigin !== null && encoder.writeRightID(rightOrigin), origin === null && rightOrigin === null) {
      let parent = (
        /** @type {AbstractType<any>} */
        this.parent
      );
      if (parent._item !== void 0) {
        let parentItem = parent._item;
        if (parentItem === null) {
          let ykey = findRootTypeKey(parent);
          encoder.writeParentInfo(!0), encoder.writeString(ykey);
        } else
          encoder.writeParentInfo(!1), encoder.writeLeftID(parentItem.id);
      } else parent.constructor === String ? (encoder.writeParentInfo(!0), encoder.writeString(parent)) : parent.constructor === ID ? (encoder.writeParentInfo(!1), encoder.writeLeftID(parent)) : unexpectedCase();
      parentSub !== null && encoder.writeString(parentSub);
    }
    this.content.write(encoder, offset);
  }
}, readItemContent = (decoder, info) => contentRefs[info & 31](decoder), contentRefs = [
  () => {
    unexpectedCase();
  },
  // GC is not ItemContent
  readContentDeleted,
  // 1
  readContentJSON,
  // 2
  readContentBinary,
  // 3
  readContentString,
  // 4
  readContentEmbed,
  // 5
  readContentFormat,
  // 6
  readContentType,
  // 7
  readContentAny,
  // 8
  readContentDoc,
  // 9
  () => {
    unexpectedCase();
  }
  // 10 - Skip is not ItemContent
], structSkipRefNumber = 10, Skip = class extends AbstractStruct {
  get deleted() {
    return !0;
  }
  delete() {
  }
  /**
   * @param {Skip} right
   * @return {boolean}
   */
  mergeWith(right) {
    return this.constructor !== right.constructor ? !1 : (this.length += right.length, !0);
  }
  /**
   * @param {Transaction} transaction
   * @param {number} offset
   */
  integrate(transaction, offset) {
    unexpectedCase();
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder, offset) {
    encoder.writeInfo(structSkipRefNumber), writeVarUint(encoder.restEncoder, this.length - offset);
  }
  /**
   * @param {Transaction} transaction
   * @param {StructStore} store
   * @return {null | number}
   */
  getMissing(transaction, store) {
    return null;
  }
}, glo = (
  /** @type {any} */
  typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : {}
), importIdentifier = "__ $YJS$ __";
glo[importIdentifier] === !0 && console.error("Yjs was already imported. This breaks constructor checks and will lead to issues! - https://github.com/yjs/yjs/issues/438");
glo[importIdentifier] = !0;
export {
  AbsolutePosition,
  AbstractConnector,
  AbstractStruct,
  AbstractType,
  YArray as Array,
  ContentAny,
  ContentBinary,
  ContentDeleted,
  ContentDoc,
  ContentEmbed,
  ContentFormat,
  ContentJSON,
  ContentString,
  ContentType,
  Doc,
  GC,
  ID,
  Item,
  YMap as Map,
  PermanentUserData,
  RelativePosition,
  Skip,
  Snapshot,
  YText as Text,
  Transaction,
  UndoManager,
  UpdateDecoderV1,
  UpdateDecoderV2,
  UpdateEncoderV1,
  UpdateEncoderV2,
  YXmlElement as XmlElement,
  YXmlFragment as XmlFragment,
  YXmlHook as XmlHook,
  YXmlText as XmlText,
  YArrayEvent,
  YEvent,
  YMapEvent,
  YTextEvent,
  YXmlEvent,
  applyUpdate,
  applyUpdateV2,
  cleanupYTextFormatting,
  compareIDs,
  compareRelativePositions,
  convertUpdateFormatV1ToV2,
  convertUpdateFormatV2ToV1,
  createAbsolutePositionFromRelativePosition,
  createDeleteSet,
  createDeleteSetFromStructStore,
  createDocFromSnapshot,
  createID,
  createRelativePositionFromJSON,
  createRelativePositionFromTypeIndex,
  createSnapshot,
  decodeRelativePosition,
  decodeSnapshot,
  decodeSnapshotV2,
  decodeStateVector,
  decodeUpdate,
  decodeUpdateV2,
  diffUpdate,
  diffUpdateV2,
  emptySnapshot,
  encodeRelativePosition,
  encodeSnapshot,
  encodeSnapshotV2,
  encodeStateAsUpdate,
  encodeStateAsUpdateV2,
  encodeStateVector,
  encodeStateVectorFromUpdate,
  encodeStateVectorFromUpdateV2,
  equalDeleteSets,
  equalSnapshots,
  findIndexSS,
  findRootTypeKey,
  getItem,
  getItemCleanEnd,
  getItemCleanStart,
  getState,
  getTypeChildren,
  isDeleted,
  isParentOf,
  iterateDeletedStructs,
  logType,
  logUpdate,
  logUpdateV2,
  mergeDeleteSets,
  mergeUpdates,
  mergeUpdatesV2,
  obfuscateUpdate,
  obfuscateUpdateV2,
  parseUpdateMeta,
  parseUpdateMetaV2,
  readUpdate,
  readUpdateV2,
  relativePositionToJSON,
  snapshot,
  snapshotContainsUpdate,
  transact,
  tryGc,
  typeListToArraySnapshot,
  typeMapGetAllSnapshot,
  typeMapGetSnapshot
};
