var CANNON = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: !0 });
  }, __copyProps = (to, from, except, desc) => {
    if (from && typeof from == "object" || typeof from == "function")
      for (let key of __getOwnPropNames(from))
        !__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: !0 }), mod);

  // node_modules/cannon-es/dist/cannon-es.js
  var cannon_es_exports = {};
  __export(cannon_es_exports, {
    AABB: () => AABB,
    ArrayCollisionMatrix: () => ArrayCollisionMatrix,
    BODY_SLEEP_STATES: () => BODY_SLEEP_STATES,
    BODY_TYPES: () => BODY_TYPES,
    Body: () => Body,
    Box: () => Box,
    Broadphase: () => Broadphase,
    COLLISION_TYPES: () => COLLISION_TYPES,
    ConeTwistConstraint: () => ConeTwistConstraint,
    Constraint: () => Constraint,
    ContactEquation: () => ContactEquation,
    ContactMaterial: () => ContactMaterial,
    ConvexPolyhedron: () => ConvexPolyhedron,
    Cylinder: () => Cylinder,
    DistanceConstraint: () => DistanceConstraint,
    Equation: () => Equation,
    EventTarget: () => EventTarget,
    FrictionEquation: () => FrictionEquation,
    GSSolver: () => GSSolver,
    GridBroadphase: () => GridBroadphase,
    Heightfield: () => Heightfield,
    HingeConstraint: () => HingeConstraint,
    JacobianElement: () => JacobianElement,
    LockConstraint: () => LockConstraint,
    Mat3: () => Mat3,
    Material: () => Material,
    NaiveBroadphase: () => NaiveBroadphase,
    Narrowphase: () => Narrowphase,
    ObjectCollisionMatrix: () => ObjectCollisionMatrix,
    Particle: () => Particle,
    Plane: () => Plane,
    PointToPointConstraint: () => PointToPointConstraint,
    Pool: () => Pool,
    Quaternion: () => Quaternion,
    RAY_MODES: () => RAY_MODES,
    Ray: () => Ray,
    RaycastResult: () => RaycastResult,
    RaycastVehicle: () => RaycastVehicle,
    RigidVehicle: () => RigidVehicle,
    RotationalEquation: () => RotationalEquation,
    RotationalMotorEquation: () => RotationalMotorEquation,
    SAPBroadphase: () => SAPBroadphase,
    SHAPE_TYPES: () => SHAPE_TYPES,
    SPHSystem: () => SPHSystem,
    Shape: () => Shape,
    Solver: () => Solver,
    Sphere: () => Sphere,
    SplitSolver: () => SplitSolver,
    Spring: () => Spring,
    Transform: () => Transform,
    Trimesh: () => Trimesh,
    Vec3: () => Vec3,
    Vec3Pool: () => Vec3Pool,
    WheelInfo: () => WheelInfo,
    World: () => World
  });
  var ObjectCollisionMatrix = class {
    /**
     * The matrix storage.
     */
    /**
     * @todo Remove useless constructor
     */
    constructor() {
      this.matrix = {};
    }
    /**
     * get
     */
    get(bi, bj) {
      let {
        id: i
      } = bi, {
        id: j
      } = bj;
      if (j > i) {
        let temp = j;
        j = i, i = temp;
      }
      return `${i}-${j}` in this.matrix;
    }
    /**
     * set
     */
    set(bi, bj, value) {
      let {
        id: i
      } = bi, {
        id: j
      } = bj;
      if (j > i) {
        let temp = j;
        j = i, i = temp;
      }
      value ? this.matrix[`${i}-${j}`] = !0 : delete this.matrix[`${i}-${j}`];
    }
    /**
     * Empty the matrix
     */
    reset() {
      this.matrix = {};
    }
    /**
     * Set max number of objects
     */
    setNumObjects(n) {
    }
  }, Mat3 = class _Mat3 {
    /**
     * A vector of length 9, containing all matrix elements.
     */
    /**
     * @param elements A vector of length 9, containing all matrix elements.
     */
    constructor(elements) {
      elements === void 0 && (elements = [0, 0, 0, 0, 0, 0, 0, 0, 0]), this.elements = elements;
    }
    /**
     * Sets the matrix to identity
     * @todo Should perhaps be renamed to `setIdentity()` to be more clear.
     * @todo Create another function that immediately creates an identity matrix eg. `eye()`
     */
    identity() {
      let e = this.elements;
      e[0] = 1, e[1] = 0, e[2] = 0, e[3] = 0, e[4] = 1, e[5] = 0, e[6] = 0, e[7] = 0, e[8] = 1;
    }
    /**
     * Set all elements to zero
     */
    setZero() {
      let e = this.elements;
      e[0] = 0, e[1] = 0, e[2] = 0, e[3] = 0, e[4] = 0, e[5] = 0, e[6] = 0, e[7] = 0, e[8] = 0;
    }
    /**
     * Sets the matrix diagonal elements from a Vec3
     */
    setTrace(vector) {
      let e = this.elements;
      e[0] = vector.x, e[4] = vector.y, e[8] = vector.z;
    }
    /**
     * Gets the matrix diagonal elements
     */
    getTrace(target) {
      target === void 0 && (target = new Vec3());
      let e = this.elements;
      return target.x = e[0], target.y = e[4], target.z = e[8], target;
    }
    /**
     * Matrix-Vector multiplication
     * @param v The vector to multiply with
     * @param target Optional, target to save the result in.
     */
    vmult(v, target) {
      target === void 0 && (target = new Vec3());
      let e = this.elements, x = v.x, y = v.y, z = v.z;
      return target.x = e[0] * x + e[1] * y + e[2] * z, target.y = e[3] * x + e[4] * y + e[5] * z, target.z = e[6] * x + e[7] * y + e[8] * z, target;
    }
    /**
     * Matrix-scalar multiplication
     */
    smult(s) {
      for (let i = 0; i < this.elements.length; i++)
        this.elements[i] *= s;
    }
    /**
     * Matrix multiplication
     * @param matrix Matrix to multiply with from left side.
     */
    mmult(matrix, target) {
      target === void 0 && (target = new _Mat3());
      let A = this.elements, B = matrix.elements, T = target.elements, a11 = A[0], a12 = A[1], a13 = A[2], a21 = A[3], a22 = A[4], a23 = A[5], a31 = A[6], a32 = A[7], a33 = A[8], b11 = B[0], b12 = B[1], b13 = B[2], b21 = B[3], b22 = B[4], b23 = B[5], b31 = B[6], b32 = B[7], b33 = B[8];
      return T[0] = a11 * b11 + a12 * b21 + a13 * b31, T[1] = a11 * b12 + a12 * b22 + a13 * b32, T[2] = a11 * b13 + a12 * b23 + a13 * b33, T[3] = a21 * b11 + a22 * b21 + a23 * b31, T[4] = a21 * b12 + a22 * b22 + a23 * b32, T[5] = a21 * b13 + a22 * b23 + a23 * b33, T[6] = a31 * b11 + a32 * b21 + a33 * b31, T[7] = a31 * b12 + a32 * b22 + a33 * b32, T[8] = a31 * b13 + a32 * b23 + a33 * b33, target;
    }
    /**
     * Scale each column of the matrix
     */
    scale(vector, target) {
      target === void 0 && (target = new _Mat3());
      let e = this.elements, t = target.elements;
      for (let i = 0; i !== 3; i++)
        t[3 * i + 0] = vector.x * e[3 * i + 0], t[3 * i + 1] = vector.y * e[3 * i + 1], t[3 * i + 2] = vector.z * e[3 * i + 2];
      return target;
    }
    /**
     * Solve Ax=b
     * @param b The right hand side
     * @param target Optional. Target vector to save in.
     * @return The solution x
     * @todo should reuse arrays
     */
    solve(b2, target) {
      target === void 0 && (target = new Vec3());
      let nr = 3, nc = 4, eqns = [], i, j;
      for (i = 0; i < nr * nc; i++)
        eqns.push(0);
      for (i = 0; i < 3; i++)
        for (j = 0; j < 3; j++)
          eqns[i + nc * j] = this.elements[i + 3 * j];
      eqns[3] = b2.x, eqns[7] = b2.y, eqns[11] = b2.z;
      let n = 3, k = n, np, kp = 4, p;
      do {
        if (i = k - n, eqns[i + nc * i] === 0) {
          for (j = i + 1; j < k; j++)
            if (eqns[i + nc * j] !== 0) {
              np = kp;
              do
                p = kp - np, eqns[p + nc * i] += eqns[p + nc * j];
              while (--np);
              break;
            }
        }
        if (eqns[i + nc * i] !== 0)
          for (j = i + 1; j < k; j++) {
            let multiplier = eqns[i + nc * j] / eqns[i + nc * i];
            np = kp;
            do
              p = kp - np, eqns[p + nc * j] = p <= i ? 0 : eqns[p + nc * j] - eqns[p + nc * i] * multiplier;
            while (--np);
          }
      } while (--n);
      if (target.z = eqns[2 * nc + 3] / eqns[2 * nc + 2], target.y = (eqns[1 * nc + 3] - eqns[1 * nc + 2] * target.z) / eqns[1 * nc + 1], target.x = (eqns[0 * nc + 3] - eqns[0 * nc + 2] * target.z - eqns[0 * nc + 1] * target.y) / eqns[0 * nc + 0], isNaN(target.x) || isNaN(target.y) || isNaN(target.z) || target.x === 1 / 0 || target.y === 1 / 0 || target.z === 1 / 0)
        throw `Could not solve equation! Got x=[${target.toString()}], b=[${b2.toString()}], A=[${this.toString()}]`;
      return target;
    }
    /**
     * Get an element in the matrix by index. Index starts at 0, not 1!!!
     * @param value If provided, the matrix element will be set to this value.
     */
    e(row, column, value) {
      if (value === void 0)
        return this.elements[column + 3 * row];
      this.elements[column + 3 * row] = value;
    }
    /**
     * Copy another matrix into this matrix object.
     */
    copy(matrix) {
      for (let i = 0; i < matrix.elements.length; i++)
        this.elements[i] = matrix.elements[i];
      return this;
    }
    /**
     * Returns a string representation of the matrix.
     */
    toString() {
      let r = "";
      for (let i = 0; i < 9; i++)
        r += this.elements[i] + ",";
      return r;
    }
    /**
     * reverse the matrix
     * @param target Target matrix to save in.
     * @return The solution x
     */
    reverse(target) {
      target === void 0 && (target = new _Mat3());
      let nr = 3, nc = 6, eqns = reverse_eqns, i, j;
      for (i = 0; i < 3; i++)
        for (j = 0; j < 3; j++)
          eqns[i + nc * j] = this.elements[i + 3 * j];
      eqns[3] = 1, eqns[9] = 0, eqns[15] = 0, eqns[4] = 0, eqns[10] = 1, eqns[16] = 0, eqns[5] = 0, eqns[11] = 0, eqns[17] = 1;
      let n = 3, k = n, np, kp = nc, p;
      do {
        if (i = k - n, eqns[i + nc * i] === 0) {
          for (j = i + 1; j < k; j++)
            if (eqns[i + nc * j] !== 0) {
              np = kp;
              do
                p = kp - np, eqns[p + nc * i] += eqns[p + nc * j];
              while (--np);
              break;
            }
        }
        if (eqns[i + nc * i] !== 0)
          for (j = i + 1; j < k; j++) {
            let multiplier = eqns[i + nc * j] / eqns[i + nc * i];
            np = kp;
            do
              p = kp - np, eqns[p + nc * j] = p <= i ? 0 : eqns[p + nc * j] - eqns[p + nc * i] * multiplier;
            while (--np);
          }
      } while (--n);
      i = 2;
      do {
        j = i - 1;
        do {
          let multiplier = eqns[i + nc * j] / eqns[i + nc * i];
          np = nc;
          do
            p = nc - np, eqns[p + nc * j] = eqns[p + nc * j] - eqns[p + nc * i] * multiplier;
          while (--np);
        } while (j--);
      } while (--i);
      i = 2;
      do {
        let multiplier = 1 / eqns[i + nc * i];
        np = nc;
        do
          p = nc - np, eqns[p + nc * i] = eqns[p + nc * i] * multiplier;
        while (--np);
      } while (i--);
      i = 2;
      do {
        j = 2;
        do {
          if (p = eqns[nr + j + nc * i], isNaN(p) || p === 1 / 0)
            throw `Could not reverse! A=[${this.toString()}]`;
          target.e(i, j, p);
        } while (j--);
      } while (i--);
      return target;
    }
    /**
     * Set the matrix from a quaterion
     */
    setRotationFromQuaternion(q) {
      let x = q.x, y = q.y, z = q.z, w = q.w, x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2, e = this.elements;
      return e[0] = 1 - (yy + zz), e[1] = xy - wz, e[2] = xz + wy, e[3] = xy + wz, e[4] = 1 - (xx + zz), e[5] = yz - wx, e[6] = xz - wy, e[7] = yz + wx, e[8] = 1 - (xx + yy), this;
    }
    /**
     * Transpose the matrix
     * @param target Optional. Where to store the result.
     * @return The target Mat3, or a new Mat3 if target was omitted.
     */
    transpose(target) {
      target === void 0 && (target = new _Mat3());
      let M = this.elements, T = target.elements, tmp2;
      return T[0] = M[0], T[4] = M[4], T[8] = M[8], tmp2 = M[1], T[1] = M[3], T[3] = tmp2, tmp2 = M[2], T[2] = M[6], T[6] = tmp2, tmp2 = M[5], T[5] = M[7], T[7] = tmp2, target;
    }
  }, reverse_eqns = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], Vec3 = class _Vec3 {
    constructor(x, y, z) {
      x === void 0 && (x = 0), y === void 0 && (y = 0), z === void 0 && (z = 0), this.x = x, this.y = y, this.z = z;
    }
    /**
     * Vector cross product
     * @param target Optional target to save in.
     */
    cross(vector, target) {
      target === void 0 && (target = new _Vec3());
      let vx = vector.x, vy = vector.y, vz = vector.z, x = this.x, y = this.y, z = this.z;
      return target.x = y * vz - z * vy, target.y = z * vx - x * vz, target.z = x * vy - y * vx, target;
    }
    /**
     * Set the vectors' 3 elements
     */
    set(x, y, z) {
      return this.x = x, this.y = y, this.z = z, this;
    }
    /**
     * Set all components of the vector to zero.
     */
    setZero() {
      this.x = this.y = this.z = 0;
    }
    /**
     * Vector addition
     */
    vadd(vector, target) {
      if (target)
        target.x = vector.x + this.x, target.y = vector.y + this.y, target.z = vector.z + this.z;
      else
        return new _Vec3(this.x + vector.x, this.y + vector.y, this.z + vector.z);
    }
    /**
     * Vector subtraction
     * @param target Optional target to save in.
     */
    vsub(vector, target) {
      if (target)
        target.x = this.x - vector.x, target.y = this.y - vector.y, target.z = this.z - vector.z;
      else
        return new _Vec3(this.x - vector.x, this.y - vector.y, this.z - vector.z);
    }
    /**
     * Get the cross product matrix a_cross from a vector, such that a x b = a_cross * b = c
     *
     * See {@link https://www8.cs.umu.se/kurser/TDBD24/VT06/lectures/Lecture6.pdf Umeå University Lecture}
     */
    crossmat() {
      return new Mat3([0, -this.z, this.y, this.z, 0, -this.x, -this.y, this.x, 0]);
    }
    /**
     * Normalize the vector. Note that this changes the values in the vector.
      * @return Returns the norm of the vector
     */
    normalize() {
      let x = this.x, y = this.y, z = this.z, n = Math.sqrt(x * x + y * y + z * z);
      if (n > 0) {
        let invN = 1 / n;
        this.x *= invN, this.y *= invN, this.z *= invN;
      } else
        this.x = 0, this.y = 0, this.z = 0;
      return n;
    }
    /**
     * Get the version of this vector that is of length 1.
     * @param target Optional target to save in
     * @return Returns the unit vector
     */
    unit(target) {
      target === void 0 && (target = new _Vec3());
      let x = this.x, y = this.y, z = this.z, ninv = Math.sqrt(x * x + y * y + z * z);
      return ninv > 0 ? (ninv = 1 / ninv, target.x = x * ninv, target.y = y * ninv, target.z = z * ninv) : (target.x = 1, target.y = 0, target.z = 0), target;
    }
    /**
     * Get the length of the vector
     */
    length() {
      let x = this.x, y = this.y, z = this.z;
      return Math.sqrt(x * x + y * y + z * z);
    }
    /**
     * Get the squared length of the vector.
     */
    lengthSquared() {
      return this.dot(this);
    }
    /**
     * Get distance from this point to another point
     */
    distanceTo(p) {
      let x = this.x, y = this.y, z = this.z, px = p.x, py = p.y, pz = p.z;
      return Math.sqrt((px - x) * (px - x) + (py - y) * (py - y) + (pz - z) * (pz - z));
    }
    /**
     * Get squared distance from this point to another point
     */
    distanceSquared(p) {
      let x = this.x, y = this.y, z = this.z, px = p.x, py = p.y, pz = p.z;
      return (px - x) * (px - x) + (py - y) * (py - y) + (pz - z) * (pz - z);
    }
    /**
     * Multiply all the components of the vector with a scalar.
     * @param target The vector to save the result in.
     */
    scale(scalar, target) {
      target === void 0 && (target = new _Vec3());
      let x = this.x, y = this.y, z = this.z;
      return target.x = scalar * x, target.y = scalar * y, target.z = scalar * z, target;
    }
    /**
     * Multiply the vector with an other vector, component-wise.
     * @param target The vector to save the result in.
     */
    vmul(vector, target) {
      return target === void 0 && (target = new _Vec3()), target.x = vector.x * this.x, target.y = vector.y * this.y, target.z = vector.z * this.z, target;
    }
    /**
     * Scale a vector and add it to this vector. Save the result in "target". (target = this + vector * scalar)
     * @param target The vector to save the result in.
     */
    addScaledVector(scalar, vector, target) {
      return target === void 0 && (target = new _Vec3()), target.x = this.x + scalar * vector.x, target.y = this.y + scalar * vector.y, target.z = this.z + scalar * vector.z, target;
    }
    /**
     * Calculate dot product
     * @param vector
     */
    dot(vector) {
      return this.x * vector.x + this.y * vector.y + this.z * vector.z;
    }
    isZero() {
      return this.x === 0 && this.y === 0 && this.z === 0;
    }
    /**
     * Make the vector point in the opposite direction.
     * @param target Optional target to save in
     */
    negate(target) {
      return target === void 0 && (target = new _Vec3()), target.x = -this.x, target.y = -this.y, target.z = -this.z, target;
    }
    /**
     * Compute two artificial tangents to the vector
     * @param t1 Vector object to save the first tangent in
     * @param t2 Vector object to save the second tangent in
     */
    tangents(t1, t2) {
      let norm = this.length();
      if (norm > 0) {
        let n = Vec3_tangents_n, inorm = 1 / norm;
        n.set(this.x * inorm, this.y * inorm, this.z * inorm);
        let randVec = Vec3_tangents_randVec;
        Math.abs(n.x) < 0.9 ? (randVec.set(1, 0, 0), n.cross(randVec, t1)) : (randVec.set(0, 1, 0), n.cross(randVec, t1)), n.cross(t1, t2);
      } else
        t1.set(1, 0, 0), t2.set(0, 1, 0);
    }
    /**
     * Converts to a more readable format
     */
    toString() {
      return `${this.x},${this.y},${this.z}`;
    }
    /**
     * Converts to an array
     */
    toArray() {
      return [this.x, this.y, this.z];
    }
    /**
     * Copies value of source to this vector.
     */
    copy(vector) {
      return this.x = vector.x, this.y = vector.y, this.z = vector.z, this;
    }
    /**
     * Do a linear interpolation between two vectors
     * @param t A number between 0 and 1. 0 will make this function return u, and 1 will make it return v. Numbers in between will generate a vector in between them.
     */
    lerp(vector, t, target) {
      let x = this.x, y = this.y, z = this.z;
      target.x = x + (vector.x - x) * t, target.y = y + (vector.y - y) * t, target.z = z + (vector.z - z) * t;
    }
    /**
     * Check if a vector equals is almost equal to another one.
     */
    almostEquals(vector, precision) {
      return precision === void 0 && (precision = 1e-6), !(Math.abs(this.x - vector.x) > precision || Math.abs(this.y - vector.y) > precision || Math.abs(this.z - vector.z) > precision);
    }
    /**
     * Check if a vector is almost zero
     */
    almostZero(precision) {
      return precision === void 0 && (precision = 1e-6), !(Math.abs(this.x) > precision || Math.abs(this.y) > precision || Math.abs(this.z) > precision);
    }
    /**
     * Check if the vector is anti-parallel to another vector.
     * @param precision Set to zero for exact comparisons
     */
    isAntiparallelTo(vector, precision) {
      return this.negate(antip_neg), antip_neg.almostEquals(vector, precision);
    }
    /**
     * Clone the vector
     */
    clone() {
      return new _Vec3(this.x, this.y, this.z);
    }
  };
  Vec3.ZERO = new Vec3(0, 0, 0);
  Vec3.UNIT_X = new Vec3(1, 0, 0);
  Vec3.UNIT_Y = new Vec3(0, 1, 0);
  Vec3.UNIT_Z = new Vec3(0, 0, 1);
  var Vec3_tangents_n = new Vec3(), Vec3_tangents_randVec = new Vec3(), antip_neg = new Vec3(), AABB = class _AABB {
    /**
     * The lower bound of the bounding box
     */
    /**
     * The upper bound of the bounding box
     */
    constructor(options) {
      options === void 0 && (options = {}), this.lowerBound = new Vec3(), this.upperBound = new Vec3(), options.lowerBound && this.lowerBound.copy(options.lowerBound), options.upperBound && this.upperBound.copy(options.upperBound);
    }
    /**
     * Set the AABB bounds from a set of points.
     * @param points An array of Vec3's.
     * @return The self object
     */
    setFromPoints(points, position, quaternion, skinSize) {
      let l = this.lowerBound, u = this.upperBound, q = quaternion;
      l.copy(points[0]), q && q.vmult(l, l), u.copy(l);
      for (let i = 1; i < points.length; i++) {
        let p = points[i];
        q && (q.vmult(p, tmp$1), p = tmp$1), p.x > u.x && (u.x = p.x), p.x < l.x && (l.x = p.x), p.y > u.y && (u.y = p.y), p.y < l.y && (l.y = p.y), p.z > u.z && (u.z = p.z), p.z < l.z && (l.z = p.z);
      }
      return position && (position.vadd(l, l), position.vadd(u, u)), skinSize && (l.x -= skinSize, l.y -= skinSize, l.z -= skinSize, u.x += skinSize, u.y += skinSize, u.z += skinSize), this;
    }
    /**
     * Copy bounds from an AABB to this AABB
     * @param aabb Source to copy from
     * @return The this object, for chainability
     */
    copy(aabb) {
      return this.lowerBound.copy(aabb.lowerBound), this.upperBound.copy(aabb.upperBound), this;
    }
    /**
     * Clone an AABB
     */
    clone() {
      return new _AABB().copy(this);
    }
    /**
     * Extend this AABB so that it covers the given AABB too.
     */
    extend(aabb) {
      this.lowerBound.x = Math.min(this.lowerBound.x, aabb.lowerBound.x), this.upperBound.x = Math.max(this.upperBound.x, aabb.upperBound.x), this.lowerBound.y = Math.min(this.lowerBound.y, aabb.lowerBound.y), this.upperBound.y = Math.max(this.upperBound.y, aabb.upperBound.y), this.lowerBound.z = Math.min(this.lowerBound.z, aabb.lowerBound.z), this.upperBound.z = Math.max(this.upperBound.z, aabb.upperBound.z);
    }
    /**
     * Returns true if the given AABB overlaps this AABB.
     */
    overlaps(aabb) {
      let l1 = this.lowerBound, u1 = this.upperBound, l2 = aabb.lowerBound, u2 = aabb.upperBound, overlapsX = l2.x <= u1.x && u1.x <= u2.x || l1.x <= u2.x && u2.x <= u1.x, overlapsY = l2.y <= u1.y && u1.y <= u2.y || l1.y <= u2.y && u2.y <= u1.y, overlapsZ = l2.z <= u1.z && u1.z <= u2.z || l1.z <= u2.z && u2.z <= u1.z;
      return overlapsX && overlapsY && overlapsZ;
    }
    // Mostly for debugging
    volume() {
      let l = this.lowerBound, u = this.upperBound;
      return (u.x - l.x) * (u.y - l.y) * (u.z - l.z);
    }
    /**
     * Returns true if the given AABB is fully contained in this AABB.
     */
    contains(aabb) {
      let l1 = this.lowerBound, u1 = this.upperBound, l2 = aabb.lowerBound, u2 = aabb.upperBound;
      return l1.x <= l2.x && u1.x >= u2.x && l1.y <= l2.y && u1.y >= u2.y && l1.z <= l2.z && u1.z >= u2.z;
    }
    getCorners(a2, b2, c2, d, e, f, g, h) {
      let l = this.lowerBound, u = this.upperBound;
      a2.copy(l), b2.set(u.x, l.y, l.z), c2.set(u.x, u.y, l.z), d.set(l.x, u.y, u.z), e.set(u.x, l.y, u.z), f.set(l.x, u.y, l.z), g.set(l.x, l.y, u.z), h.copy(u);
    }
    /**
     * Get the representation of an AABB in another frame.
     * @return The "target" AABB object.
     */
    toLocalFrame(frame, target) {
      let corners = transformIntoFrame_corners, a2 = corners[0], b2 = corners[1], c2 = corners[2], d = corners[3], e = corners[4], f = corners[5], g = corners[6], h = corners[7];
      this.getCorners(a2, b2, c2, d, e, f, g, h);
      for (let i = 0; i !== 8; i++) {
        let corner = corners[i];
        frame.pointToLocal(corner, corner);
      }
      return target.setFromPoints(corners);
    }
    /**
     * Get the representation of an AABB in the global frame.
     * @return The "target" AABB object.
     */
    toWorldFrame(frame, target) {
      let corners = transformIntoFrame_corners, a2 = corners[0], b2 = corners[1], c2 = corners[2], d = corners[3], e = corners[4], f = corners[5], g = corners[6], h = corners[7];
      this.getCorners(a2, b2, c2, d, e, f, g, h);
      for (let i = 0; i !== 8; i++) {
        let corner = corners[i];
        frame.pointToWorld(corner, corner);
      }
      return target.setFromPoints(corners);
    }
    /**
     * Check if the AABB is hit by a ray.
     */
    overlapsRay(ray) {
      let {
        direction,
        from
      } = ray, dirFracX = 1 / direction.x, dirFracY = 1 / direction.y, dirFracZ = 1 / direction.z, t1 = (this.lowerBound.x - from.x) * dirFracX, t2 = (this.upperBound.x - from.x) * dirFracX, t3 = (this.lowerBound.y - from.y) * dirFracY, t4 = (this.upperBound.y - from.y) * dirFracY, t5 = (this.lowerBound.z - from.z) * dirFracZ, t6 = (this.upperBound.z - from.z) * dirFracZ, tmin = Math.max(Math.max(Math.min(t1, t2), Math.min(t3, t4)), Math.min(t5, t6)), tmax = Math.min(Math.min(Math.max(t1, t2), Math.max(t3, t4)), Math.max(t5, t6));
      return !(tmax < 0 || tmin > tmax);
    }
  }, tmp$1 = new Vec3(), transformIntoFrame_corners = [new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3()], ArrayCollisionMatrix = class {
    /**
     * The matrix storage.
     */
    constructor() {
      this.matrix = [];
    }
    /**
     * Get an element
     */
    get(bi, bj) {
      let {
        index: i
      } = bi, {
        index: j
      } = bj;
      if (j > i) {
        let temp = j;
        j = i, i = temp;
      }
      return this.matrix[(i * (i + 1) >> 1) + j - 1];
    }
    /**
     * Set an element
     */
    set(bi, bj, value) {
      let {
        index: i
      } = bi, {
        index: j
      } = bj;
      if (j > i) {
        let temp = j;
        j = i, i = temp;
      }
      this.matrix[(i * (i + 1) >> 1) + j - 1] = value ? 1 : 0;
    }
    /**
     * Sets all elements to zero
     */
    reset() {
      for (let i = 0, l = this.matrix.length; i !== l; i++)
        this.matrix[i] = 0;
    }
    /**
     * Sets the max number of objects
     */
    setNumObjects(n) {
      this.matrix.length = n * (n - 1) >> 1;
    }
  }, EventTarget = class {
    /**
     * Add an event listener
     * @return The self object, for chainability.
     */
    addEventListener(type, listener) {
      this._listeners === void 0 && (this._listeners = {});
      let listeners = this._listeners;
      return listeners[type] === void 0 && (listeners[type] = []), listeners[type].includes(listener) || listeners[type].push(listener), this;
    }
    /**
     * Check if an event listener is added
     */
    hasEventListener(type, listener) {
      if (this._listeners === void 0)
        return !1;
      let listeners = this._listeners;
      return !!(listeners[type] !== void 0 && listeners[type].includes(listener));
    }
    /**
     * Check if any event listener of the given type is added
     */
    hasAnyEventListener(type) {
      return this._listeners === void 0 ? !1 : this._listeners[type] !== void 0;
    }
    /**
     * Remove an event listener
     * @return The self object, for chainability.
     */
    removeEventListener(type, listener) {
      if (this._listeners === void 0)
        return this;
      let listeners = this._listeners;
      if (listeners[type] === void 0)
        return this;
      let index = listeners[type].indexOf(listener);
      return index !== -1 && listeners[type].splice(index, 1), this;
    }
    /**
     * Emit an event.
     * @return The self object, for chainability.
     */
    dispatchEvent(event) {
      if (this._listeners === void 0)
        return this;
      let listenerArray = this._listeners[event.type];
      if (listenerArray !== void 0) {
        event.target = this;
        for (let i = 0, l = listenerArray.length; i < l; i++)
          listenerArray[i].call(this, event);
      }
      return this;
    }
  }, Quaternion = class _Quaternion {
    constructor(x, y, z, w) {
      x === void 0 && (x = 0), y === void 0 && (y = 0), z === void 0 && (z = 0), w === void 0 && (w = 1), this.x = x, this.y = y, this.z = z, this.w = w;
    }
    /**
     * Set the value of the quaternion.
     */
    set(x, y, z, w) {
      return this.x = x, this.y = y, this.z = z, this.w = w, this;
    }
    /**
     * Convert to a readable format
     * @return "x,y,z,w"
     */
    toString() {
      return `${this.x},${this.y},${this.z},${this.w}`;
    }
    /**
     * Convert to an Array
     * @return [x, y, z, w]
     */
    toArray() {
      return [this.x, this.y, this.z, this.w];
    }
    /**
     * Set the quaternion components given an axis and an angle in radians.
     */
    setFromAxisAngle(vector, angle) {
      let s = Math.sin(angle * 0.5);
      return this.x = vector.x * s, this.y = vector.y * s, this.z = vector.z * s, this.w = Math.cos(angle * 0.5), this;
    }
    /**
     * Converts the quaternion to [ axis, angle ] representation.
     * @param targetAxis A vector object to reuse for storing the axis.
     * @return An array, first element is the axis and the second is the angle in radians.
     */
    toAxisAngle(targetAxis) {
      targetAxis === void 0 && (targetAxis = new Vec3()), this.normalize();
      let angle = 2 * Math.acos(this.w), s = Math.sqrt(1 - this.w * this.w);
      return s < 1e-3 ? (targetAxis.x = this.x, targetAxis.y = this.y, targetAxis.z = this.z) : (targetAxis.x = this.x / s, targetAxis.y = this.y / s, targetAxis.z = this.z / s), [targetAxis, angle];
    }
    /**
     * Set the quaternion value given two vectors. The resulting rotation will be the needed rotation to rotate u to v.
     */
    setFromVectors(u, v) {
      if (u.isAntiparallelTo(v)) {
        let t1 = sfv_t1, t2 = sfv_t2;
        u.tangents(t1, t2), this.setFromAxisAngle(t1, Math.PI);
      } else {
        let a2 = u.cross(v);
        this.x = a2.x, this.y = a2.y, this.z = a2.z, this.w = Math.sqrt(u.length() ** 2 * v.length() ** 2) + u.dot(v), this.normalize();
      }
      return this;
    }
    /**
     * Multiply the quaternion with an other quaternion.
     */
    mult(quat, target) {
      target === void 0 && (target = new _Quaternion());
      let ax = this.x, ay = this.y, az = this.z, aw = this.w, bx = quat.x, by = quat.y, bz = quat.z, bw = quat.w;
      return target.x = ax * bw + aw * bx + ay * bz - az * by, target.y = ay * bw + aw * by + az * bx - ax * bz, target.z = az * bw + aw * bz + ax * by - ay * bx, target.w = aw * bw - ax * bx - ay * by - az * bz, target;
    }
    /**
     * Get the inverse quaternion rotation.
     */
    inverse(target) {
      target === void 0 && (target = new _Quaternion());
      let x = this.x, y = this.y, z = this.z, w = this.w;
      this.conjugate(target);
      let inorm2 = 1 / (x * x + y * y + z * z + w * w);
      return target.x *= inorm2, target.y *= inorm2, target.z *= inorm2, target.w *= inorm2, target;
    }
    /**
     * Get the quaternion conjugate
     */
    conjugate(target) {
      return target === void 0 && (target = new _Quaternion()), target.x = -this.x, target.y = -this.y, target.z = -this.z, target.w = this.w, target;
    }
    /**
     * Normalize the quaternion. Note that this changes the values of the quaternion.
     */
    normalize() {
      let l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
      return l === 0 ? (this.x = 0, this.y = 0, this.z = 0, this.w = 0) : (l = 1 / l, this.x *= l, this.y *= l, this.z *= l, this.w *= l), this;
    }
    /**
     * Approximation of quaternion normalization. Works best when quat is already almost-normalized.
     * @author unphased, https://github.com/unphased
     */
    normalizeFast() {
      let f = (3 - (this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w)) / 2;
      return f === 0 ? (this.x = 0, this.y = 0, this.z = 0, this.w = 0) : (this.x *= f, this.y *= f, this.z *= f, this.w *= f), this;
    }
    /**
     * Multiply the quaternion by a vector
     */
    vmult(v, target) {
      target === void 0 && (target = new Vec3());
      let x = v.x, y = v.y, z = v.z, qx = this.x, qy = this.y, qz = this.z, qw = this.w, ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
      return target.x = ix * qw + iw * -qx + iy * -qz - iz * -qy, target.y = iy * qw + iw * -qy + iz * -qx - ix * -qz, target.z = iz * qw + iw * -qz + ix * -qy - iy * -qx, target;
    }
    /**
     * Copies value of source to this quaternion.
     * @return this
     */
    copy(quat) {
      return this.x = quat.x, this.y = quat.y, this.z = quat.z, this.w = quat.w, this;
    }
    /**
     * Convert the quaternion to euler angle representation. Order: YZX, as this page describes: https://www.euclideanspace.com/maths/standards/index.htm
     * @param order Three-character string, defaults to "YZX"
     */
    toEuler(target, order) {
      order === void 0 && (order = "YZX");
      let heading, attitude, bank, x = this.x, y = this.y, z = this.z, w = this.w;
      switch (order) {
        case "YZX":
          let test = x * y + z * w;
          if (test > 0.499 && (heading = 2 * Math.atan2(x, w), attitude = Math.PI / 2, bank = 0), test < -0.499 && (heading = -2 * Math.atan2(x, w), attitude = -Math.PI / 2, bank = 0), heading === void 0) {
            let sqx = x * x, sqy = y * y, sqz = z * z;
            heading = Math.atan2(2 * y * w - 2 * x * z, 1 - 2 * sqy - 2 * sqz), attitude = Math.asin(2 * test), bank = Math.atan2(2 * x * w - 2 * y * z, 1 - 2 * sqx - 2 * sqz);
          }
          break;
        default:
          throw new Error(`Euler order ${order} not supported yet.`);
      }
      target.y = heading, target.z = attitude, target.x = bank;
    }
    /**
     * Set the quaternion components given Euler angle representation.
     *
     * @param order The order to apply angles: 'XYZ' or 'YXZ' or any other combination.
     *
     * See {@link https://www.mathworks.com/matlabcentral/fileexchange/20696-function-to-convert-between-dcm-euler-angles-quaternions-and-euler-vectors MathWorks} reference
     */
    setFromEuler(x, y, z, order) {
      order === void 0 && (order = "XYZ");
      let c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
      return order === "XYZ" ? (this.x = s1 * c2 * c3 + c1 * s2 * s3, this.y = c1 * s2 * c3 - s1 * c2 * s3, this.z = c1 * c2 * s3 + s1 * s2 * c3, this.w = c1 * c2 * c3 - s1 * s2 * s3) : order === "YXZ" ? (this.x = s1 * c2 * c3 + c1 * s2 * s3, this.y = c1 * s2 * c3 - s1 * c2 * s3, this.z = c1 * c2 * s3 - s1 * s2 * c3, this.w = c1 * c2 * c3 + s1 * s2 * s3) : order === "ZXY" ? (this.x = s1 * c2 * c3 - c1 * s2 * s3, this.y = c1 * s2 * c3 + s1 * c2 * s3, this.z = c1 * c2 * s3 + s1 * s2 * c3, this.w = c1 * c2 * c3 - s1 * s2 * s3) : order === "ZYX" ? (this.x = s1 * c2 * c3 - c1 * s2 * s3, this.y = c1 * s2 * c3 + s1 * c2 * s3, this.z = c1 * c2 * s3 - s1 * s2 * c3, this.w = c1 * c2 * c3 + s1 * s2 * s3) : order === "YZX" ? (this.x = s1 * c2 * c3 + c1 * s2 * s3, this.y = c1 * s2 * c3 + s1 * c2 * s3, this.z = c1 * c2 * s3 - s1 * s2 * c3, this.w = c1 * c2 * c3 - s1 * s2 * s3) : order === "XZY" && (this.x = s1 * c2 * c3 - c1 * s2 * s3, this.y = c1 * s2 * c3 - s1 * c2 * s3, this.z = c1 * c2 * s3 + s1 * s2 * c3, this.w = c1 * c2 * c3 + s1 * s2 * s3), this;
    }
    clone() {
      return new _Quaternion(this.x, this.y, this.z, this.w);
    }
    /**
     * Performs a spherical linear interpolation between two quat
     *
     * @param toQuat second operand
     * @param t interpolation amount between the self quaternion and toQuat
     * @param target A quaternion to store the result in. If not provided, a new one will be created.
     * @returns {Quaternion} The "target" object
     */
    slerp(toQuat, t, target) {
      target === void 0 && (target = new _Quaternion());
      let ax = this.x, ay = this.y, az = this.z, aw = this.w, bx = toQuat.x, by = toQuat.y, bz = toQuat.z, bw = toQuat.w, omega, cosom, sinom, scale0, scale1;
      return cosom = ax * bx + ay * by + az * bz + aw * bw, cosom < 0 && (cosom = -cosom, bx = -bx, by = -by, bz = -bz, bw = -bw), 1 - cosom > 1e-6 ? (omega = Math.acos(cosom), sinom = Math.sin(omega), scale0 = Math.sin((1 - t) * omega) / sinom, scale1 = Math.sin(t * omega) / sinom) : (scale0 = 1 - t, scale1 = t), target.x = scale0 * ax + scale1 * bx, target.y = scale0 * ay + scale1 * by, target.z = scale0 * az + scale1 * bz, target.w = scale0 * aw + scale1 * bw, target;
    }
    /**
     * Rotate an absolute orientation quaternion given an angular velocity and a time step.
     */
    integrate(angularVelocity, dt, angularFactor, target) {
      target === void 0 && (target = new _Quaternion());
      let ax = angularVelocity.x * angularFactor.x, ay = angularVelocity.y * angularFactor.y, az = angularVelocity.z * angularFactor.z, bx = this.x, by = this.y, bz = this.z, bw = this.w, half_dt = dt * 0.5;
      return target.x += half_dt * (ax * bw + ay * bz - az * by), target.y += half_dt * (ay * bw + az * bx - ax * bz), target.z += half_dt * (az * bw + ax * by - ay * bx), target.w += half_dt * (-ax * bx - ay * by - az * bz), target;
    }
  }, sfv_t1 = new Vec3(), sfv_t2 = new Vec3(), SHAPE_TYPES = {
    /** SPHERE */
    SPHERE: 1,
    /** PLANE */
    PLANE: 2,
    /** BOX */
    BOX: 4,
    /** COMPOUND */
    COMPOUND: 8,
    /** CONVEXPOLYHEDRON */
    CONVEXPOLYHEDRON: 16,
    /** HEIGHTFIELD */
    HEIGHTFIELD: 32,
    /** PARTICLE */
    PARTICLE: 64,
    /** CYLINDER */
    CYLINDER: 128,
    /** TRIMESH */
    TRIMESH: 256
  }, Shape = class _Shape {
    /**
     * Identifier of the Shape.
     */
    /**
     * The type of this shape. Must be set to an int > 0 by subclasses.
     */
    /**
     * The local bounding sphere radius of this shape.
     */
    /**
     * Whether to produce contact forces when in contact with other bodies. Note that contacts will be generated, but they will be disabled.
     * @default true
     */
    /**
     * @default 1
     */
    /**
     * @default -1
     */
    /**
     * Optional material of the shape that regulates contact properties.
     */
    /**
     * The body to which the shape is added to.
     */
    /**
     * All the Shape types.
     */
    constructor(options) {
      options === void 0 && (options = {}), this.id = _Shape.idCounter++, this.type = options.type || 0, this.boundingSphereRadius = 0, this.collisionResponse = options.collisionResponse ? options.collisionResponse : !0, this.collisionFilterGroup = options.collisionFilterGroup !== void 0 ? options.collisionFilterGroup : 1, this.collisionFilterMask = options.collisionFilterMask !== void 0 ? options.collisionFilterMask : -1, this.material = options.material ? options.material : null, this.body = null;
    }
    /**
     * Computes the bounding sphere radius.
     * The result is stored in the property `.boundingSphereRadius`
     */
    updateBoundingSphereRadius() {
      throw `computeBoundingSphereRadius() not implemented for shape type ${this.type}`;
    }
    /**
     * Get the volume of this shape
     */
    volume() {
      throw `volume() not implemented for shape type ${this.type}`;
    }
    /**
     * Calculates the inertia in the local frame for this shape.
     * @see http://en.wikipedia.org/wiki/List_of_moments_of_inertia
     */
    calculateLocalInertia(mass, target) {
      throw `calculateLocalInertia() not implemented for shape type ${this.type}`;
    }
    /**
     * @todo use abstract for these kind of methods
     */
    calculateWorldAABB(pos, quat, min, max) {
      throw `calculateWorldAABB() not implemented for shape type ${this.type}`;
    }
  };
  Shape.idCounter = 0;
  Shape.types = SHAPE_TYPES;
  var Transform = class _Transform {
    /**
     * position
     */
    /**
     * quaternion
     */
    constructor(options) {
      options === void 0 && (options = {}), this.position = new Vec3(), this.quaternion = new Quaternion(), options.position && this.position.copy(options.position), options.quaternion && this.quaternion.copy(options.quaternion);
    }
    /**
     * Get a global point in local transform coordinates.
     */
    pointToLocal(worldPoint, result) {
      return _Transform.pointToLocalFrame(this.position, this.quaternion, worldPoint, result);
    }
    /**
     * Get a local point in global transform coordinates.
     */
    pointToWorld(localPoint, result) {
      return _Transform.pointToWorldFrame(this.position, this.quaternion, localPoint, result);
    }
    /**
     * vectorToWorldFrame
     */
    vectorToWorldFrame(localVector, result) {
      return result === void 0 && (result = new Vec3()), this.quaternion.vmult(localVector, result), result;
    }
    /**
     * pointToLocalFrame
     */
    static pointToLocalFrame(position, quaternion, worldPoint, result) {
      return result === void 0 && (result = new Vec3()), worldPoint.vsub(position, result), quaternion.conjugate(tmpQuat$1), tmpQuat$1.vmult(result, result), result;
    }
    /**
     * pointToWorldFrame
     */
    static pointToWorldFrame(position, quaternion, localPoint, result) {
      return result === void 0 && (result = new Vec3()), quaternion.vmult(localPoint, result), result.vadd(position, result), result;
    }
    /**
     * vectorToWorldFrame
     */
    static vectorToWorldFrame(quaternion, localVector, result) {
      return result === void 0 && (result = new Vec3()), quaternion.vmult(localVector, result), result;
    }
    /**
     * vectorToLocalFrame
     */
    static vectorToLocalFrame(position, quaternion, worldVector, result) {
      return result === void 0 && (result = new Vec3()), quaternion.w *= -1, quaternion.vmult(worldVector, result), quaternion.w *= -1, result;
    }
  }, tmpQuat$1 = new Quaternion(), ConvexPolyhedron = class _ConvexPolyhedron extends Shape {
    /** vertices */
    /**
     * Array of integer arrays, indicating which vertices each face consists of
     */
    /** faceNormals */
    /** worldVertices */
    /** worldVerticesNeedsUpdate */
    /** worldFaceNormals */
    /** worldFaceNormalsNeedsUpdate */
    /**
     * If given, these locally defined, normalized axes are the only ones being checked when doing separating axis check.
     */
    /** uniqueEdges */
    /**
     * @param vertices An array of Vec3's
     * @param faces Array of integer arrays, describing which vertices that is included in each face.
     */
    constructor(props) {
      props === void 0 && (props = {});
      let {
        vertices = [],
        faces = [],
        normals = [],
        axes,
        boundingSphereRadius
      } = props;
      super({
        type: Shape.types.CONVEXPOLYHEDRON
      }), this.vertices = vertices, this.faces = faces, this.faceNormals = normals, this.faceNormals.length === 0 && this.computeNormals(), boundingSphereRadius ? this.boundingSphereRadius = boundingSphereRadius : this.updateBoundingSphereRadius(), this.worldVertices = [], this.worldVerticesNeedsUpdate = !0, this.worldFaceNormals = [], this.worldFaceNormalsNeedsUpdate = !0, this.uniqueAxes = axes ? axes.slice() : null, this.uniqueEdges = [], this.computeEdges();
    }
    /**
     * Computes uniqueEdges
     */
    computeEdges() {
      let faces = this.faces, vertices = this.vertices, edges = this.uniqueEdges;
      edges.length = 0;
      let edge = new Vec3();
      for (let i = 0; i !== faces.length; i++) {
        let face = faces[i], numVertices = face.length;
        for (let j = 0; j !== numVertices; j++) {
          let k = (j + 1) % numVertices;
          vertices[face[j]].vsub(vertices[face[k]], edge), edge.normalize();
          let found = !1;
          for (let p = 0; p !== edges.length; p++)
            if (edges[p].almostEquals(edge) || edges[p].almostEquals(edge)) {
              found = !0;
              break;
            }
          found || edges.push(edge.clone());
        }
      }
    }
    /**
     * Compute the normals of the faces.
     * Will reuse existing Vec3 objects in the `faceNormals` array if they exist.
     */
    computeNormals() {
      this.faceNormals.length = this.faces.length;
      for (let i = 0; i < this.faces.length; i++) {
        for (let j = 0; j < this.faces[i].length; j++)
          if (!this.vertices[this.faces[i][j]])
            throw new Error(`Vertex ${this.faces[i][j]} not found!`);
        let n = this.faceNormals[i] || new Vec3();
        this.getFaceNormal(i, n), n.negate(n), this.faceNormals[i] = n;
        let vertex = this.vertices[this.faces[i][0]];
        if (n.dot(vertex) < 0) {
          console.error(`.faceNormals[${i}] = Vec3(${n.toString()}) looks like it points into the shape? The vertices follow. Make sure they are ordered CCW around the normal, using the right hand rule.`);
          for (let j = 0; j < this.faces[i].length; j++)
            console.warn(`.vertices[${this.faces[i][j]}] = Vec3(${this.vertices[this.faces[i][j]].toString()})`);
        }
      }
    }
    /**
     * Compute the normal of a face from its vertices
     */
    getFaceNormal(i, target) {
      let f = this.faces[i], va2 = this.vertices[f[0]], vb2 = this.vertices[f[1]], vc2 = this.vertices[f[2]];
      _ConvexPolyhedron.computeNormal(va2, vb2, vc2, target);
    }
    /**
     * Get face normal given 3 vertices
     */
    static computeNormal(va2, vb2, vc2, target) {
      let cb2 = new Vec3(), ab2 = new Vec3();
      vb2.vsub(va2, ab2), vc2.vsub(vb2, cb2), cb2.cross(ab2, target), target.isZero() || target.normalize();
    }
    /**
     * @param minDist Clamp distance
     * @param result The an array of contact point objects, see clipFaceAgainstHull
     */
    clipAgainstHull(posA, quatA, hullB, posB, quatB, separatingNormal, minDist, maxDist, result) {
      let WorldNormal = new Vec3(), closestFaceB = -1, dmax = -Number.MAX_VALUE;
      for (let face = 0; face < hullB.faces.length; face++) {
        WorldNormal.copy(hullB.faceNormals[face]), quatB.vmult(WorldNormal, WorldNormal);
        let d = WorldNormal.dot(separatingNormal);
        d > dmax && (dmax = d, closestFaceB = face);
      }
      let worldVertsB1 = [];
      for (let i = 0; i < hullB.faces[closestFaceB].length; i++) {
        let b2 = hullB.vertices[hullB.faces[closestFaceB][i]], worldb = new Vec3();
        worldb.copy(b2), quatB.vmult(worldb, worldb), posB.vadd(worldb, worldb), worldVertsB1.push(worldb);
      }
      closestFaceB >= 0 && this.clipFaceAgainstHull(separatingNormal, posA, quatA, worldVertsB1, minDist, maxDist, result);
    }
    /**
     * Find the separating axis between this hull and another
     * @param target The target vector to save the axis in
     * @return Returns false if a separation is found, else true
     */
    findSeparatingAxis(hullB, posA, quatA, posB, quatB, target, faceListA, faceListB) {
      let faceANormalWS3 = new Vec3(), Worldnormal1 = new Vec3(), deltaC = new Vec3(), worldEdge0 = new Vec3(), worldEdge1 = new Vec3(), Cross = new Vec3(), dmin = Number.MAX_VALUE, hullA = this;
      if (hullA.uniqueAxes)
        for (let i = 0; i !== hullA.uniqueAxes.length; i++) {
          quatA.vmult(hullA.uniqueAxes[i], faceANormalWS3);
          let d = hullA.testSepAxis(faceANormalWS3, hullB, posA, quatA, posB, quatB);
          if (d === !1)
            return !1;
          d < dmin && (dmin = d, target.copy(faceANormalWS3));
        }
      else {
        let numFacesA = faceListA ? faceListA.length : hullA.faces.length;
        for (let i = 0; i < numFacesA; i++) {
          let fi = faceListA ? faceListA[i] : i;
          faceANormalWS3.copy(hullA.faceNormals[fi]), quatA.vmult(faceANormalWS3, faceANormalWS3);
          let d = hullA.testSepAxis(faceANormalWS3, hullB, posA, quatA, posB, quatB);
          if (d === !1)
            return !1;
          d < dmin && (dmin = d, target.copy(faceANormalWS3));
        }
      }
      if (hullB.uniqueAxes)
        for (let i = 0; i !== hullB.uniqueAxes.length; i++) {
          quatB.vmult(hullB.uniqueAxes[i], Worldnormal1);
          let d = hullA.testSepAxis(Worldnormal1, hullB, posA, quatA, posB, quatB);
          if (d === !1)
            return !1;
          d < dmin && (dmin = d, target.copy(Worldnormal1));
        }
      else {
        let numFacesB = faceListB ? faceListB.length : hullB.faces.length;
        for (let i = 0; i < numFacesB; i++) {
          let fi = faceListB ? faceListB[i] : i;
          Worldnormal1.copy(hullB.faceNormals[fi]), quatB.vmult(Worldnormal1, Worldnormal1);
          let d = hullA.testSepAxis(Worldnormal1, hullB, posA, quatA, posB, quatB);
          if (d === !1)
            return !1;
          d < dmin && (dmin = d, target.copy(Worldnormal1));
        }
      }
      for (let e0 = 0; e0 !== hullA.uniqueEdges.length; e0++) {
        quatA.vmult(hullA.uniqueEdges[e0], worldEdge0);
        for (let e1 = 0; e1 !== hullB.uniqueEdges.length; e1++)
          if (quatB.vmult(hullB.uniqueEdges[e1], worldEdge1), worldEdge0.cross(worldEdge1, Cross), !Cross.almostZero()) {
            Cross.normalize();
            let dist = hullA.testSepAxis(Cross, hullB, posA, quatA, posB, quatB);
            if (dist === !1)
              return !1;
            dist < dmin && (dmin = dist, target.copy(Cross));
          }
      }
      return posB.vsub(posA, deltaC), deltaC.dot(target) > 0 && target.negate(target), !0;
    }
    /**
     * Test separating axis against two hulls. Both hulls are projected onto the axis and the overlap size is returned if there is one.
     * @return The overlap depth, or FALSE if no penetration.
     */
    testSepAxis(axis, hullB, posA, quatA, posB, quatB) {
      let hullA = this;
      _ConvexPolyhedron.project(hullA, axis, posA, quatA, maxminA), _ConvexPolyhedron.project(hullB, axis, posB, quatB, maxminB);
      let maxA = maxminA[0], minA = maxminA[1], maxB = maxminB[0], minB = maxminB[1];
      if (maxA < minB || maxB < minA)
        return !1;
      let d0 = maxA - minB, d1 = maxB - minA;
      return d0 < d1 ? d0 : d1;
    }
    /**
     * calculateLocalInertia
     */
    calculateLocalInertia(mass, target) {
      let aabbmax = new Vec3(), aabbmin = new Vec3();
      this.computeLocalAABB(aabbmin, aabbmax);
      let x = aabbmax.x - aabbmin.x, y = aabbmax.y - aabbmin.y, z = aabbmax.z - aabbmin.z;
      target.x = 1 / 12 * mass * (2 * y * 2 * y + 2 * z * 2 * z), target.y = 1 / 12 * mass * (2 * x * 2 * x + 2 * z * 2 * z), target.z = 1 / 12 * mass * (2 * y * 2 * y + 2 * x * 2 * x);
    }
    /**
     * @param face_i Index of the face
     */
    getPlaneConstantOfFace(face_i) {
      let f = this.faces[face_i], n = this.faceNormals[face_i], v = this.vertices[f[0]];
      return -n.dot(v);
    }
    /**
     * Clip a face against a hull.
     * @param worldVertsB1 An array of Vec3 with vertices in the world frame.
     * @param minDist Distance clamping
     * @param Array result Array to store resulting contact points in. Will be objects with properties: point, depth, normal. These are represented in world coordinates.
     */
    clipFaceAgainstHull(separatingNormal, posA, quatA, worldVertsB1, minDist, maxDist, result) {
      let faceANormalWS = new Vec3(), edge0 = new Vec3(), WorldEdge0 = new Vec3(), worldPlaneAnormal1 = new Vec3(), planeNormalWS1 = new Vec3(), worldA1 = new Vec3(), localPlaneNormal = new Vec3(), planeNormalWS = new Vec3(), hullA = this, worldVertsB2 = [], pVtxIn = worldVertsB1, pVtxOut = worldVertsB2, closestFaceA = -1, dmin = Number.MAX_VALUE;
      for (let face = 0; face < hullA.faces.length; face++) {
        faceANormalWS.copy(hullA.faceNormals[face]), quatA.vmult(faceANormalWS, faceANormalWS);
        let d = faceANormalWS.dot(separatingNormal);
        d < dmin && (dmin = d, closestFaceA = face);
      }
      if (closestFaceA < 0)
        return;
      let polyA = hullA.faces[closestFaceA];
      polyA.connectedFaces = [];
      for (let i = 0; i < hullA.faces.length; i++)
        for (let j = 0; j < hullA.faces[i].length; j++)
          /* Sharing a vertex*/
          polyA.indexOf(hullA.faces[i][j]) !== -1 && /* Not the one we are looking for connections from */
          i !== closestFaceA && /* Not already added */
          polyA.connectedFaces.indexOf(i) === -1 && polyA.connectedFaces.push(i);
      let numVerticesA = polyA.length;
      for (let i = 0; i < numVerticesA; i++) {
        let a2 = hullA.vertices[polyA[i]], b2 = hullA.vertices[polyA[(i + 1) % numVerticesA]];
        a2.vsub(b2, edge0), WorldEdge0.copy(edge0), quatA.vmult(WorldEdge0, WorldEdge0), posA.vadd(WorldEdge0, WorldEdge0), worldPlaneAnormal1.copy(this.faceNormals[closestFaceA]), quatA.vmult(worldPlaneAnormal1, worldPlaneAnormal1), posA.vadd(worldPlaneAnormal1, worldPlaneAnormal1), WorldEdge0.cross(worldPlaneAnormal1, planeNormalWS1), planeNormalWS1.negate(planeNormalWS1), worldA1.copy(a2), quatA.vmult(worldA1, worldA1), posA.vadd(worldA1, worldA1);
        let otherFace = polyA.connectedFaces[i];
        localPlaneNormal.copy(this.faceNormals[otherFace]);
        let localPlaneEq2 = this.getPlaneConstantOfFace(otherFace);
        planeNormalWS.copy(localPlaneNormal), quatA.vmult(planeNormalWS, planeNormalWS);
        let planeEqWS2 = localPlaneEq2 - planeNormalWS.dot(posA);
        for (this.clipFaceAgainstPlane(pVtxIn, pVtxOut, planeNormalWS, planeEqWS2); pVtxIn.length; )
          pVtxIn.shift();
        for (; pVtxOut.length; )
          pVtxIn.push(pVtxOut.shift());
      }
      localPlaneNormal.copy(this.faceNormals[closestFaceA]);
      let localPlaneEq = this.getPlaneConstantOfFace(closestFaceA);
      planeNormalWS.copy(localPlaneNormal), quatA.vmult(planeNormalWS, planeNormalWS);
      let planeEqWS = localPlaneEq - planeNormalWS.dot(posA);
      for (let i = 0; i < pVtxIn.length; i++) {
        let depth = planeNormalWS.dot(pVtxIn[i]) + planeEqWS;
        if (depth <= minDist && (console.log(`clamped: depth=${depth} to minDist=${minDist}`), depth = minDist), depth <= maxDist) {
          let point = pVtxIn[i];
          if (depth <= 1e-6) {
            let p = {
              point,
              normal: planeNormalWS,
              depth
            };
            result.push(p);
          }
        }
      }
    }
    /**
     * Clip a face in a hull against the back of a plane.
     * @param planeConstant The constant in the mathematical plane equation
     */
    clipFaceAgainstPlane(inVertices, outVertices, planeNormal, planeConstant) {
      let n_dot_first, n_dot_last, numVerts = inVertices.length;
      if (numVerts < 2)
        return outVertices;
      let firstVertex = inVertices[inVertices.length - 1], lastVertex = inVertices[0];
      n_dot_first = planeNormal.dot(firstVertex) + planeConstant;
      for (let vi = 0; vi < numVerts; vi++) {
        if (lastVertex = inVertices[vi], n_dot_last = planeNormal.dot(lastVertex) + planeConstant, n_dot_first < 0)
          if (n_dot_last < 0) {
            let newv = new Vec3();
            newv.copy(lastVertex), outVertices.push(newv);
          } else {
            let newv = new Vec3();
            firstVertex.lerp(lastVertex, n_dot_first / (n_dot_first - n_dot_last), newv), outVertices.push(newv);
          }
        else if (n_dot_last < 0) {
          let newv = new Vec3();
          firstVertex.lerp(lastVertex, n_dot_first / (n_dot_first - n_dot_last), newv), outVertices.push(newv), outVertices.push(lastVertex);
        }
        firstVertex = lastVertex, n_dot_first = n_dot_last;
      }
      return outVertices;
    }
    /**
     * Updates `.worldVertices` and sets `.worldVerticesNeedsUpdate` to false.
     */
    computeWorldVertices(position, quat) {
      for (; this.worldVertices.length < this.vertices.length; )
        this.worldVertices.push(new Vec3());
      let verts = this.vertices, worldVerts = this.worldVertices;
      for (let i = 0; i !== this.vertices.length; i++)
        quat.vmult(verts[i], worldVerts[i]), position.vadd(worldVerts[i], worldVerts[i]);
      this.worldVerticesNeedsUpdate = !1;
    }
    computeLocalAABB(aabbmin, aabbmax) {
      let vertices = this.vertices;
      aabbmin.set(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE), aabbmax.set(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
      for (let i = 0; i < this.vertices.length; i++) {
        let v = vertices[i];
        v.x < aabbmin.x ? aabbmin.x = v.x : v.x > aabbmax.x && (aabbmax.x = v.x), v.y < aabbmin.y ? aabbmin.y = v.y : v.y > aabbmax.y && (aabbmax.y = v.y), v.z < aabbmin.z ? aabbmin.z = v.z : v.z > aabbmax.z && (aabbmax.z = v.z);
      }
    }
    /**
     * Updates `worldVertices` and sets `worldVerticesNeedsUpdate` to false.
     */
    computeWorldFaceNormals(quat) {
      let N = this.faceNormals.length;
      for (; this.worldFaceNormals.length < N; )
        this.worldFaceNormals.push(new Vec3());
      let normals = this.faceNormals, worldNormals = this.worldFaceNormals;
      for (let i = 0; i !== N; i++)
        quat.vmult(normals[i], worldNormals[i]);
      this.worldFaceNormalsNeedsUpdate = !1;
    }
    /**
     * updateBoundingSphereRadius
     */
    updateBoundingSphereRadius() {
      let max2 = 0, verts = this.vertices;
      for (let i = 0; i !== verts.length; i++) {
        let norm2 = verts[i].lengthSquared();
        norm2 > max2 && (max2 = norm2);
      }
      this.boundingSphereRadius = Math.sqrt(max2);
    }
    /**
     * calculateWorldAABB
     */
    calculateWorldAABB(pos, quat, min, max) {
      let verts = this.vertices, minx, miny, minz, maxx, maxy, maxz, tempWorldVertex = new Vec3();
      for (let i = 0; i < verts.length; i++) {
        tempWorldVertex.copy(verts[i]), quat.vmult(tempWorldVertex, tempWorldVertex), pos.vadd(tempWorldVertex, tempWorldVertex);
        let v = tempWorldVertex;
        (minx === void 0 || v.x < minx) && (minx = v.x), (maxx === void 0 || v.x > maxx) && (maxx = v.x), (miny === void 0 || v.y < miny) && (miny = v.y), (maxy === void 0 || v.y > maxy) && (maxy = v.y), (minz === void 0 || v.z < minz) && (minz = v.z), (maxz === void 0 || v.z > maxz) && (maxz = v.z);
      }
      min.set(minx, miny, minz), max.set(maxx, maxy, maxz);
    }
    /**
     * Get approximate convex volume
     */
    volume() {
      return 4 * Math.PI * this.boundingSphereRadius / 3;
    }
    /**
     * Get an average of all the vertices positions
     */
    getAveragePointLocal(target) {
      target === void 0 && (target = new Vec3());
      let verts = this.vertices;
      for (let i = 0; i < verts.length; i++)
        target.vadd(verts[i], target);
      return target.scale(1 / verts.length, target), target;
    }
    /**
     * Transform all local points. Will change the .vertices
     */
    transformAllPoints(offset, quat) {
      let n = this.vertices.length, verts = this.vertices;
      if (quat) {
        for (let i = 0; i < n; i++) {
          let v = verts[i];
          quat.vmult(v, v);
        }
        for (let i = 0; i < this.faceNormals.length; i++) {
          let v = this.faceNormals[i];
          quat.vmult(v, v);
        }
      }
      if (offset)
        for (let i = 0; i < n; i++) {
          let v = verts[i];
          v.vadd(offset, v);
        }
    }
    /**
     * Checks whether p is inside the polyhedra. Must be in local coords.
     * The point lies outside of the convex hull of the other points if and only if the direction
     * of all the vectors from it to those other points are on less than one half of a sphere around it.
     * @param p A point given in local coordinates
     */
    pointIsInside(p) {
      let verts = this.vertices, faces = this.faces, normals = this.faceNormals, positiveResult = null, pointInside = new Vec3();
      this.getAveragePointLocal(pointInside);
      for (let i = 0; i < this.faces.length; i++) {
        let n = normals[i], v = verts[faces[i][0]], vToP = new Vec3();
        p.vsub(v, vToP);
        let r1 = n.dot(vToP), vToPointInside = new Vec3();
        pointInside.vsub(v, vToPointInside);
        let r2 = n.dot(vToPointInside);
        if (r1 < 0 && r2 > 0 || r1 > 0 && r2 < 0)
          return !1;
      }
      return positiveResult ? 1 : -1;
    }
    /**
     * Get max and min dot product of a convex hull at position (pos,quat) projected onto an axis.
     * Results are saved in the array maxmin.
     * @param result result[0] and result[1] will be set to maximum and minimum, respectively.
     */
    static project(shape, axis, pos, quat, result) {
      let n = shape.vertices.length, localAxis = project_localAxis, max = 0, min = 0, localOrigin = project_localOrigin, vs = shape.vertices;
      localOrigin.setZero(), Transform.vectorToLocalFrame(pos, quat, axis, localAxis), Transform.pointToLocalFrame(pos, quat, localOrigin, localOrigin);
      let add = localOrigin.dot(localAxis);
      min = max = vs[0].dot(localAxis);
      for (let i = 1; i < n; i++) {
        let val = vs[i].dot(localAxis);
        val > max && (max = val), val < min && (min = val);
      }
      if (min -= add, max -= add, min > max) {
        let temp = min;
        min = max, max = temp;
      }
      result[0] = max, result[1] = min;
    }
  }, maxminA = [], maxminB = [], project_worldVertex = new Vec3(), project_localAxis = new Vec3(), project_localOrigin = new Vec3(), Box = class _Box extends Shape {
    /**
     * The half extents of the box.
     */
    /**
     * Used by the contact generator to make contacts with other convex polyhedra for example.
     */
    constructor(halfExtents) {
      super({
        type: Shape.types.BOX
      }), this.halfExtents = halfExtents, this.convexPolyhedronRepresentation = null, this.updateConvexPolyhedronRepresentation(), this.updateBoundingSphereRadius();
    }
    /**
     * Updates the local convex polyhedron representation used for some collisions.
     */
    updateConvexPolyhedronRepresentation() {
      let sx = this.halfExtents.x, sy = this.halfExtents.y, sz = this.halfExtents.z, V = Vec3, vertices = [new V(-sx, -sy, -sz), new V(sx, -sy, -sz), new V(sx, sy, -sz), new V(-sx, sy, -sz), new V(-sx, -sy, sz), new V(sx, -sy, sz), new V(sx, sy, sz), new V(-sx, sy, sz)], faces = [
        [3, 2, 1, 0],
        // -z
        [4, 5, 6, 7],
        // +z
        [5, 4, 0, 1],
        // -y
        [2, 3, 7, 6],
        // +y
        [0, 4, 7, 3],
        // -x
        [1, 2, 6, 5]
        // +x
      ], axes = [new V(0, 0, 1), new V(0, 1, 0), new V(1, 0, 0)], h = new ConvexPolyhedron({
        vertices,
        faces,
        axes
      });
      this.convexPolyhedronRepresentation = h, h.material = this.material;
    }
    /**
     * Calculate the inertia of the box.
     */
    calculateLocalInertia(mass, target) {
      return target === void 0 && (target = new Vec3()), _Box.calculateInertia(this.halfExtents, mass, target), target;
    }
    static calculateInertia(halfExtents, mass, target) {
      let e = halfExtents;
      target.x = 1 / 12 * mass * (2 * e.y * 2 * e.y + 2 * e.z * 2 * e.z), target.y = 1 / 12 * mass * (2 * e.x * 2 * e.x + 2 * e.z * 2 * e.z), target.z = 1 / 12 * mass * (2 * e.y * 2 * e.y + 2 * e.x * 2 * e.x);
    }
    /**
     * Get the box 6 side normals
     * @param sixTargetVectors An array of 6 vectors, to store the resulting side normals in.
     * @param quat Orientation to apply to the normal vectors. If not provided, the vectors will be in respect to the local frame.
     */
    getSideNormals(sixTargetVectors, quat) {
      let sides = sixTargetVectors, ex = this.halfExtents;
      if (sides[0].set(ex.x, 0, 0), sides[1].set(0, ex.y, 0), sides[2].set(0, 0, ex.z), sides[3].set(-ex.x, 0, 0), sides[4].set(0, -ex.y, 0), sides[5].set(0, 0, -ex.z), quat !== void 0)
        for (let i = 0; i !== sides.length; i++)
          quat.vmult(sides[i], sides[i]);
      return sides;
    }
    /**
     * Returns the volume of the box.
     */
    volume() {
      return 8 * this.halfExtents.x * this.halfExtents.y * this.halfExtents.z;
    }
    /**
     * updateBoundingSphereRadius
     */
    updateBoundingSphereRadius() {
      this.boundingSphereRadius = this.halfExtents.length();
    }
    /**
     * forEachWorldCorner
     */
    forEachWorldCorner(pos, quat, callback) {
      let e = this.halfExtents, corners = [[e.x, e.y, e.z], [-e.x, e.y, e.z], [-e.x, -e.y, e.z], [-e.x, -e.y, -e.z], [e.x, -e.y, -e.z], [e.x, e.y, -e.z], [-e.x, e.y, -e.z], [e.x, -e.y, e.z]];
      for (let i = 0; i < corners.length; i++)
        worldCornerTempPos.set(corners[i][0], corners[i][1], corners[i][2]), quat.vmult(worldCornerTempPos, worldCornerTempPos), pos.vadd(worldCornerTempPos, worldCornerTempPos), callback(worldCornerTempPos.x, worldCornerTempPos.y, worldCornerTempPos.z);
    }
    /**
     * calculateWorldAABB
     */
    calculateWorldAABB(pos, quat, min, max) {
      let e = this.halfExtents;
      worldCornersTemp[0].set(e.x, e.y, e.z), worldCornersTemp[1].set(-e.x, e.y, e.z), worldCornersTemp[2].set(-e.x, -e.y, e.z), worldCornersTemp[3].set(-e.x, -e.y, -e.z), worldCornersTemp[4].set(e.x, -e.y, -e.z), worldCornersTemp[5].set(e.x, e.y, -e.z), worldCornersTemp[6].set(-e.x, e.y, -e.z), worldCornersTemp[7].set(e.x, -e.y, e.z);
      let wc = worldCornersTemp[0];
      quat.vmult(wc, wc), pos.vadd(wc, wc), max.copy(wc), min.copy(wc);
      for (let i = 1; i < 8; i++) {
        let wc2 = worldCornersTemp[i];
        quat.vmult(wc2, wc2), pos.vadd(wc2, wc2);
        let x = wc2.x, y = wc2.y, z = wc2.z;
        x > max.x && (max.x = x), y > max.y && (max.y = y), z > max.z && (max.z = z), x < min.x && (min.x = x), y < min.y && (min.y = y), z < min.z && (min.z = z);
      }
    }
  }, worldCornerTempPos = new Vec3(), worldCornersTemp = [new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3()], BODY_TYPES = {
    /** DYNAMIC */
    DYNAMIC: 1,
    /** STATIC */
    STATIC: 2,
    /** KINEMATIC */
    KINEMATIC: 4
  }, BODY_SLEEP_STATES = {
    /** AWAKE */
    AWAKE: 0,
    /** SLEEPY */
    SLEEPY: 1,
    /** SLEEPING */
    SLEEPING: 2
  }, Body = class _Body extends EventTarget {
    /**
     * Dispatched after two bodies collide. This event is dispatched on each
     * of the two bodies involved in the collision.
     * @event collide
     * @param body The body that was involved in the collision.
     * @param contact The details of the collision.
     */
    /**
     * A dynamic body is fully simulated. Can be moved manually by the user, but normally they move according to forces. A dynamic body can collide with all body types. A dynamic body always has finite, non-zero mass.
     */
    /**
     * A static body does not move during simulation and behaves as if it has infinite mass. Static bodies can be moved manually by setting the position of the body. The velocity of a static body is always zero. Static bodies do not collide with other static or kinematic bodies.
     */
    /**
     * A kinematic body moves under simulation according to its velocity. They do not respond to forces. They can be moved manually, but normally a kinematic body is moved by setting its velocity. A kinematic body behaves as if it has infinite mass. Kinematic bodies do not collide with other static or kinematic bodies.
     */
    /**
     * AWAKE
     */
    /**
     * SLEEPY
     */
    /**
     * SLEEPING
     */
    /**
     * Dispatched after a sleeping body has woken up.
     * @event wakeup
     */
    /**
     * Dispatched after a body has gone in to the sleepy state.
     * @event sleepy
     */
    /**
     * Dispatched after a body has fallen asleep.
     * @event sleep
     */
    constructor(options) {
      options === void 0 && (options = {}), super(), this.id = _Body.idCounter++, this.index = -1, this.world = null, this.vlambda = new Vec3(), this.collisionFilterGroup = typeof options.collisionFilterGroup == "number" ? options.collisionFilterGroup : 1, this.collisionFilterMask = typeof options.collisionFilterMask == "number" ? options.collisionFilterMask : -1, this.collisionResponse = typeof options.collisionResponse == "boolean" ? options.collisionResponse : !0, this.position = new Vec3(), this.previousPosition = new Vec3(), this.interpolatedPosition = new Vec3(), this.initPosition = new Vec3(), options.position && (this.position.copy(options.position), this.previousPosition.copy(options.position), this.interpolatedPosition.copy(options.position), this.initPosition.copy(options.position)), this.velocity = new Vec3(), options.velocity && this.velocity.copy(options.velocity), this.initVelocity = new Vec3(), this.force = new Vec3();
      let mass = typeof options.mass == "number" ? options.mass : 0;
      this.mass = mass, this.invMass = mass > 0 ? 1 / mass : 0, this.material = options.material || null, this.linearDamping = typeof options.linearDamping == "number" ? options.linearDamping : 0.01, this.type = mass <= 0 ? _Body.STATIC : _Body.DYNAMIC, typeof options.type == typeof _Body.STATIC && (this.type = options.type), this.allowSleep = typeof options.allowSleep < "u" ? options.allowSleep : !0, this.sleepState = _Body.AWAKE, this.sleepSpeedLimit = typeof options.sleepSpeedLimit < "u" ? options.sleepSpeedLimit : 0.1, this.sleepTimeLimit = typeof options.sleepTimeLimit < "u" ? options.sleepTimeLimit : 1, this.timeLastSleepy = 0, this.wakeUpAfterNarrowphase = !1, this.torque = new Vec3(), this.quaternion = new Quaternion(), this.initQuaternion = new Quaternion(), this.previousQuaternion = new Quaternion(), this.interpolatedQuaternion = new Quaternion(), options.quaternion && (this.quaternion.copy(options.quaternion), this.initQuaternion.copy(options.quaternion), this.previousQuaternion.copy(options.quaternion), this.interpolatedQuaternion.copy(options.quaternion)), this.angularVelocity = new Vec3(), options.angularVelocity && this.angularVelocity.copy(options.angularVelocity), this.initAngularVelocity = new Vec3(), this.shapes = [], this.shapeOffsets = [], this.shapeOrientations = [], this.inertia = new Vec3(), this.invInertia = new Vec3(), this.invInertiaWorld = new Mat3(), this.invMassSolve = 0, this.invInertiaSolve = new Vec3(), this.invInertiaWorldSolve = new Mat3(), this.fixedRotation = typeof options.fixedRotation < "u" ? options.fixedRotation : !1, this.angularDamping = typeof options.angularDamping < "u" ? options.angularDamping : 0.01, this.linearFactor = new Vec3(1, 1, 1), options.linearFactor && this.linearFactor.copy(options.linearFactor), this.angularFactor = new Vec3(1, 1, 1), options.angularFactor && this.angularFactor.copy(options.angularFactor), this.aabb = new AABB(), this.aabbNeedsUpdate = !0, this.boundingRadius = 0, this.wlambda = new Vec3(), this.isTrigger = !!options.isTrigger, options.shape && this.addShape(options.shape), this.updateMassProperties();
    }
    /**
     * Wake the body up.
     */
    wakeUp() {
      let prevState = this.sleepState;
      this.sleepState = _Body.AWAKE, this.wakeUpAfterNarrowphase = !1, prevState === _Body.SLEEPING && this.dispatchEvent(_Body.wakeupEvent);
    }
    /**
     * Force body sleep
     */
    sleep() {
      this.sleepState = _Body.SLEEPING, this.velocity.set(0, 0, 0), this.angularVelocity.set(0, 0, 0), this.wakeUpAfterNarrowphase = !1;
    }
    /**
     * Called every timestep to update internal sleep timer and change sleep state if needed.
     * @param time The world time in seconds
     */
    sleepTick(time) {
      if (this.allowSleep) {
        let sleepState = this.sleepState, speedSquared = this.velocity.lengthSquared() + this.angularVelocity.lengthSquared(), speedLimitSquared = this.sleepSpeedLimit ** 2;
        sleepState === _Body.AWAKE && speedSquared < speedLimitSquared ? (this.sleepState = _Body.SLEEPY, this.timeLastSleepy = time, this.dispatchEvent(_Body.sleepyEvent)) : sleepState === _Body.SLEEPY && speedSquared > speedLimitSquared ? this.wakeUp() : sleepState === _Body.SLEEPY && time - this.timeLastSleepy > this.sleepTimeLimit && (this.sleep(), this.dispatchEvent(_Body.sleepEvent));
      }
    }
    /**
     * If the body is sleeping, it should be immovable / have infinite mass during solve. We solve it by having a separate "solve mass".
     */
    updateSolveMassProperties() {
      this.sleepState === _Body.SLEEPING || this.type === _Body.KINEMATIC ? (this.invMassSolve = 0, this.invInertiaSolve.setZero(), this.invInertiaWorldSolve.setZero()) : (this.invMassSolve = this.invMass, this.invInertiaSolve.copy(this.invInertia), this.invInertiaWorldSolve.copy(this.invInertiaWorld));
    }
    /**
     * Convert a world point to local body frame.
     */
    pointToLocalFrame(worldPoint, result) {
      return result === void 0 && (result = new Vec3()), worldPoint.vsub(this.position, result), this.quaternion.conjugate().vmult(result, result), result;
    }
    /**
     * Convert a world vector to local body frame.
     */
    vectorToLocalFrame(worldVector, result) {
      return result === void 0 && (result = new Vec3()), this.quaternion.conjugate().vmult(worldVector, result), result;
    }
    /**
     * Convert a local body point to world frame.
     */
    pointToWorldFrame(localPoint, result) {
      return result === void 0 && (result = new Vec3()), this.quaternion.vmult(localPoint, result), result.vadd(this.position, result), result;
    }
    /**
     * Convert a local body point to world frame.
     */
    vectorToWorldFrame(localVector, result) {
      return result === void 0 && (result = new Vec3()), this.quaternion.vmult(localVector, result), result;
    }
    /**
     * Add a shape to the body with a local offset and orientation.
     * @return The body object, for chainability.
     */
    addShape(shape, _offset, _orientation) {
      let offset = new Vec3(), orientation = new Quaternion();
      return _offset && offset.copy(_offset), _orientation && orientation.copy(_orientation), this.shapes.push(shape), this.shapeOffsets.push(offset), this.shapeOrientations.push(orientation), this.updateMassProperties(), this.updateBoundingRadius(), this.aabbNeedsUpdate = !0, shape.body = this, this;
    }
    /**
     * Remove a shape from the body.
     * @return The body object, for chainability.
     */
    removeShape(shape) {
      let index = this.shapes.indexOf(shape);
      return index === -1 ? (console.warn("Shape does not belong to the body"), this) : (this.shapes.splice(index, 1), this.shapeOffsets.splice(index, 1), this.shapeOrientations.splice(index, 1), this.updateMassProperties(), this.updateBoundingRadius(), this.aabbNeedsUpdate = !0, shape.body = null, this);
    }
    /**
     * Update the bounding radius of the body. Should be done if any of the shapes are changed.
     */
    updateBoundingRadius() {
      let shapes = this.shapes, shapeOffsets = this.shapeOffsets, N = shapes.length, radius = 0;
      for (let i = 0; i !== N; i++) {
        let shape = shapes[i];
        shape.updateBoundingSphereRadius();
        let offset = shapeOffsets[i].length(), r = shape.boundingSphereRadius;
        offset + r > radius && (radius = offset + r);
      }
      this.boundingRadius = radius;
    }
    /**
     * Updates the .aabb
     */
    updateAABB() {
      let shapes = this.shapes, shapeOffsets = this.shapeOffsets, shapeOrientations = this.shapeOrientations, N = shapes.length, offset = tmpVec, orientation = tmpQuat, bodyQuat = this.quaternion, aabb = this.aabb, shapeAABB = updateAABB_shapeAABB;
      for (let i = 0; i !== N; i++) {
        let shape = shapes[i];
        bodyQuat.vmult(shapeOffsets[i], offset), offset.vadd(this.position, offset), bodyQuat.mult(shapeOrientations[i], orientation), shape.calculateWorldAABB(offset, orientation, shapeAABB.lowerBound, shapeAABB.upperBound), i === 0 ? aabb.copy(shapeAABB) : aabb.extend(shapeAABB);
      }
      this.aabbNeedsUpdate = !1;
    }
    /**
     * Update `.inertiaWorld` and `.invInertiaWorld`
     */
    updateInertiaWorld(force) {
      let I = this.invInertia;
      if (!(I.x === I.y && I.y === I.z && !force)) {
        let m1 = uiw_m1, m2 = uiw_m2;
        m1.setRotationFromQuaternion(this.quaternion), m1.transpose(m2), m1.scale(I, m1), m1.mmult(m2, this.invInertiaWorld);
      }
    }
    /**
     * Apply force to a point of the body. This could for example be a point on the Body surface.
     * Applying force this way will add to Body.force and Body.torque.
     * @param force The amount of force to add.
     * @param relativePoint A point relative to the center of mass to apply the force on.
     */
    applyForce(force, relativePoint) {
      if (relativePoint === void 0 && (relativePoint = new Vec3()), this.type !== _Body.DYNAMIC)
        return;
      this.sleepState === _Body.SLEEPING && this.wakeUp();
      let rotForce = Body_applyForce_rotForce;
      relativePoint.cross(force, rotForce), this.force.vadd(force, this.force), this.torque.vadd(rotForce, this.torque);
    }
    /**
     * Apply force to a local point in the body.
     * @param force The force vector to apply, defined locally in the body frame.
     * @param localPoint A local point in the body to apply the force on.
     */
    applyLocalForce(localForce, localPoint) {
      if (localPoint === void 0 && (localPoint = new Vec3()), this.type !== _Body.DYNAMIC)
        return;
      let worldForce = Body_applyLocalForce_worldForce, relativePointWorld = Body_applyLocalForce_relativePointWorld;
      this.vectorToWorldFrame(localForce, worldForce), this.vectorToWorldFrame(localPoint, relativePointWorld), this.applyForce(worldForce, relativePointWorld);
    }
    /**
     * Apply torque to the body.
     * @param torque The amount of torque to add.
     */
    applyTorque(torque2) {
      this.type === _Body.DYNAMIC && (this.sleepState === _Body.SLEEPING && this.wakeUp(), this.torque.vadd(torque2, this.torque));
    }
    /**
     * Apply impulse to a point of the body. This could for example be a point on the Body surface.
     * An impulse is a force added to a body during a short period of time (impulse = force * time).
     * Impulses will be added to Body.velocity and Body.angularVelocity.
     * @param impulse The amount of impulse to add.
     * @param relativePoint A point relative to the center of mass to apply the force on.
     */
    applyImpulse(impulse, relativePoint) {
      if (relativePoint === void 0 && (relativePoint = new Vec3()), this.type !== _Body.DYNAMIC)
        return;
      this.sleepState === _Body.SLEEPING && this.wakeUp();
      let r = relativePoint, velo = Body_applyImpulse_velo;
      velo.copy(impulse), velo.scale(this.invMass, velo), this.velocity.vadd(velo, this.velocity);
      let rotVelo = Body_applyImpulse_rotVelo;
      r.cross(impulse, rotVelo), this.invInertiaWorld.vmult(rotVelo, rotVelo), this.angularVelocity.vadd(rotVelo, this.angularVelocity);
    }
    /**
     * Apply locally-defined impulse to a local point in the body.
     * @param force The force vector to apply, defined locally in the body frame.
     * @param localPoint A local point in the body to apply the force on.
     */
    applyLocalImpulse(localImpulse, localPoint) {
      if (localPoint === void 0 && (localPoint = new Vec3()), this.type !== _Body.DYNAMIC)
        return;
      let worldImpulse = Body_applyLocalImpulse_worldImpulse, relativePointWorld = Body_applyLocalImpulse_relativePoint;
      this.vectorToWorldFrame(localImpulse, worldImpulse), this.vectorToWorldFrame(localPoint, relativePointWorld), this.applyImpulse(worldImpulse, relativePointWorld);
    }
    /**
     * Should be called whenever you change the body shape or mass.
     */
    updateMassProperties() {
      let halfExtents = Body_updateMassProperties_halfExtents;
      this.invMass = this.mass > 0 ? 1 / this.mass : 0;
      let I = this.inertia, fixed = this.fixedRotation;
      this.updateAABB(), halfExtents.set((this.aabb.upperBound.x - this.aabb.lowerBound.x) / 2, (this.aabb.upperBound.y - this.aabb.lowerBound.y) / 2, (this.aabb.upperBound.z - this.aabb.lowerBound.z) / 2), Box.calculateInertia(halfExtents, this.mass, I), this.invInertia.set(I.x > 0 && !fixed ? 1 / I.x : 0, I.y > 0 && !fixed ? 1 / I.y : 0, I.z > 0 && !fixed ? 1 / I.z : 0), this.updateInertiaWorld(!0);
    }
    /**
     * Get world velocity of a point in the body.
     * @param worldPoint
     * @param result
     * @return The result vector.
     */
    getVelocityAtWorldPoint(worldPoint, result) {
      let r = new Vec3();
      return worldPoint.vsub(this.position, r), this.angularVelocity.cross(r, result), this.velocity.vadd(result, result), result;
    }
    /**
     * Move the body forward in time.
     * @param dt Time step
     * @param quatNormalize Set to true to normalize the body quaternion
     * @param quatNormalizeFast If the quaternion should be normalized using "fast" quaternion normalization
     */
    integrate(dt, quatNormalize, quatNormalizeFast) {
      if (this.previousPosition.copy(this.position), this.previousQuaternion.copy(this.quaternion), !(this.type === _Body.DYNAMIC || this.type === _Body.KINEMATIC) || this.sleepState === _Body.SLEEPING)
        return;
      let velo = this.velocity, angularVelo = this.angularVelocity, pos = this.position, force = this.force, torque2 = this.torque, quat = this.quaternion, invMass = this.invMass, invInertia = this.invInertiaWorld, linearFactor = this.linearFactor, iMdt = invMass * dt;
      velo.x += force.x * iMdt * linearFactor.x, velo.y += force.y * iMdt * linearFactor.y, velo.z += force.z * iMdt * linearFactor.z;
      let e = invInertia.elements, angularFactor = this.angularFactor, tx = torque2.x * angularFactor.x, ty = torque2.y * angularFactor.y, tz = torque2.z * angularFactor.z;
      angularVelo.x += dt * (e[0] * tx + e[1] * ty + e[2] * tz), angularVelo.y += dt * (e[3] * tx + e[4] * ty + e[5] * tz), angularVelo.z += dt * (e[6] * tx + e[7] * ty + e[8] * tz), pos.x += velo.x * dt, pos.y += velo.y * dt, pos.z += velo.z * dt, quat.integrate(this.angularVelocity, dt, this.angularFactor, quat), quatNormalize && (quatNormalizeFast ? quat.normalizeFast() : quat.normalize()), this.aabbNeedsUpdate = !0, this.updateInertiaWorld();
    }
  };
  Body.idCounter = 0;
  Body.COLLIDE_EVENT_NAME = "collide";
  Body.DYNAMIC = BODY_TYPES.DYNAMIC;
  Body.STATIC = BODY_TYPES.STATIC;
  Body.KINEMATIC = BODY_TYPES.KINEMATIC;
  Body.AWAKE = BODY_SLEEP_STATES.AWAKE;
  Body.SLEEPY = BODY_SLEEP_STATES.SLEEPY;
  Body.SLEEPING = BODY_SLEEP_STATES.SLEEPING;
  Body.wakeupEvent = {
    type: "wakeup"
  };
  Body.sleepyEvent = {
    type: "sleepy"
  };
  Body.sleepEvent = {
    type: "sleep"
  };
  var tmpVec = new Vec3(), tmpQuat = new Quaternion(), updateAABB_shapeAABB = new AABB(), uiw_m1 = new Mat3(), uiw_m2 = new Mat3(), uiw_m3 = new Mat3(), Body_applyForce_rotForce = new Vec3(), Body_applyLocalForce_worldForce = new Vec3(), Body_applyLocalForce_relativePointWorld = new Vec3(), Body_applyImpulse_velo = new Vec3(), Body_applyImpulse_rotVelo = new Vec3(), Body_applyLocalImpulse_worldImpulse = new Vec3(), Body_applyLocalImpulse_relativePoint = new Vec3(), Body_updateMassProperties_halfExtents = new Vec3(), Broadphase = class {
    /**
     * The world to search for collisions in.
     */
    /**
     * If set to true, the broadphase uses bounding boxes for intersection tests, else it uses bounding spheres.
     */
    /**
     * Set to true if the objects in the world moved.
     */
    constructor() {
      this.world = null, this.useBoundingBoxes = !1, this.dirty = !0;
    }
    /**
     * Get the collision pairs from the world
     * @param world The world to search in
     * @param p1 Empty array to be filled with body objects
     * @param p2 Empty array to be filled with body objects
     */
    collisionPairs(world, p1, p2) {
      throw new Error("collisionPairs not implemented for this BroadPhase class!");
    }
    /**
     * Check if a body pair needs to be intersection tested at all.
     */
    needBroadphaseCollision(bodyA, bodyB) {
      return !((bodyA.collisionFilterGroup & bodyB.collisionFilterMask) === 0 || (bodyB.collisionFilterGroup & bodyA.collisionFilterMask) === 0 || ((bodyA.type & Body.STATIC) !== 0 || bodyA.sleepState === Body.SLEEPING) && ((bodyB.type & Body.STATIC) !== 0 || bodyB.sleepState === Body.SLEEPING));
    }
    /**
     * Check if the bounding volumes of two bodies intersect.
     */
    intersectionTest(bodyA, bodyB, pairs1, pairs2) {
      this.useBoundingBoxes ? this.doBoundingBoxBroadphase(bodyA, bodyB, pairs1, pairs2) : this.doBoundingSphereBroadphase(bodyA, bodyB, pairs1, pairs2);
    }
    /**
     * Check if the bounding spheres of two bodies are intersecting.
     * @param pairs1 bodyA is appended to this array if intersection
     * @param pairs2 bodyB is appended to this array if intersection
     */
    doBoundingSphereBroadphase(bodyA, bodyB, pairs1, pairs2) {
      let r = Broadphase_collisionPairs_r;
      bodyB.position.vsub(bodyA.position, r);
      let boundingRadiusSum2 = (bodyA.boundingRadius + bodyB.boundingRadius) ** 2;
      r.lengthSquared() < boundingRadiusSum2 && (pairs1.push(bodyA), pairs2.push(bodyB));
    }
    /**
     * Check if the bounding boxes of two bodies are intersecting.
     */
    doBoundingBoxBroadphase(bodyA, bodyB, pairs1, pairs2) {
      bodyA.aabbNeedsUpdate && bodyA.updateAABB(), bodyB.aabbNeedsUpdate && bodyB.updateAABB(), bodyA.aabb.overlaps(bodyB.aabb) && (pairs1.push(bodyA), pairs2.push(bodyB));
    }
    /**
     * Removes duplicate pairs from the pair arrays.
     */
    makePairsUnique(pairs1, pairs2) {
      let t = Broadphase_makePairsUnique_temp, p1 = Broadphase_makePairsUnique_p1, p2 = Broadphase_makePairsUnique_p2, N = pairs1.length;
      for (let i = 0; i !== N; i++)
        p1[i] = pairs1[i], p2[i] = pairs2[i];
      pairs1.length = 0, pairs2.length = 0;
      for (let i = 0; i !== N; i++) {
        let id1 = p1[i].id, id2 = p2[i].id, key = id1 < id2 ? `${id1},${id2}` : `${id2},${id1}`;
        t[key] = i, t.keys.push(key);
      }
      for (let i = 0; i !== t.keys.length; i++) {
        let key = t.keys.pop(), pairIndex = t[key];
        pairs1.push(p1[pairIndex]), pairs2.push(p2[pairIndex]), delete t[key];
      }
    }
    /**
     * To be implemented by subcasses
     */
    setWorld(world) {
    }
    /**
     * Check if the bounding spheres of two bodies overlap.
     */
    static boundingSphereCheck(bodyA, bodyB) {
      let dist = new Vec3();
      bodyA.position.vsub(bodyB.position, dist);
      let sa = bodyA.shapes[0], sb = bodyB.shapes[0];
      return Math.pow(sa.boundingSphereRadius + sb.boundingSphereRadius, 2) > dist.lengthSquared();
    }
    /**
     * Returns all the bodies within the AABB.
     */
    aabbQuery(world, aabb, result) {
      return console.warn(".aabbQuery is not implemented in this Broadphase subclass."), [];
    }
  }, Broadphase_collisionPairs_r = new Vec3();
  new Vec3();
  new Quaternion();
  new Vec3();
  var Broadphase_makePairsUnique_temp = {
    keys: []
  }, Broadphase_makePairsUnique_p1 = [], Broadphase_makePairsUnique_p2 = [];
  new Vec3();
  var GridBroadphase = class extends Broadphase {
    /**
     * Number of boxes along x
     */
    /**
     * Number of boxes along y
     */
    /**
     * Number of boxes along z
     */
    /**
     * aabbMin
     */
    /**
     * aabbMax
     */
    /**
     * bins
     */
    /**
     * binLengths
     */
    /**
     * @param nx Number of boxes along x.
     * @param ny Number of boxes along y.
     * @param nz Number of boxes along z.
     */
    constructor(aabbMin, aabbMax, nx, ny, nz) {
      aabbMin === void 0 && (aabbMin = new Vec3(100, 100, 100)), aabbMax === void 0 && (aabbMax = new Vec3(-100, -100, -100)), nx === void 0 && (nx = 10), ny === void 0 && (ny = 10), nz === void 0 && (nz = 10), super(), this.nx = nx, this.ny = ny, this.nz = nz, this.aabbMin = aabbMin, this.aabbMax = aabbMax;
      let nbins = this.nx * this.ny * this.nz;
      if (nbins <= 0)
        throw "GridBroadphase: Each dimension's n must be >0";
      this.bins = [], this.binLengths = [], this.bins.length = nbins, this.binLengths.length = nbins;
      for (let i = 0; i < nbins; i++)
        this.bins[i] = [], this.binLengths[i] = 0;
    }
    /**
     * Get all the collision pairs in the physics world
     */
    collisionPairs(world, pairs1, pairs2) {
      let N = world.bodies.length, bodies = world.bodies, max = this.aabbMax, min = this.aabbMin, nx = this.nx, ny = this.ny, nz = this.nz, xstep = ny * nz, ystep = nz, zstep = 1, xmax = max.x, ymax = max.y, zmax = max.z, xmin = min.x, ymin = min.y, zmin = min.z, xmult = nx / (xmax - xmin), ymult = ny / (ymax - ymin), zmult = nz / (zmax - zmin), binsizeX = (xmax - xmin) / nx, binsizeY = (ymax - ymin) / ny, binsizeZ = (zmax - zmin) / nz, binRadius = Math.sqrt(binsizeX * binsizeX + binsizeY * binsizeY + binsizeZ * binsizeZ) * 0.5, types = Shape.types, SPHERE = types.SPHERE, PLANE = types.PLANE;
      types.BOX, types.COMPOUND, types.CONVEXPOLYHEDRON;
      let bins = this.bins, binLengths = this.binLengths, Nbins = this.bins.length;
      for (let i = 0; i !== Nbins; i++)
        binLengths[i] = 0;
      let ceil = Math.ceil;
      function addBoxToBins(x0, y0, z0, x1, y1, z1, bi) {
        let xoff0 = (x0 - xmin) * xmult | 0, yoff0 = (y0 - ymin) * ymult | 0, zoff0 = (z0 - zmin) * zmult | 0, xoff1 = ceil((x1 - xmin) * xmult), yoff1 = ceil((y1 - ymin) * ymult), zoff1 = ceil((z1 - zmin) * zmult);
        xoff0 < 0 ? xoff0 = 0 : xoff0 >= nx && (xoff0 = nx - 1), yoff0 < 0 ? yoff0 = 0 : yoff0 >= ny && (yoff0 = ny - 1), zoff0 < 0 ? zoff0 = 0 : zoff0 >= nz && (zoff0 = nz - 1), xoff1 < 0 ? xoff1 = 0 : xoff1 >= nx && (xoff1 = nx - 1), yoff1 < 0 ? yoff1 = 0 : yoff1 >= ny && (yoff1 = ny - 1), zoff1 < 0 ? zoff1 = 0 : zoff1 >= nz && (zoff1 = nz - 1), xoff0 *= xstep, yoff0 *= ystep, zoff0 *= zstep, xoff1 *= xstep, yoff1 *= ystep, zoff1 *= zstep;
        for (let xoff = xoff0; xoff <= xoff1; xoff += xstep)
          for (let yoff = yoff0; yoff <= yoff1; yoff += ystep)
            for (let zoff = zoff0; zoff <= zoff1; zoff += zstep) {
              let idx = xoff + yoff + zoff;
              bins[idx][binLengths[idx]++] = bi;
            }
      }
      for (let i = 0; i !== N; i++) {
        let bi = bodies[i], si = bi.shapes[0];
        switch (si.type) {
          case SPHERE: {
            let shape = si, x = bi.position.x, y = bi.position.y, z = bi.position.z, r = shape.radius;
            addBoxToBins(x - r, y - r, z - r, x + r, y + r, z + r, bi);
            break;
          }
          case PLANE: {
            let shape = si;
            shape.worldNormalNeedsUpdate && shape.computeWorldNormal(bi.quaternion);
            let planeNormal = shape.worldNormal, xreset = xmin + binsizeX * 0.5 - bi.position.x, yreset = ymin + binsizeY * 0.5 - bi.position.y, zreset = zmin + binsizeZ * 0.5 - bi.position.z, d = GridBroadphase_collisionPairs_d;
            d.set(xreset, yreset, zreset);
            for (let xi = 0, xoff = 0; xi !== nx; xi++, xoff += xstep, d.y = yreset, d.x += binsizeX)
              for (let yi = 0, yoff = 0; yi !== ny; yi++, yoff += ystep, d.z = zreset, d.y += binsizeY)
                for (let zi = 0, zoff = 0; zi !== nz; zi++, zoff += zstep, d.z += binsizeZ)
                  if (d.dot(planeNormal) < binRadius) {
                    let idx = xoff + yoff + zoff;
                    bins[idx][binLengths[idx]++] = bi;
                  }
            break;
          }
          default: {
            bi.aabbNeedsUpdate && bi.updateAABB(), addBoxToBins(bi.aabb.lowerBound.x, bi.aabb.lowerBound.y, bi.aabb.lowerBound.z, bi.aabb.upperBound.x, bi.aabb.upperBound.y, bi.aabb.upperBound.z, bi);
            break;
          }
        }
      }
      for (let i = 0; i !== Nbins; i++) {
        let binLength = binLengths[i];
        if (binLength > 1) {
          let bin = bins[i];
          for (let xi = 0; xi !== binLength; xi++) {
            let bi = bin[xi];
            for (let yi = 0; yi !== xi; yi++) {
              let bj = bin[yi];
              this.needBroadphaseCollision(bi, bj) && this.intersectionTest(bi, bj, pairs1, pairs2);
            }
          }
        }
      }
      this.makePairsUnique(pairs1, pairs2);
    }
  }, GridBroadphase_collisionPairs_d = new Vec3();
  new Vec3();
  var NaiveBroadphase = class extends Broadphase {
    /**
     * @todo Remove useless constructor
     */
    constructor() {
      super();
    }
    /**
     * Get all the collision pairs in the physics world
     */
    collisionPairs(world, pairs1, pairs2) {
      let bodies = world.bodies, n = bodies.length, bi, bj;
      for (let i = 0; i !== n; i++)
        for (let j = 0; j !== i; j++)
          bi = bodies[i], bj = bodies[j], this.needBroadphaseCollision(bi, bj) && this.intersectionTest(bi, bj, pairs1, pairs2);
    }
    /**
     * Returns all the bodies within an AABB.
     * @param result An array to store resulting bodies in.
     */
    aabbQuery(world, aabb, result) {
      result === void 0 && (result = []);
      for (let i = 0; i < world.bodies.length; i++) {
        let b2 = world.bodies[i];
        b2.aabbNeedsUpdate && b2.updateAABB(), b2.aabb.overlaps(aabb) && result.push(b2);
      }
      return result;
    }
  }, RaycastResult = class {
    /**
     * rayFromWorld
     */
    /**
     * rayToWorld
     */
    /**
     * hitNormalWorld
     */
    /**
     * hitPointWorld
     */
    /**
     * hasHit
     */
    /**
     * shape
     */
    /**
     * body
     */
    /**
     * The index of the hit triangle, if the hit shape was a trimesh
     */
    /**
     * Distance to the hit. Will be set to -1 if there was no hit
     */
    /**
     * If the ray should stop traversing the bodies
     */
    constructor() {
      this.rayFromWorld = new Vec3(), this.rayToWorld = new Vec3(), this.hitNormalWorld = new Vec3(), this.hitPointWorld = new Vec3(), this.hasHit = !1, this.shape = null, this.body = null, this.hitFaceIndex = -1, this.distance = -1, this.shouldStop = !1;
    }
    /**
     * Reset all result data.
     */
    reset() {
      this.rayFromWorld.setZero(), this.rayToWorld.setZero(), this.hitNormalWorld.setZero(), this.hitPointWorld.setZero(), this.hasHit = !1, this.shape = null, this.body = null, this.hitFaceIndex = -1, this.distance = -1, this.shouldStop = !1;
    }
    /**
     * abort
     */
    abort() {
      this.shouldStop = !0;
    }
    /**
     * Set result data.
     */
    set(rayFromWorld, rayToWorld, hitNormalWorld, hitPointWorld, shape, body, distance) {
      this.rayFromWorld.copy(rayFromWorld), this.rayToWorld.copy(rayToWorld), this.hitNormalWorld.copy(hitNormalWorld), this.hitPointWorld.copy(hitPointWorld), this.shape = shape, this.body = body, this.distance = distance;
    }
  }, _Shape$types$SPHERE, _Shape$types$PLANE, _Shape$types$BOX, _Shape$types$CYLINDER, _Shape$types$CONVEXPO, _Shape$types$HEIGHTFI, _Shape$types$TRIMESH, RAY_MODES = {
    /** CLOSEST */
    CLOSEST: 1,
    /** ANY */
    ANY: 2,
    /** ALL */
    ALL: 4
  };
  _Shape$types$SPHERE = Shape.types.SPHERE;
  _Shape$types$PLANE = Shape.types.PLANE;
  _Shape$types$BOX = Shape.types.BOX;
  _Shape$types$CYLINDER = Shape.types.CYLINDER;
  _Shape$types$CONVEXPO = Shape.types.CONVEXPOLYHEDRON;
  _Shape$types$HEIGHTFI = Shape.types.HEIGHTFIELD;
  _Shape$types$TRIMESH = Shape.types.TRIMESH;
  var Ray = class _Ray {
    /**
     * from
     */
    /**
     * to
     */
    /**
     * direction
     */
    /**
     * The precision of the ray. Used when checking parallelity etc.
     * @default 0.0001
     */
    /**
     * Set to `false` if you don't want the Ray to take `collisionResponse` flags into account on bodies and shapes.
     * @default true
     */
    /**
     * If set to `true`, the ray skips any hits with normal.dot(rayDirection) < 0.
     * @default false
     */
    /**
     * collisionFilterMask
     * @default -1
     */
    /**
     * collisionFilterGroup
     * @default -1
     */
    /**
     * The intersection mode. Should be Ray.ANY, Ray.ALL or Ray.CLOSEST.
     * @default RAY.ANY
     */
    /**
     * Current result object.
     */
    /**
     * Will be set to `true` during intersectWorld() if the ray hit anything.
     */
    /**
     * User-provided result callback. Will be used if mode is Ray.ALL.
     */
    /**
     * CLOSEST
     */
    /**
     * ANY
     */
    /**
     * ALL
     */
    get [_Shape$types$SPHERE]() {
      return this._intersectSphere;
    }
    get [_Shape$types$PLANE]() {
      return this._intersectPlane;
    }
    get [_Shape$types$BOX]() {
      return this._intersectBox;
    }
    get [_Shape$types$CYLINDER]() {
      return this._intersectConvex;
    }
    get [_Shape$types$CONVEXPO]() {
      return this._intersectConvex;
    }
    get [_Shape$types$HEIGHTFI]() {
      return this._intersectHeightfield;
    }
    get [_Shape$types$TRIMESH]() {
      return this._intersectTrimesh;
    }
    constructor(from, to) {
      from === void 0 && (from = new Vec3()), to === void 0 && (to = new Vec3()), this.from = from.clone(), this.to = to.clone(), this.direction = new Vec3(), this.precision = 1e-4, this.checkCollisionResponse = !0, this.skipBackfaces = !1, this.collisionFilterMask = -1, this.collisionFilterGroup = -1, this.mode = _Ray.ANY, this.result = new RaycastResult(), this.hasHit = !1, this.callback = (result) => {
      };
    }
    /**
     * Do itersection against all bodies in the given World.
     * @return True if the ray hit anything, otherwise false.
     */
    intersectWorld(world, options) {
      return this.mode = options.mode || _Ray.ANY, this.result = options.result || new RaycastResult(), this.skipBackfaces = !!options.skipBackfaces, this.collisionFilterMask = typeof options.collisionFilterMask < "u" ? options.collisionFilterMask : -1, this.collisionFilterGroup = typeof options.collisionFilterGroup < "u" ? options.collisionFilterGroup : -1, this.checkCollisionResponse = typeof options.checkCollisionResponse < "u" ? options.checkCollisionResponse : !0, options.from && this.from.copy(options.from), options.to && this.to.copy(options.to), this.callback = options.callback || (() => {
      }), this.hasHit = !1, this.result.reset(), this.updateDirection(), this.getAABB(tmpAABB$1), tmpArray.length = 0, world.broadphase.aabbQuery(world, tmpAABB$1, tmpArray), this.intersectBodies(tmpArray), this.hasHit;
    }
    /**
     * Shoot a ray at a body, get back information about the hit.
     * @deprecated @param result set the result property of the Ray instead.
     */
    intersectBody(body, result) {
      result && (this.result = result, this.updateDirection());
      let checkCollisionResponse = this.checkCollisionResponse;
      if (checkCollisionResponse && !body.collisionResponse || (this.collisionFilterGroup & body.collisionFilterMask) === 0 || (body.collisionFilterGroup & this.collisionFilterMask) === 0)
        return;
      let xi = intersectBody_xi, qi = intersectBody_qi;
      for (let i = 0, N = body.shapes.length; i < N; i++) {
        let shape = body.shapes[i];
        if (!(checkCollisionResponse && !shape.collisionResponse) && (body.quaternion.mult(body.shapeOrientations[i], qi), body.quaternion.vmult(body.shapeOffsets[i], xi), xi.vadd(body.position, xi), this.intersectShape(shape, qi, xi, body), this.result.shouldStop))
          break;
      }
    }
    /**
     * Shoot a ray at an array bodies, get back information about the hit.
     * @param bodies An array of Body objects.
     * @deprecated @param result set the result property of the Ray instead.
     *
     */
    intersectBodies(bodies, result) {
      result && (this.result = result, this.updateDirection());
      for (let i = 0, l = bodies.length; !this.result.shouldStop && i < l; i++)
        this.intersectBody(bodies[i]);
    }
    /**
     * Updates the direction vector.
     */
    updateDirection() {
      this.to.vsub(this.from, this.direction), this.direction.normalize();
    }
    intersectShape(shape, quat, position, body) {
      let from = this.from;
      if (distanceFromIntersection(from, this.direction, position) > shape.boundingSphereRadius)
        return;
      let intersectMethod = this[shape.type];
      intersectMethod && intersectMethod.call(this, shape, quat, position, body, shape);
    }
    _intersectBox(box, quat, position, body, reportedShape) {
      return this._intersectConvex(box.convexPolyhedronRepresentation, quat, position, body, reportedShape);
    }
    _intersectPlane(shape, quat, position, body, reportedShape) {
      let from = this.from, to = this.to, direction = this.direction, worldNormal = new Vec3(0, 0, 1);
      quat.vmult(worldNormal, worldNormal);
      let len = new Vec3();
      from.vsub(position, len);
      let planeToFrom = len.dot(worldNormal);
      to.vsub(position, len);
      let planeToTo = len.dot(worldNormal);
      if (planeToFrom * planeToTo > 0 || from.distanceTo(to) < planeToFrom)
        return;
      let n_dot_dir = worldNormal.dot(direction);
      if (Math.abs(n_dot_dir) < this.precision)
        return;
      let planePointToFrom = new Vec3(), dir_scaled_with_t = new Vec3(), hitPointWorld = new Vec3();
      from.vsub(position, planePointToFrom);
      let t = -worldNormal.dot(planePointToFrom) / n_dot_dir;
      direction.scale(t, dir_scaled_with_t), from.vadd(dir_scaled_with_t, hitPointWorld), this.reportIntersection(worldNormal, hitPointWorld, reportedShape, body, -1);
    }
    /**
     * Get the world AABB of the ray.
     */
    getAABB(aabb) {
      let {
        lowerBound,
        upperBound
      } = aabb, to = this.to, from = this.from;
      lowerBound.x = Math.min(to.x, from.x), lowerBound.y = Math.min(to.y, from.y), lowerBound.z = Math.min(to.z, from.z), upperBound.x = Math.max(to.x, from.x), upperBound.y = Math.max(to.y, from.y), upperBound.z = Math.max(to.z, from.z);
    }
    _intersectHeightfield(shape, quat, position, body, reportedShape) {
      shape.data, shape.elementSize;
      let localRay = intersectHeightfield_localRay;
      localRay.from.copy(this.from), localRay.to.copy(this.to), Transform.pointToLocalFrame(position, quat, localRay.from, localRay.from), Transform.pointToLocalFrame(position, quat, localRay.to, localRay.to), localRay.updateDirection();
      let index = intersectHeightfield_index, iMinX, iMinY, iMaxX, iMaxY;
      iMinX = iMinY = 0, iMaxX = iMaxY = shape.data.length - 1;
      let aabb = new AABB();
      localRay.getAABB(aabb), shape.getIndexOfPosition(aabb.lowerBound.x, aabb.lowerBound.y, index, !0), iMinX = Math.max(iMinX, index[0]), iMinY = Math.max(iMinY, index[1]), shape.getIndexOfPosition(aabb.upperBound.x, aabb.upperBound.y, index, !0), iMaxX = Math.min(iMaxX, index[0] + 1), iMaxY = Math.min(iMaxY, index[1] + 1);
      for (let i = iMinX; i < iMaxX; i++)
        for (let j = iMinY; j < iMaxY; j++) {
          if (this.result.shouldStop)
            return;
          if (shape.getAabbAtIndex(i, j, aabb), !!aabb.overlapsRay(localRay)) {
            if (shape.getConvexTrianglePillar(i, j, !1), Transform.pointToWorldFrame(position, quat, shape.pillarOffset, worldPillarOffset), this._intersectConvex(shape.pillarConvex, quat, worldPillarOffset, body, reportedShape, intersectConvexOptions), this.result.shouldStop)
              return;
            shape.getConvexTrianglePillar(i, j, !0), Transform.pointToWorldFrame(position, quat, shape.pillarOffset, worldPillarOffset), this._intersectConvex(shape.pillarConvex, quat, worldPillarOffset, body, reportedShape, intersectConvexOptions);
          }
        }
    }
    _intersectSphere(sphere, quat, position, body, reportedShape) {
      let from = this.from, to = this.to, r = sphere.radius, a2 = (to.x - from.x) ** 2 + (to.y - from.y) ** 2 + (to.z - from.z) ** 2, b2 = 2 * ((to.x - from.x) * (from.x - position.x) + (to.y - from.y) * (from.y - position.y) + (to.z - from.z) * (from.z - position.z)), c2 = (from.x - position.x) ** 2 + (from.y - position.y) ** 2 + (from.z - position.z) ** 2 - r ** 2, delta = b2 ** 2 - 4 * a2 * c2, intersectionPoint = Ray_intersectSphere_intersectionPoint, normal = Ray_intersectSphere_normal;
      if (!(delta < 0))
        if (delta === 0)
          from.lerp(to, delta, intersectionPoint), intersectionPoint.vsub(position, normal), normal.normalize(), this.reportIntersection(normal, intersectionPoint, reportedShape, body, -1);
        else {
          let d1 = (-b2 - Math.sqrt(delta)) / (2 * a2), d2 = (-b2 + Math.sqrt(delta)) / (2 * a2);
          if (d1 >= 0 && d1 <= 1 && (from.lerp(to, d1, intersectionPoint), intersectionPoint.vsub(position, normal), normal.normalize(), this.reportIntersection(normal, intersectionPoint, reportedShape, body, -1)), this.result.shouldStop)
            return;
          d2 >= 0 && d2 <= 1 && (from.lerp(to, d2, intersectionPoint), intersectionPoint.vsub(position, normal), normal.normalize(), this.reportIntersection(normal, intersectionPoint, reportedShape, body, -1));
        }
    }
    _intersectConvex(shape, quat, position, body, reportedShape, options) {
      let normal = intersectConvex_normal, vector = intersectConvex_vector, faceList = options && options.faceList || null, faces = shape.faces, vertices = shape.vertices, normals = shape.faceNormals, direction = this.direction, from = this.from, to = this.to, fromToDistance = from.distanceTo(to), Nfaces = faceList ? faceList.length : faces.length, result = this.result;
      for (let j = 0; !result.shouldStop && j < Nfaces; j++) {
        let fi = faceList ? faceList[j] : j, face = faces[fi], faceNormal = normals[fi], q = quat, x = position;
        vector.copy(vertices[face[0]]), q.vmult(vector, vector), vector.vadd(x, vector), vector.vsub(from, vector), q.vmult(faceNormal, normal);
        let dot = direction.dot(normal);
        if (Math.abs(dot) < this.precision)
          continue;
        let scalar = normal.dot(vector) / dot;
        if (!(scalar < 0)) {
          direction.scale(scalar, intersectPoint), intersectPoint.vadd(from, intersectPoint), a.copy(vertices[face[0]]), q.vmult(a, a), x.vadd(a, a);
          for (let i = 1; !result.shouldStop && i < face.length - 1; i++) {
            b.copy(vertices[face[i]]), c.copy(vertices[face[i + 1]]), q.vmult(b, b), q.vmult(c, c), x.vadd(b, b), x.vadd(c, c);
            let distance = intersectPoint.distanceTo(from);
            !(_Ray.pointInTriangle(intersectPoint, a, b, c) || _Ray.pointInTriangle(intersectPoint, b, a, c)) || distance > fromToDistance || this.reportIntersection(normal, intersectPoint, reportedShape, body, fi);
          }
        }
      }
    }
    /**
     * @todo Optimize by transforming the world to local space first.
     * @todo Use Octree lookup
     */
    _intersectTrimesh(mesh, quat, position, body, reportedShape, options) {
      let normal = intersectTrimesh_normal, triangles = intersectTrimesh_triangles, treeTransform = intersectTrimesh_treeTransform, vector = intersectConvex_vector, localDirection = intersectTrimesh_localDirection, localFrom = intersectTrimesh_localFrom, localTo = intersectTrimesh_localTo, worldIntersectPoint = intersectTrimesh_worldIntersectPoint, worldNormal = intersectTrimesh_worldNormal, indices = mesh.indices;
      mesh.vertices;
      let from = this.from, to = this.to, direction = this.direction;
      treeTransform.position.copy(position), treeTransform.quaternion.copy(quat), Transform.vectorToLocalFrame(position, quat, direction, localDirection), Transform.pointToLocalFrame(position, quat, from, localFrom), Transform.pointToLocalFrame(position, quat, to, localTo), localTo.x *= mesh.scale.x, localTo.y *= mesh.scale.y, localTo.z *= mesh.scale.z, localFrom.x *= mesh.scale.x, localFrom.y *= mesh.scale.y, localFrom.z *= mesh.scale.z, localTo.vsub(localFrom, localDirection), localDirection.normalize();
      let fromToDistanceSquared = localFrom.distanceSquared(localTo);
      mesh.tree.rayQuery(this, treeTransform, triangles);
      for (let i = 0, N = triangles.length; !this.result.shouldStop && i !== N; i++) {
        let trianglesIndex = triangles[i];
        mesh.getNormal(trianglesIndex, normal), mesh.getVertex(indices[trianglesIndex * 3], a), a.vsub(localFrom, vector);
        let dot = localDirection.dot(normal), scalar = normal.dot(vector) / dot;
        if (scalar < 0)
          continue;
        localDirection.scale(scalar, intersectPoint), intersectPoint.vadd(localFrom, intersectPoint), mesh.getVertex(indices[trianglesIndex * 3 + 1], b), mesh.getVertex(indices[trianglesIndex * 3 + 2], c);
        let squaredDistance = intersectPoint.distanceSquared(localFrom);
        !(_Ray.pointInTriangle(intersectPoint, b, a, c) || _Ray.pointInTriangle(intersectPoint, a, b, c)) || squaredDistance > fromToDistanceSquared || (Transform.vectorToWorldFrame(quat, normal, worldNormal), Transform.pointToWorldFrame(position, quat, intersectPoint, worldIntersectPoint), this.reportIntersection(worldNormal, worldIntersectPoint, reportedShape, body, trianglesIndex));
      }
      triangles.length = 0;
    }
    /**
     * @return True if the intersections should continue
     */
    reportIntersection(normal, hitPointWorld, shape, body, hitFaceIndex) {
      let from = this.from, to = this.to, distance = from.distanceTo(hitPointWorld), result = this.result;
      if (!(this.skipBackfaces && normal.dot(this.direction) > 0))
        switch (result.hitFaceIndex = typeof hitFaceIndex < "u" ? hitFaceIndex : -1, this.mode) {
          case _Ray.ALL:
            this.hasHit = !0, result.set(from, to, normal, hitPointWorld, shape, body, distance), result.hasHit = !0, this.callback(result);
            break;
          case _Ray.CLOSEST:
            (distance < result.distance || !result.hasHit) && (this.hasHit = !0, result.hasHit = !0, result.set(from, to, normal, hitPointWorld, shape, body, distance));
            break;
          case _Ray.ANY:
            this.hasHit = !0, result.hasHit = !0, result.set(from, to, normal, hitPointWorld, shape, body, distance), result.shouldStop = !0;
            break;
        }
    }
    /**
     * As per "Barycentric Technique" as named
     * {@link https://www.blackpawn.com/texts/pointinpoly/default.html here} but without the division
     */
    static pointInTriangle(p, a2, b2, c2) {
      c2.vsub(a2, v0), b2.vsub(a2, v1), p.vsub(a2, v2);
      let dot00 = v0.dot(v0), dot01 = v0.dot(v1), dot02 = v0.dot(v2), dot11 = v1.dot(v1), dot12 = v1.dot(v2), u, v;
      return (u = dot11 * dot02 - dot01 * dot12) >= 0 && (v = dot00 * dot12 - dot01 * dot02) >= 0 && u + v < dot00 * dot11 - dot01 * dot01;
    }
  };
  Ray.CLOSEST = RAY_MODES.CLOSEST;
  Ray.ANY = RAY_MODES.ANY;
  Ray.ALL = RAY_MODES.ALL;
  var tmpAABB$1 = new AABB(), tmpArray = [], v1 = new Vec3(), v2 = new Vec3(), intersectBody_xi = new Vec3(), intersectBody_qi = new Quaternion(), intersectPoint = new Vec3(), a = new Vec3(), b = new Vec3(), c = new Vec3();
  new Vec3();
  new RaycastResult();
  var intersectConvexOptions = {
    faceList: [0]
  }, worldPillarOffset = new Vec3(), intersectHeightfield_localRay = new Ray(), intersectHeightfield_index = [], Ray_intersectSphere_intersectionPoint = new Vec3(), Ray_intersectSphere_normal = new Vec3(), intersectConvex_normal = new Vec3(), intersectConvex_minDistNormal = new Vec3(), intersectConvex_minDistIntersect = new Vec3(), intersectConvex_vector = new Vec3(), intersectTrimesh_normal = new Vec3(), intersectTrimesh_localDirection = new Vec3(), intersectTrimesh_localFrom = new Vec3(), intersectTrimesh_localTo = new Vec3(), intersectTrimesh_worldNormal = new Vec3(), intersectTrimesh_worldIntersectPoint = new Vec3();
  new AABB();
  var intersectTrimesh_triangles = [], intersectTrimesh_treeTransform = new Transform(), v0 = new Vec3(), intersect = new Vec3();
  function distanceFromIntersection(from, direction, position) {
    position.vsub(from, v0);
    let dot = v0.dot(direction);
    return direction.scale(dot, intersect), intersect.vadd(from, intersect), position.distanceTo(intersect);
  }
  var SAPBroadphase = class _SAPBroadphase extends Broadphase {
    /**
     * List of bodies currently in the broadphase.
     */
    /**
     * The world to search in.
     */
    /**
     * Axis to sort the bodies along.
     * Set to 0 for x axis, and 1 for y axis.
     * For best performance, pick the axis where bodies are most distributed.
     */
    /**
     * Check if the bounds of two bodies overlap, along the given SAP axis.
     */
    static checkBounds(bi, bj, axisIndex) {
      let biPos, bjPos;
      axisIndex === 0 ? (biPos = bi.position.x, bjPos = bj.position.x) : axisIndex === 1 ? (biPos = bi.position.y, bjPos = bj.position.y) : axisIndex === 2 && (biPos = bi.position.z, bjPos = bj.position.z);
      let ri = bi.boundingRadius, rj = bj.boundingRadius, boundA2 = biPos + ri;
      return bjPos - rj < boundA2;
    }
    // Note: these are identical, save for x/y/z lowerbound
    /**
     * insertionSortX
     */
    static insertionSortX(a2) {
      for (let i = 1, l = a2.length; i < l; i++) {
        let v = a2[i], j;
        for (j = i - 1; j >= 0 && !(a2[j].aabb.lowerBound.x <= v.aabb.lowerBound.x); j--)
          a2[j + 1] = a2[j];
        a2[j + 1] = v;
      }
      return a2;
    }
    /**
     * insertionSortY
     */
    static insertionSortY(a2) {
      for (let i = 1, l = a2.length; i < l; i++) {
        let v = a2[i], j;
        for (j = i - 1; j >= 0 && !(a2[j].aabb.lowerBound.y <= v.aabb.lowerBound.y); j--)
          a2[j + 1] = a2[j];
        a2[j + 1] = v;
      }
      return a2;
    }
    /**
     * insertionSortZ
     */
    static insertionSortZ(a2) {
      for (let i = 1, l = a2.length; i < l; i++) {
        let v = a2[i], j;
        for (j = i - 1; j >= 0 && !(a2[j].aabb.lowerBound.z <= v.aabb.lowerBound.z); j--)
          a2[j + 1] = a2[j];
        a2[j + 1] = v;
      }
      return a2;
    }
    constructor(world) {
      super(), this.axisList = [], this.world = null, this.axisIndex = 0;
      let axisList = this.axisList;
      this._addBodyHandler = (event) => {
        axisList.push(event.body);
      }, this._removeBodyHandler = (event) => {
        let idx = axisList.indexOf(event.body);
        idx !== -1 && axisList.splice(idx, 1);
      }, world && this.setWorld(world);
    }
    /**
     * Change the world
     */
    setWorld(world) {
      this.axisList.length = 0;
      for (let i = 0; i < world.bodies.length; i++)
        this.axisList.push(world.bodies[i]);
      world.removeEventListener("addBody", this._addBodyHandler), world.removeEventListener("removeBody", this._removeBodyHandler), world.addEventListener("addBody", this._addBodyHandler), world.addEventListener("removeBody", this._removeBodyHandler), this.world = world, this.dirty = !0;
    }
    /**
     * Collect all collision pairs
     */
    collisionPairs(world, p1, p2) {
      let bodies = this.axisList, N = bodies.length, axisIndex = this.axisIndex, i, j;
      for (this.dirty && (this.sortList(), this.dirty = !1), i = 0; i !== N; i++) {
        let bi = bodies[i];
        for (j = i + 1; j < N; j++) {
          let bj = bodies[j];
          if (this.needBroadphaseCollision(bi, bj)) {
            if (!_SAPBroadphase.checkBounds(bi, bj, axisIndex))
              break;
            this.intersectionTest(bi, bj, p1, p2);
          }
        }
      }
    }
    sortList() {
      let axisList = this.axisList, axisIndex = this.axisIndex, N = axisList.length;
      for (let i = 0; i !== N; i++) {
        let bi = axisList[i];
        bi.aabbNeedsUpdate && bi.updateAABB();
      }
      axisIndex === 0 ? _SAPBroadphase.insertionSortX(axisList) : axisIndex === 1 ? _SAPBroadphase.insertionSortY(axisList) : axisIndex === 2 && _SAPBroadphase.insertionSortZ(axisList);
    }
    /**
     * Computes the variance of the body positions and estimates the best axis to use.
     * Will automatically set property `axisIndex`.
     */
    autoDetectAxis() {
      let sumX = 0, sumX2 = 0, sumY = 0, sumY2 = 0, sumZ = 0, sumZ2 = 0, bodies = this.axisList, N = bodies.length, invN = 1 / N;
      for (let i = 0; i !== N; i++) {
        let b2 = bodies[i], centerX = b2.position.x;
        sumX += centerX, sumX2 += centerX * centerX;
        let centerY = b2.position.y;
        sumY += centerY, sumY2 += centerY * centerY;
        let centerZ = b2.position.z;
        sumZ += centerZ, sumZ2 += centerZ * centerZ;
      }
      let varianceX = sumX2 - sumX * sumX * invN, varianceY = sumY2 - sumY * sumY * invN, varianceZ = sumZ2 - sumZ * sumZ * invN;
      varianceX > varianceY ? varianceX > varianceZ ? this.axisIndex = 0 : this.axisIndex = 2 : varianceY > varianceZ ? this.axisIndex = 1 : this.axisIndex = 2;
    }
    /**
     * Returns all the bodies within an AABB.
     * @param result An array to store resulting bodies in.
     */
    aabbQuery(world, aabb, result) {
      result === void 0 && (result = []), this.dirty && (this.sortList(), this.dirty = !1);
      let axisIndex = this.axisIndex, axis = "x";
      axisIndex === 1 && (axis = "y"), axisIndex === 2 && (axis = "z");
      let axisList = this.axisList;
      aabb.lowerBound[axis], aabb.upperBound[axis];
      for (let i = 0; i < axisList.length; i++) {
        let b2 = axisList[i];
        b2.aabbNeedsUpdate && b2.updateAABB(), b2.aabb.overlaps(aabb) && result.push(b2);
      }
      return result;
    }
  }, Utils = class {
    /**
     * Extend an options object with default values.
     * @param options The options object. May be falsy: in this case, a new object is created and returned.
     * @param defaults An object containing default values.
     * @return The modified options object.
     */
    static defaults(options, defaults) {
      options === void 0 && (options = {});
      for (let key in defaults)
        key in options || (options[key] = defaults[key]);
      return options;
    }
  }, Constraint = class _Constraint {
    /**
     * Equations to be solved in this constraint.
     */
    /**
     * Body A.
     */
    /**
     * Body B.
     */
    /**
     * Set to false if you don't want the bodies to collide when they are connected.
     */
    constructor(bodyA, bodyB, options) {
      options === void 0 && (options = {}), options = Utils.defaults(options, {
        collideConnected: !0,
        wakeUpBodies: !0
      }), this.equations = [], this.bodyA = bodyA, this.bodyB = bodyB, this.id = _Constraint.idCounter++, this.collideConnected = options.collideConnected, options.wakeUpBodies && (bodyA && bodyA.wakeUp(), bodyB && bodyB.wakeUp());
    }
    /**
     * Update all the equations with data.
     */
    update() {
      throw new Error("method update() not implmemented in this Constraint subclass!");
    }
    /**
     * Enables all equations in the constraint.
     */
    enable() {
      let eqs = this.equations;
      for (let i = 0; i < eqs.length; i++)
        eqs[i].enabled = !0;
    }
    /**
     * Disables all equations in the constraint.
     */
    disable() {
      let eqs = this.equations;
      for (let i = 0; i < eqs.length; i++)
        eqs[i].enabled = !1;
    }
  };
  Constraint.idCounter = 0;
  var JacobianElement = class {
    /**
     * spatial
     */
    /**
     * rotational
     */
    constructor() {
      this.spatial = new Vec3(), this.rotational = new Vec3();
    }
    /**
     * Multiply with other JacobianElement
     */
    multiplyElement(element) {
      return element.spatial.dot(this.spatial) + element.rotational.dot(this.rotational);
    }
    /**
     * Multiply with two vectors
     */
    multiplyVectors(spatial, rotational) {
      return spatial.dot(this.spatial) + rotational.dot(this.rotational);
    }
  }, Equation = class _Equation {
    /**
     * Minimum (read: negative max) force to be applied by the constraint.
     */
    /**
     * Maximum (read: positive max) force to be applied by the constraint.
     */
    /**
     * SPOOK parameter
     */
    /**
     * SPOOK parameter
     */
    /**
     * SPOOK parameter
     */
    /**
     * A number, proportional to the force added to the bodies.
     */
    constructor(bi, bj, minForce, maxForce) {
      minForce === void 0 && (minForce = -1e6), maxForce === void 0 && (maxForce = 1e6), this.id = _Equation.idCounter++, this.minForce = minForce, this.maxForce = maxForce, this.bi = bi, this.bj = bj, this.a = 0, this.b = 0, this.eps = 0, this.jacobianElementA = new JacobianElement(), this.jacobianElementB = new JacobianElement(), this.enabled = !0, this.multiplier = 0, this.setSpookParams(1e7, 4, 1 / 60);
    }
    /**
     * Recalculates a, b, and eps.
     *
     * The Equation constructor sets typical SPOOK parameters as such:
     * * `stiffness` = 1e7
     * * `relaxation` = 4
     * * `timeStep`= 1 / 60, _note the hardcoded refresh rate._
     */
    setSpookParams(stiffness, relaxation, timeStep) {
      let d = relaxation, k = stiffness, h = timeStep;
      this.a = 4 / (h * (1 + 4 * d)), this.b = 4 * d / (1 + 4 * d), this.eps = 4 / (h * h * k * (1 + 4 * d));
    }
    /**
     * Computes the right hand side of the SPOOK equation
     */
    computeB(a2, b2, h) {
      let GW = this.computeGW(), Gq = this.computeGq(), GiMf = this.computeGiMf();
      return -Gq * a2 - GW * b2 - GiMf * h;
    }
    /**
     * Computes G*q, where q are the generalized body coordinates
     */
    computeGq() {
      let GA = this.jacobianElementA, GB = this.jacobianElementB, bi = this.bi, bj = this.bj, xi = bi.position, xj = bj.position;
      return GA.spatial.dot(xi) + GB.spatial.dot(xj);
    }
    /**
     * Computes G*W, where W are the body velocities
     */
    computeGW() {
      let GA = this.jacobianElementA, GB = this.jacobianElementB, bi = this.bi, bj = this.bj, vi = bi.velocity, vj = bj.velocity, wi = bi.angularVelocity, wj = bj.angularVelocity;
      return GA.multiplyVectors(vi, wi) + GB.multiplyVectors(vj, wj);
    }
    /**
     * Computes G*Wlambda, where W are the body velocities
     */
    computeGWlambda() {
      let GA = this.jacobianElementA, GB = this.jacobianElementB, bi = this.bi, bj = this.bj, vi = bi.vlambda, vj = bj.vlambda, wi = bi.wlambda, wj = bj.wlambda;
      return GA.multiplyVectors(vi, wi) + GB.multiplyVectors(vj, wj);
    }
    /**
     * Computes G*inv(M)*f, where M is the mass matrix with diagonal blocks for each body, and f are the forces on the bodies.
     */
    computeGiMf() {
      let GA = this.jacobianElementA, GB = this.jacobianElementB, bi = this.bi, bj = this.bj, fi = bi.force, ti = bi.torque, fj = bj.force, tj = bj.torque, invMassi = bi.invMassSolve, invMassj = bj.invMassSolve;
      return fi.scale(invMassi, iMfi), fj.scale(invMassj, iMfj), bi.invInertiaWorldSolve.vmult(ti, invIi_vmult_taui), bj.invInertiaWorldSolve.vmult(tj, invIj_vmult_tauj), GA.multiplyVectors(iMfi, invIi_vmult_taui) + GB.multiplyVectors(iMfj, invIj_vmult_tauj);
    }
    /**
     * Computes G*inv(M)*G'
     */
    computeGiMGt() {
      let GA = this.jacobianElementA, GB = this.jacobianElementB, bi = this.bi, bj = this.bj, invMassi = bi.invMassSolve, invMassj = bj.invMassSolve, invIi = bi.invInertiaWorldSolve, invIj = bj.invInertiaWorldSolve, result = invMassi + invMassj;
      return invIi.vmult(GA.rotational, tmp), result += tmp.dot(GA.rotational), invIj.vmult(GB.rotational, tmp), result += tmp.dot(GB.rotational), result;
    }
    /**
     * Add constraint velocity to the bodies.
     */
    addToWlambda(deltalambda) {
      let GA = this.jacobianElementA, GB = this.jacobianElementB, bi = this.bi, bj = this.bj, temp = addToWlambda_temp;
      bi.vlambda.addScaledVector(bi.invMassSolve * deltalambda, GA.spatial, bi.vlambda), bj.vlambda.addScaledVector(bj.invMassSolve * deltalambda, GB.spatial, bj.vlambda), bi.invInertiaWorldSolve.vmult(GA.rotational, temp), bi.wlambda.addScaledVector(deltalambda, temp, bi.wlambda), bj.invInertiaWorldSolve.vmult(GB.rotational, temp), bj.wlambda.addScaledVector(deltalambda, temp, bj.wlambda);
    }
    /**
     * Compute the denominator part of the SPOOK equation: C = G*inv(M)*G' + eps
     */
    computeC() {
      return this.computeGiMGt() + this.eps;
    }
  };
  Equation.idCounter = 0;
  var iMfi = new Vec3(), iMfj = new Vec3(), invIi_vmult_taui = new Vec3(), invIj_vmult_tauj = new Vec3(), tmp = new Vec3(), addToWlambda_temp = new Vec3(), ContactEquation = class extends Equation {
    /**
     * "bounciness": u1 = -e*u0
     */
    /**
     * World-oriented vector that goes from the center of bi to the contact point.
     */
    /**
     * World-oriented vector that starts in body j position and goes to the contact point.
     */
    /**
     * Contact normal, pointing out of body i.
     */
    constructor(bodyA, bodyB, maxForce) {
      maxForce === void 0 && (maxForce = 1e6), super(bodyA, bodyB, 0, maxForce), this.restitution = 0, this.ri = new Vec3(), this.rj = new Vec3(), this.ni = new Vec3();
    }
    computeB(h) {
      let a2 = this.a, b2 = this.b, bi = this.bi, bj = this.bj, ri = this.ri, rj = this.rj, rixn = ContactEquation_computeB_temp1, rjxn = ContactEquation_computeB_temp2, vi = bi.velocity, wi = bi.angularVelocity;
      bi.force, bi.torque;
      let vj = bj.velocity, wj = bj.angularVelocity;
      bj.force, bj.torque;
      let penetrationVec = ContactEquation_computeB_temp3, GA = this.jacobianElementA, GB = this.jacobianElementB, n = this.ni;
      ri.cross(n, rixn), rj.cross(n, rjxn), n.negate(GA.spatial), rixn.negate(GA.rotational), GB.spatial.copy(n), GB.rotational.copy(rjxn), penetrationVec.copy(bj.position), penetrationVec.vadd(rj, penetrationVec), penetrationVec.vsub(bi.position, penetrationVec), penetrationVec.vsub(ri, penetrationVec);
      let g = n.dot(penetrationVec), ePlusOne = this.restitution + 1, GW = ePlusOne * vj.dot(n) - ePlusOne * vi.dot(n) + wj.dot(rjxn) - wi.dot(rixn), GiMf = this.computeGiMf();
      return -g * a2 - GW * b2 - h * GiMf;
    }
    /**
     * Get the current relative velocity in the contact point.
     */
    getImpactVelocityAlongNormal() {
      let vi = ContactEquation_getImpactVelocityAlongNormal_vi, vj = ContactEquation_getImpactVelocityAlongNormal_vj, xi = ContactEquation_getImpactVelocityAlongNormal_xi, xj = ContactEquation_getImpactVelocityAlongNormal_xj, relVel = ContactEquation_getImpactVelocityAlongNormal_relVel;
      return this.bi.position.vadd(this.ri, xi), this.bj.position.vadd(this.rj, xj), this.bi.getVelocityAtWorldPoint(xi, vi), this.bj.getVelocityAtWorldPoint(xj, vj), vi.vsub(vj, relVel), this.ni.dot(relVel);
    }
  }, ContactEquation_computeB_temp1 = new Vec3(), ContactEquation_computeB_temp2 = new Vec3(), ContactEquation_computeB_temp3 = new Vec3(), ContactEquation_getImpactVelocityAlongNormal_vi = new Vec3(), ContactEquation_getImpactVelocityAlongNormal_vj = new Vec3(), ContactEquation_getImpactVelocityAlongNormal_xi = new Vec3(), ContactEquation_getImpactVelocityAlongNormal_xj = new Vec3(), ContactEquation_getImpactVelocityAlongNormal_relVel = new Vec3(), PointToPointConstraint = class extends Constraint {
    /**
     * Pivot, defined locally in bodyA.
     */
    /**
     * Pivot, defined locally in bodyB.
     */
    /**
     * @param pivotA The point relative to the center of mass of bodyA which bodyA is constrained to.
     * @param bodyB Body that will be constrained in a similar way to the same point as bodyA. We will therefore get a link between bodyA and bodyB. If not specified, bodyA will be constrained to a static point.
     * @param pivotB The point relative to the center of mass of bodyB which bodyB is constrained to.
     * @param maxForce The maximum force that should be applied to constrain the bodies.
     */
    constructor(bodyA, pivotA, bodyB, pivotB, maxForce) {
      pivotA === void 0 && (pivotA = new Vec3()), pivotB === void 0 && (pivotB = new Vec3()), maxForce === void 0 && (maxForce = 1e6), super(bodyA, bodyB), this.pivotA = pivotA.clone(), this.pivotB = pivotB.clone();
      let x = this.equationX = new ContactEquation(bodyA, bodyB), y = this.equationY = new ContactEquation(bodyA, bodyB), z = this.equationZ = new ContactEquation(bodyA, bodyB);
      this.equations.push(x, y, z), x.minForce = y.minForce = z.minForce = -maxForce, x.maxForce = y.maxForce = z.maxForce = maxForce, x.ni.set(1, 0, 0), y.ni.set(0, 1, 0), z.ni.set(0, 0, 1);
    }
    update() {
      let bodyA = this.bodyA, bodyB = this.bodyB, x = this.equationX, y = this.equationY, z = this.equationZ;
      bodyA.quaternion.vmult(this.pivotA, x.ri), bodyB.quaternion.vmult(this.pivotB, x.rj), y.ri.copy(x.ri), y.rj.copy(x.rj), z.ri.copy(x.ri), z.rj.copy(x.rj);
    }
  }, ConeEquation = class extends Equation {
    /**
     * Local axis in A
     */
    /**
     * Local axis in B
     */
    /**
     * The "cone angle" to keep
     */
    constructor(bodyA, bodyB, options) {
      options === void 0 && (options = {});
      let maxForce = typeof options.maxForce < "u" ? options.maxForce : 1e6;
      super(bodyA, bodyB, -maxForce, maxForce), this.axisA = options.axisA ? options.axisA.clone() : new Vec3(1, 0, 0), this.axisB = options.axisB ? options.axisB.clone() : new Vec3(0, 1, 0), this.angle = typeof options.angle < "u" ? options.angle : 0;
    }
    computeB(h) {
      let a2 = this.a, b2 = this.b, ni = this.axisA, nj = this.axisB, nixnj = tmpVec1$2, njxni = tmpVec2$2, GA = this.jacobianElementA, GB = this.jacobianElementB;
      ni.cross(nj, nixnj), nj.cross(ni, njxni), GA.rotational.copy(njxni), GB.rotational.copy(nixnj);
      let g = Math.cos(this.angle) - ni.dot(nj), GW = this.computeGW(), GiMf = this.computeGiMf();
      return -g * a2 - GW * b2 - h * GiMf;
    }
  }, tmpVec1$2 = new Vec3(), tmpVec2$2 = new Vec3(), RotationalEquation = class extends Equation {
    /**
     * World oriented rotational axis.
     */
    /**
     * World oriented rotational axis.
     */
    /**
     * maxAngle
     */
    constructor(bodyA, bodyB, options) {
      options === void 0 && (options = {});
      let maxForce = typeof options.maxForce < "u" ? options.maxForce : 1e6;
      super(bodyA, bodyB, -maxForce, maxForce), this.axisA = options.axisA ? options.axisA.clone() : new Vec3(1, 0, 0), this.axisB = options.axisB ? options.axisB.clone() : new Vec3(0, 1, 0), this.maxAngle = Math.PI / 2;
    }
    computeB(h) {
      let a2 = this.a, b2 = this.b, ni = this.axisA, nj = this.axisB, nixnj = tmpVec1$1, njxni = tmpVec2$1, GA = this.jacobianElementA, GB = this.jacobianElementB;
      ni.cross(nj, nixnj), nj.cross(ni, njxni), GA.rotational.copy(njxni), GB.rotational.copy(nixnj);
      let g = Math.cos(this.maxAngle) - ni.dot(nj), GW = this.computeGW(), GiMf = this.computeGiMf();
      return -g * a2 - GW * b2 - h * GiMf;
    }
  }, tmpVec1$1 = new Vec3(), tmpVec2$1 = new Vec3(), ConeTwistConstraint = class extends PointToPointConstraint {
    /**
     * The axis direction for the constraint of the body A.
     */
    /**
     * The axis direction for the constraint of the body B.
     */
    /**
     * The aperture angle of the cone.
     */
    /**
     * The twist angle of the joint.
     */
    constructor(bodyA, bodyB, options) {
      options === void 0 && (options = {});
      let maxForce = typeof options.maxForce < "u" ? options.maxForce : 1e6, pivotA = options.pivotA ? options.pivotA.clone() : new Vec3(), pivotB = options.pivotB ? options.pivotB.clone() : new Vec3();
      super(bodyA, pivotA, bodyB, pivotB, maxForce), this.axisA = options.axisA ? options.axisA.clone() : new Vec3(), this.axisB = options.axisB ? options.axisB.clone() : new Vec3(), this.collideConnected = !!options.collideConnected, this.angle = typeof options.angle < "u" ? options.angle : 0;
      let c2 = this.coneEquation = new ConeEquation(bodyA, bodyB, options), t = this.twistEquation = new RotationalEquation(bodyA, bodyB, options);
      this.twistAngle = typeof options.twistAngle < "u" ? options.twistAngle : 0, c2.maxForce = 0, c2.minForce = -maxForce, t.maxForce = 0, t.minForce = -maxForce, this.equations.push(c2, t);
    }
    update() {
      let bodyA = this.bodyA, bodyB = this.bodyB, cone = this.coneEquation, twist = this.twistEquation;
      super.update(), bodyA.vectorToWorldFrame(this.axisA, cone.axisA), bodyB.vectorToWorldFrame(this.axisB, cone.axisB), this.axisA.tangents(twist.axisA, twist.axisA), bodyA.vectorToWorldFrame(twist.axisA, twist.axisA), this.axisB.tangents(twist.axisB, twist.axisB), bodyB.vectorToWorldFrame(twist.axisB, twist.axisB), cone.angle = this.angle, twist.maxAngle = this.twistAngle;
    }
  };
  new Vec3();
  new Vec3();
  var DistanceConstraint = class extends Constraint {
    /**
     * The distance to keep. If undefined, it will be set to the current distance between bodyA and bodyB
     */
    /**
     * @param distance The distance to keep. If undefined, it will be set to the current distance between bodyA and bodyB.
     * @param maxForce The maximum force that should be applied to constrain the bodies.
     */
    constructor(bodyA, bodyB, distance, maxForce) {
      maxForce === void 0 && (maxForce = 1e6), super(bodyA, bodyB), typeof distance > "u" && (distance = bodyA.position.distanceTo(bodyB.position)), this.distance = distance;
      let eq = this.distanceEquation = new ContactEquation(bodyA, bodyB);
      this.equations.push(eq), eq.minForce = -maxForce, eq.maxForce = maxForce;
    }
    /**
     * update
     */
    update() {
      let bodyA = this.bodyA, bodyB = this.bodyB, eq = this.distanceEquation, halfDist = this.distance * 0.5, normal = eq.ni;
      bodyB.position.vsub(bodyA.position, normal), normal.normalize(), normal.scale(halfDist, eq.ri), normal.scale(-halfDist, eq.rj);
    }
  }, LockConstraint = class extends PointToPointConstraint {
    constructor(bodyA, bodyB, options) {
      options === void 0 && (options = {});
      let maxForce = typeof options.maxForce < "u" ? options.maxForce : 1e6, pivotA = new Vec3(), pivotB = new Vec3(), halfWay = new Vec3();
      bodyA.position.vadd(bodyB.position, halfWay), halfWay.scale(0.5, halfWay), bodyB.pointToLocalFrame(halfWay, pivotB), bodyA.pointToLocalFrame(halfWay, pivotA), super(bodyA, pivotA, bodyB, pivotB, maxForce), this.xA = bodyA.vectorToLocalFrame(Vec3.UNIT_X), this.xB = bodyB.vectorToLocalFrame(Vec3.UNIT_X), this.yA = bodyA.vectorToLocalFrame(Vec3.UNIT_Y), this.yB = bodyB.vectorToLocalFrame(Vec3.UNIT_Y), this.zA = bodyA.vectorToLocalFrame(Vec3.UNIT_Z), this.zB = bodyB.vectorToLocalFrame(Vec3.UNIT_Z);
      let r1 = this.rotationalEquation1 = new RotationalEquation(bodyA, bodyB, options), r2 = this.rotationalEquation2 = new RotationalEquation(bodyA, bodyB, options), r3 = this.rotationalEquation3 = new RotationalEquation(bodyA, bodyB, options);
      this.equations.push(r1, r2, r3);
    }
    /**
     * update
     */
    update() {
      let bodyA = this.bodyA, bodyB = this.bodyB;
      this.motorEquation;
      let r1 = this.rotationalEquation1, r2 = this.rotationalEquation2, r3 = this.rotationalEquation3;
      super.update(), bodyA.vectorToWorldFrame(this.xA, r1.axisA), bodyB.vectorToWorldFrame(this.yB, r1.axisB), bodyA.vectorToWorldFrame(this.yA, r2.axisA), bodyB.vectorToWorldFrame(this.zB, r2.axisB), bodyA.vectorToWorldFrame(this.zA, r3.axisA), bodyB.vectorToWorldFrame(this.xB, r3.axisB);
    }
  }, LockConstraint_update_tmpVec1 = new Vec3(), LockConstraint_update_tmpVec2 = new Vec3(), RotationalMotorEquation = class extends Equation {
    /**
     * World oriented rotational axis.
     */
    /**
     * World oriented rotational axis.
     */
    /**
     * Motor velocity.
     */
    constructor(bodyA, bodyB, maxForce) {
      maxForce === void 0 && (maxForce = 1e6), super(bodyA, bodyB, -maxForce, maxForce), this.axisA = new Vec3(), this.axisB = new Vec3(), this.targetVelocity = 0;
    }
    computeB(h) {
      this.a;
      let b2 = this.b;
      this.bi, this.bj;
      let axisA = this.axisA, axisB = this.axisB, GA = this.jacobianElementA, GB = this.jacobianElementB;
      GA.rotational.copy(axisA), axisB.negate(GB.rotational);
      let GW = this.computeGW() - this.targetVelocity, GiMf = this.computeGiMf();
      return -GW * b2 - h * GiMf;
    }
  }, HingeConstraint = class extends PointToPointConstraint {
    /**
     * Rotation axis, defined locally in bodyA.
     */
    /**
     * Rotation axis, defined locally in bodyB.
     */
    constructor(bodyA, bodyB, options) {
      options === void 0 && (options = {});
      let maxForce = typeof options.maxForce < "u" ? options.maxForce : 1e6, pivotA = options.pivotA ? options.pivotA.clone() : new Vec3(), pivotB = options.pivotB ? options.pivotB.clone() : new Vec3();
      super(bodyA, pivotA, bodyB, pivotB, maxForce), (this.axisA = options.axisA ? options.axisA.clone() : new Vec3(1, 0, 0)).normalize(), (this.axisB = options.axisB ? options.axisB.clone() : new Vec3(1, 0, 0)).normalize(), this.collideConnected = !!options.collideConnected;
      let rotational1 = this.rotationalEquation1 = new RotationalEquation(bodyA, bodyB, options), rotational2 = this.rotationalEquation2 = new RotationalEquation(bodyA, bodyB, options), motor = this.motorEquation = new RotationalMotorEquation(bodyA, bodyB, maxForce);
      motor.enabled = !1, this.equations.push(rotational1, rotational2, motor);
    }
    /**
     * enableMotor
     */
    enableMotor() {
      this.motorEquation.enabled = !0;
    }
    /**
     * disableMotor
     */
    disableMotor() {
      this.motorEquation.enabled = !1;
    }
    /**
     * setMotorSpeed
     */
    setMotorSpeed(speed) {
      this.motorEquation.targetVelocity = speed;
    }
    /**
     * setMotorMaxForce
     */
    setMotorMaxForce(maxForce) {
      this.motorEquation.maxForce = maxForce, this.motorEquation.minForce = -maxForce;
    }
    /**
     * update
     */
    update() {
      let bodyA = this.bodyA, bodyB = this.bodyB, motor = this.motorEquation, r1 = this.rotationalEquation1, r2 = this.rotationalEquation2, worldAxisA = HingeConstraint_update_tmpVec1, worldAxisB = HingeConstraint_update_tmpVec2, axisA = this.axisA, axisB = this.axisB;
      super.update(), bodyA.quaternion.vmult(axisA, worldAxisA), bodyB.quaternion.vmult(axisB, worldAxisB), worldAxisA.tangents(r1.axisA, r2.axisA), r1.axisB.copy(worldAxisB), r2.axisB.copy(worldAxisB), this.motorEquation.enabled && (bodyA.quaternion.vmult(this.axisA, motor.axisA), bodyB.quaternion.vmult(this.axisB, motor.axisB));
    }
  }, HingeConstraint_update_tmpVec1 = new Vec3(), HingeConstraint_update_tmpVec2 = new Vec3(), FrictionEquation = class extends Equation {
    // Tangent
    /**
     * @param slipForce should be +-F_friction = +-mu * F_normal = +-mu * m * g
     */
    constructor(bodyA, bodyB, slipForce) {
      super(bodyA, bodyB, -slipForce, slipForce), this.ri = new Vec3(), this.rj = new Vec3(), this.t = new Vec3();
    }
    computeB(h) {
      this.a;
      let b2 = this.b;
      this.bi, this.bj;
      let ri = this.ri, rj = this.rj, rixt = FrictionEquation_computeB_temp1, rjxt = FrictionEquation_computeB_temp2, t = this.t;
      ri.cross(t, rixt), rj.cross(t, rjxt);
      let GA = this.jacobianElementA, GB = this.jacobianElementB;
      t.negate(GA.spatial), rixt.negate(GA.rotational), GB.spatial.copy(t), GB.rotational.copy(rjxt);
      let GW = this.computeGW(), GiMf = this.computeGiMf();
      return -GW * b2 - h * GiMf;
    }
  }, FrictionEquation_computeB_temp1 = new Vec3(), FrictionEquation_computeB_temp2 = new Vec3(), ContactMaterial = class _ContactMaterial {
    /**
     * Identifier of this material.
     */
    /**
     * Participating materials.
     */
    /**
     * Friction coefficient.
     * @default 0.3
     */
    /**
     * Restitution coefficient.
     * @default 0.3
     */
    /**
     * Stiffness of the produced contact equations.
     * @default 1e7
     */
    /**
     * Relaxation time of the produced contact equations.
     * @default 3
     */
    /**
     * Stiffness of the produced friction equations.
     * @default 1e7
     */
    /**
     * Relaxation time of the produced friction equations
     * @default 3
     */
    constructor(m1, m2, options) {
      options = Utils.defaults(options, {
        friction: 0.3,
        restitution: 0.3,
        contactEquationStiffness: 1e7,
        contactEquationRelaxation: 3,
        frictionEquationStiffness: 1e7,
        frictionEquationRelaxation: 3
      }), this.id = _ContactMaterial.idCounter++, this.materials = [m1, m2], this.friction = options.friction, this.restitution = options.restitution, this.contactEquationStiffness = options.contactEquationStiffness, this.contactEquationRelaxation = options.contactEquationRelaxation, this.frictionEquationStiffness = options.frictionEquationStiffness, this.frictionEquationRelaxation = options.frictionEquationRelaxation;
    }
  };
  ContactMaterial.idCounter = 0;
  var Material = class _Material {
    /**
     * Material name.
     * If options is a string, name will be set to that string.
     * @todo Deprecate this
     */
    /** Material id. */
    /**
     * Friction for this material.
     * If non-negative, it will be used instead of the friction given by ContactMaterials. If there's no matching ContactMaterial, the value from `defaultContactMaterial` in the World will be used.
     */
    /**
     * Restitution for this material.
     * If non-negative, it will be used instead of the restitution given by ContactMaterials. If there's no matching ContactMaterial, the value from `defaultContactMaterial` in the World will be used.
     */
    constructor(options) {
      options === void 0 && (options = {});
      let name = "";
      typeof options == "string" && (name = options, options = {}), this.name = name, this.id = _Material.idCounter++, this.friction = typeof options.friction < "u" ? options.friction : -1, this.restitution = typeof options.restitution < "u" ? options.restitution : -1;
    }
  };
  Material.idCounter = 0;
  var Spring = class {
    /**
     * Rest length of the spring. A number > 0.
     * @default 1
     */
    /**
     * Stiffness of the spring. A number >= 0.
     * @default 100
     */
    /**
     * Damping of the spring. A number >= 0.
     * @default 1
     */
    /**
     * First connected body.
     */
    /**
     * Second connected body.
     */
    /**
     * Anchor for bodyA in local bodyA coordinates.
     * Where to hook the spring to body A, in local body coordinates.
     * @default new Vec3()
     */
    /**
     * Anchor for bodyB in local bodyB coordinates.
     * Where to hook the spring to body B, in local body coordinates.
     * @default new Vec3()
     */
    constructor(bodyA, bodyB, options) {
      options === void 0 && (options = {}), this.restLength = typeof options.restLength == "number" ? options.restLength : 1, this.stiffness = options.stiffness || 100, this.damping = options.damping || 1, this.bodyA = bodyA, this.bodyB = bodyB, this.localAnchorA = new Vec3(), this.localAnchorB = new Vec3(), options.localAnchorA && this.localAnchorA.copy(options.localAnchorA), options.localAnchorB && this.localAnchorB.copy(options.localAnchorB), options.worldAnchorA && this.setWorldAnchorA(options.worldAnchorA), options.worldAnchorB && this.setWorldAnchorB(options.worldAnchorB);
    }
    /**
     * Set the anchor point on body A, using world coordinates.
     */
    setWorldAnchorA(worldAnchorA) {
      this.bodyA.pointToLocalFrame(worldAnchorA, this.localAnchorA);
    }
    /**
     * Set the anchor point on body B, using world coordinates.
     */
    setWorldAnchorB(worldAnchorB) {
      this.bodyB.pointToLocalFrame(worldAnchorB, this.localAnchorB);
    }
    /**
     * Get the anchor point on body A, in world coordinates.
     * @param result The vector to store the result in.
     */
    getWorldAnchorA(result) {
      this.bodyA.pointToWorldFrame(this.localAnchorA, result);
    }
    /**
     * Get the anchor point on body B, in world coordinates.
     * @param result The vector to store the result in.
     */
    getWorldAnchorB(result) {
      this.bodyB.pointToWorldFrame(this.localAnchorB, result);
    }
    /**
     * Apply the spring force to the connected bodies.
     */
    applyForce() {
      let k = this.stiffness, d = this.damping, l = this.restLength, bodyA = this.bodyA, bodyB = this.bodyB, r = applyForce_r, r_unit = applyForce_r_unit, u = applyForce_u, f = applyForce_f, tmp2 = applyForce_tmp, worldAnchorA = applyForce_worldAnchorA, worldAnchorB = applyForce_worldAnchorB, ri = applyForce_ri, rj = applyForce_rj, ri_x_f = applyForce_ri_x_f, rj_x_f = applyForce_rj_x_f;
      this.getWorldAnchorA(worldAnchorA), this.getWorldAnchorB(worldAnchorB), worldAnchorA.vsub(bodyA.position, ri), worldAnchorB.vsub(bodyB.position, rj), worldAnchorB.vsub(worldAnchorA, r);
      let rlen = r.length();
      r_unit.copy(r), r_unit.normalize(), bodyB.velocity.vsub(bodyA.velocity, u), bodyB.angularVelocity.cross(rj, tmp2), u.vadd(tmp2, u), bodyA.angularVelocity.cross(ri, tmp2), u.vsub(tmp2, u), r_unit.scale(-k * (rlen - l) - d * u.dot(r_unit), f), bodyA.force.vsub(f, bodyA.force), bodyB.force.vadd(f, bodyB.force), ri.cross(f, ri_x_f), rj.cross(f, rj_x_f), bodyA.torque.vsub(ri_x_f, bodyA.torque), bodyB.torque.vadd(rj_x_f, bodyB.torque);
    }
  }, applyForce_r = new Vec3(), applyForce_r_unit = new Vec3(), applyForce_u = new Vec3(), applyForce_f = new Vec3(), applyForce_worldAnchorA = new Vec3(), applyForce_worldAnchorB = new Vec3(), applyForce_ri = new Vec3(), applyForce_rj = new Vec3(), applyForce_ri_x_f = new Vec3(), applyForce_rj_x_f = new Vec3(), applyForce_tmp = new Vec3(), WheelInfo = class {
    /**
     * Max travel distance of the suspension, in meters.
     * @default 1
     */
    /**
     * Speed to apply to the wheel rotation when the wheel is sliding.
     * @default -0.1
     */
    /**
     * If the customSlidingRotationalSpeed should be used.
     * @default false
     */
    /**
     * sliding
     */
    /**
     * Connection point, defined locally in the chassis body frame.
     */
    /**
     * chassisConnectionPointWorld
     */
    /**
     * directionLocal
     */
    /**
     * directionWorld
     */
    /**
     * axleLocal
     */
    /**
     * axleWorld
     */
    /**
     * suspensionRestLength
     * @default 1
     */
    /**
     * suspensionMaxLength
     * @default 2
     */
    /**
     * radius
     * @default 1
     */
    /**
     * suspensionStiffness
     * @default 100
     */
    /**
     * dampingCompression
     * @default 10
     */
    /**
     * dampingRelaxation
     * @default 10
     */
    /**
     * frictionSlip
     * @default 10.5
     */
    /** forwardAcceleration */
    /** sideAcceleration */
    /**
     * steering
     * @default 0
     */
    /**
     * Rotation value, in radians.
     * @default 0
     */
    /**
     * deltaRotation
     * @default 0
     */
    /**
     * rollInfluence
     * @default 0.01
     */
    /**
     * maxSuspensionForce
     */
    /**
     * engineForce
     */
    /**
     * brake
     */
    /**
     * isFrontWheel
     * @default true
     */
    /**
     * clippedInvContactDotSuspension
     * @default 1
     */
    /**
     * suspensionRelativeVelocity
     * @default 0
     */
    /**
     * suspensionForce
     * @default 0
     */
    /**
     * slipInfo
     */
    /**
     * skidInfo
     * @default 0
     */
    /**
     * suspensionLength
     * @default 0
     */
    /**
     * sideImpulse
     */
    /**
     * forwardImpulse
     */
    /**
     * The result from raycasting.
     */
    /**
     * Wheel world transform.
     */
    /**
     * isInContact
     */
    constructor(options) {
      options === void 0 && (options = {}), options = Utils.defaults(options, {
        chassisConnectionPointLocal: new Vec3(),
        chassisConnectionPointWorld: new Vec3(),
        directionLocal: new Vec3(),
        directionWorld: new Vec3(),
        axleLocal: new Vec3(),
        axleWorld: new Vec3(),
        suspensionRestLength: 1,
        suspensionMaxLength: 2,
        radius: 1,
        suspensionStiffness: 100,
        dampingCompression: 10,
        dampingRelaxation: 10,
        frictionSlip: 10.5,
        forwardAcceleration: 1,
        sideAcceleration: 1,
        steering: 0,
        rotation: 0,
        deltaRotation: 0,
        rollInfluence: 0.01,
        maxSuspensionForce: Number.MAX_VALUE,
        isFrontWheel: !0,
        clippedInvContactDotSuspension: 1,
        suspensionRelativeVelocity: 0,
        suspensionForce: 0,
        slipInfo: 0,
        skidInfo: 0,
        suspensionLength: 0,
        maxSuspensionTravel: 1,
        useCustomSlidingRotationalSpeed: !1,
        customSlidingRotationalSpeed: -0.1
      }), this.maxSuspensionTravel = options.maxSuspensionTravel, this.customSlidingRotationalSpeed = options.customSlidingRotationalSpeed, this.useCustomSlidingRotationalSpeed = options.useCustomSlidingRotationalSpeed, this.sliding = !1, this.chassisConnectionPointLocal = options.chassisConnectionPointLocal.clone(), this.chassisConnectionPointWorld = options.chassisConnectionPointWorld.clone(), this.directionLocal = options.directionLocal.clone(), this.directionWorld = options.directionWorld.clone(), this.axleLocal = options.axleLocal.clone(), this.axleWorld = options.axleWorld.clone(), this.suspensionRestLength = options.suspensionRestLength, this.suspensionMaxLength = options.suspensionMaxLength, this.radius = options.radius, this.suspensionStiffness = options.suspensionStiffness, this.dampingCompression = options.dampingCompression, this.dampingRelaxation = options.dampingRelaxation, this.frictionSlip = options.frictionSlip, this.forwardAcceleration = options.forwardAcceleration, this.sideAcceleration = options.sideAcceleration, this.steering = 0, this.rotation = 0, this.deltaRotation = 0, this.rollInfluence = options.rollInfluence, this.maxSuspensionForce = options.maxSuspensionForce, this.engineForce = 0, this.brake = 0, this.isFrontWheel = options.isFrontWheel, this.clippedInvContactDotSuspension = 1, this.suspensionRelativeVelocity = 0, this.suspensionForce = 0, this.slipInfo = 0, this.skidInfo = 0, this.suspensionLength = 0, this.sideImpulse = 0, this.forwardImpulse = 0, this.raycastResult = new RaycastResult(), this.worldTransform = new Transform(), this.isInContact = !1;
    }
    updateWheel(chassis) {
      let raycastResult = this.raycastResult;
      if (this.isInContact) {
        let project = raycastResult.hitNormalWorld.dot(raycastResult.directionWorld);
        raycastResult.hitPointWorld.vsub(chassis.position, relpos), chassis.getVelocityAtWorldPoint(relpos, chassis_velocity_at_contactPoint);
        let projVel = raycastResult.hitNormalWorld.dot(chassis_velocity_at_contactPoint);
        if (project >= -0.1)
          this.suspensionRelativeVelocity = 0, this.clippedInvContactDotSuspension = 1 / 0.1;
        else {
          let inv = -1 / project;
          this.suspensionRelativeVelocity = projVel * inv, this.clippedInvContactDotSuspension = inv;
        }
      } else
        raycastResult.suspensionLength = this.suspensionRestLength, this.suspensionRelativeVelocity = 0, raycastResult.directionWorld.scale(-1, raycastResult.hitNormalWorld), this.clippedInvContactDotSuspension = 1;
    }
  }, chassis_velocity_at_contactPoint = new Vec3(), relpos = new Vec3(), RaycastVehicle = class {
    /** The car chassis body. */
    /** The wheels. */
    /** Will be set to true if the car is sliding. */
    /** Index of the right axis. x=0, y=1, z=2 */
    /** Index of the forward axis. x=0, y=1, z=2 */
    /** Index of the up axis. x=0, y=1, z=2 */
    /** The constraints. */
    /** Optional pre-step callback. */
    /** Number of wheels on the ground. */
    constructor(options) {
      this.chassisBody = options.chassisBody, this.wheelInfos = [], this.sliding = !1, this.world = null, this.indexRightAxis = typeof options.indexRightAxis < "u" ? options.indexRightAxis : 2, this.indexForwardAxis = typeof options.indexForwardAxis < "u" ? options.indexForwardAxis : 0, this.indexUpAxis = typeof options.indexUpAxis < "u" ? options.indexUpAxis : 1, this.constraints = [], this.preStepCallback = () => {
      }, this.currentVehicleSpeedKmHour = 0, this.numWheelsOnGround = 0;
    }
    /**
     * Add a wheel. For information about the options, see `WheelInfo`.
     */
    addWheel(options) {
      options === void 0 && (options = {});
      let info = new WheelInfo(options), index = this.wheelInfos.length;
      return this.wheelInfos.push(info), index;
    }
    /**
     * Set the steering value of a wheel.
     */
    setSteeringValue(value, wheelIndex) {
      let wheel = this.wheelInfos[wheelIndex];
      wheel.steering = value;
    }
    /**
     * Set the wheel force to apply on one of the wheels each time step
     */
    applyEngineForce(value, wheelIndex) {
      this.wheelInfos[wheelIndex].engineForce = value;
    }
    /**
     * Set the braking force of a wheel
     */
    setBrake(brake, wheelIndex) {
      this.wheelInfos[wheelIndex].brake = brake;
    }
    /**
     * Add the vehicle including its constraints to the world.
     */
    addToWorld(world) {
      world.addBody(this.chassisBody);
      let that = this;
      this.preStepCallback = () => {
        that.updateVehicle(world.dt);
      }, world.addEventListener("preStep", this.preStepCallback), this.world = world;
    }
    /**
     * Get one of the wheel axles, world-oriented.
     */
    getVehicleAxisWorld(axisIndex, result) {
      result.set(axisIndex === 0 ? 1 : 0, axisIndex === 1 ? 1 : 0, axisIndex === 2 ? 1 : 0), this.chassisBody.vectorToWorldFrame(result, result);
    }
    updateVehicle(timeStep) {
      let wheelInfos = this.wheelInfos, numWheels = wheelInfos.length, chassisBody = this.chassisBody;
      for (let i = 0; i < numWheels; i++)
        this.updateWheelTransform(i);
      this.currentVehicleSpeedKmHour = 3.6 * chassisBody.velocity.length();
      let forwardWorld = new Vec3();
      this.getVehicleAxisWorld(this.indexForwardAxis, forwardWorld), forwardWorld.dot(chassisBody.velocity) < 0 && (this.currentVehicleSpeedKmHour *= -1);
      for (let i = 0; i < numWheels; i++)
        this.castRay(wheelInfos[i]);
      this.updateSuspension(timeStep);
      let impulse = new Vec3(), relpos2 = new Vec3();
      for (let i = 0; i < numWheels; i++) {
        let wheel = wheelInfos[i], suspensionForce = wheel.suspensionForce;
        suspensionForce > wheel.maxSuspensionForce && (suspensionForce = wheel.maxSuspensionForce), wheel.raycastResult.hitNormalWorld.scale(suspensionForce * timeStep, impulse), wheel.raycastResult.hitPointWorld.vsub(chassisBody.position, relpos2), chassisBody.applyImpulse(impulse, relpos2);
      }
      this.updateFriction(timeStep);
      let hitNormalWorldScaledWithProj = new Vec3(), fwd = new Vec3(), vel = new Vec3();
      for (let i = 0; i < numWheels; i++) {
        let wheel = wheelInfos[i];
        chassisBody.getVelocityAtWorldPoint(wheel.chassisConnectionPointWorld, vel);
        let m = 1;
        if (this.indexUpAxis === 1 && (m = -1), wheel.isInContact) {
          this.getVehicleAxisWorld(this.indexForwardAxis, fwd);
          let proj = fwd.dot(wheel.raycastResult.hitNormalWorld);
          wheel.raycastResult.hitNormalWorld.scale(proj, hitNormalWorldScaledWithProj), fwd.vsub(hitNormalWorldScaledWithProj, fwd);
          let proj2 = fwd.dot(vel);
          wheel.deltaRotation = m * proj2 * timeStep / wheel.radius;
        }
        (wheel.sliding || !wheel.isInContact) && wheel.engineForce !== 0 && wheel.useCustomSlidingRotationalSpeed && (wheel.deltaRotation = (wheel.engineForce > 0 ? 1 : -1) * wheel.customSlidingRotationalSpeed * timeStep), Math.abs(wheel.brake) > Math.abs(wheel.engineForce) && (wheel.deltaRotation = 0), wheel.rotation += wheel.deltaRotation, wheel.deltaRotation *= 0.99;
      }
    }
    updateSuspension(deltaTime) {
      let chassisMass = this.chassisBody.mass, wheelInfos = this.wheelInfos, numWheels = wheelInfos.length;
      for (let w_it = 0; w_it < numWheels; w_it++) {
        let wheel = wheelInfos[w_it];
        if (wheel.isInContact) {
          let force, susp_length = wheel.suspensionRestLength, current_length = wheel.suspensionLength, length_diff = susp_length - current_length;
          force = wheel.suspensionStiffness * length_diff * wheel.clippedInvContactDotSuspension;
          let projected_rel_vel = wheel.suspensionRelativeVelocity, susp_damping;
          projected_rel_vel < 0 ? susp_damping = wheel.dampingCompression : susp_damping = wheel.dampingRelaxation, force -= susp_damping * projected_rel_vel, wheel.suspensionForce = force * chassisMass, wheel.suspensionForce < 0 && (wheel.suspensionForce = 0);
        } else
          wheel.suspensionForce = 0;
      }
    }
    /**
     * Remove the vehicle including its constraints from the world.
     */
    removeFromWorld(world) {
      this.constraints, world.removeBody(this.chassisBody), world.removeEventListener("preStep", this.preStepCallback), this.world = null;
    }
    castRay(wheel) {
      let rayvector = castRay_rayvector, target = castRay_target;
      this.updateWheelTransformWorld(wheel);
      let chassisBody = this.chassisBody, depth = -1, raylen = wheel.suspensionRestLength + wheel.radius;
      wheel.directionWorld.scale(raylen, rayvector);
      let source = wheel.chassisConnectionPointWorld;
      source.vadd(rayvector, target);
      let raycastResult = wheel.raycastResult;
      raycastResult.reset();
      let oldState = chassisBody.collisionResponse;
      chassisBody.collisionResponse = !1, this.world.rayTest(source, target, raycastResult), chassisBody.collisionResponse = oldState;
      let object = raycastResult.body;
      if (wheel.raycastResult.groundObject = 0, object) {
        depth = raycastResult.distance, wheel.raycastResult.hitNormalWorld = raycastResult.hitNormalWorld, wheel.isInContact = !0;
        let hitDistance = raycastResult.distance;
        wheel.suspensionLength = hitDistance - wheel.radius;
        let minSuspensionLength = wheel.suspensionRestLength - wheel.maxSuspensionTravel, maxSuspensionLength = wheel.suspensionRestLength + wheel.maxSuspensionTravel;
        wheel.suspensionLength < minSuspensionLength && (wheel.suspensionLength = minSuspensionLength), wheel.suspensionLength > maxSuspensionLength && (wheel.suspensionLength = maxSuspensionLength, wheel.raycastResult.reset());
        let denominator = wheel.raycastResult.hitNormalWorld.dot(wheel.directionWorld), chassis_velocity_at_contactPoint2 = new Vec3();
        chassisBody.getVelocityAtWorldPoint(wheel.raycastResult.hitPointWorld, chassis_velocity_at_contactPoint2);
        let projVel = wheel.raycastResult.hitNormalWorld.dot(chassis_velocity_at_contactPoint2);
        if (denominator >= -0.1)
          wheel.suspensionRelativeVelocity = 0, wheel.clippedInvContactDotSuspension = 1 / 0.1;
        else {
          let inv = -1 / denominator;
          wheel.suspensionRelativeVelocity = projVel * inv, wheel.clippedInvContactDotSuspension = inv;
        }
      } else
        wheel.suspensionLength = wheel.suspensionRestLength + 0 * wheel.maxSuspensionTravel, wheel.suspensionRelativeVelocity = 0, wheel.directionWorld.scale(-1, wheel.raycastResult.hitNormalWorld), wheel.clippedInvContactDotSuspension = 1;
      return depth;
    }
    updateWheelTransformWorld(wheel) {
      wheel.isInContact = !1;
      let chassisBody = this.chassisBody;
      chassisBody.pointToWorldFrame(wheel.chassisConnectionPointLocal, wheel.chassisConnectionPointWorld), chassisBody.vectorToWorldFrame(wheel.directionLocal, wheel.directionWorld), chassisBody.vectorToWorldFrame(wheel.axleLocal, wheel.axleWorld);
    }
    /**
     * Update one of the wheel transform.
     * Note when rendering wheels: during each step, wheel transforms are updated BEFORE the chassis; ie. their position becomes invalid after the step. Thus when you render wheels, you must update wheel transforms before rendering them. See raycastVehicle demo for an example.
     * @param wheelIndex The wheel index to update.
     */
    updateWheelTransform(wheelIndex) {
      let up = tmpVec4, right = tmpVec5, fwd = tmpVec6, wheel = this.wheelInfos[wheelIndex];
      this.updateWheelTransformWorld(wheel), wheel.directionLocal.scale(-1, up), right.copy(wheel.axleLocal), up.cross(right, fwd), fwd.normalize(), right.normalize();
      let steering = wheel.steering, steeringOrn = new Quaternion();
      steeringOrn.setFromAxisAngle(up, steering);
      let rotatingOrn = new Quaternion();
      rotatingOrn.setFromAxisAngle(right, wheel.rotation);
      let q = wheel.worldTransform.quaternion;
      this.chassisBody.quaternion.mult(steeringOrn, q), q.mult(rotatingOrn, q), q.normalize();
      let p = wheel.worldTransform.position;
      p.copy(wheel.directionWorld), p.scale(wheel.suspensionLength, p), p.vadd(wheel.chassisConnectionPointWorld, p);
    }
    /**
     * Get the world transform of one of the wheels
     */
    getWheelTransformWorld(wheelIndex) {
      return this.wheelInfos[wheelIndex].worldTransform;
    }
    updateFriction(timeStep) {
      let surfNormalWS_scaled_proj = updateFriction_surfNormalWS_scaled_proj, wheelInfos = this.wheelInfos, numWheels = wheelInfos.length, chassisBody = this.chassisBody, forwardWS = updateFriction_forwardWS, axle = updateFriction_axle;
      this.numWheelsOnGround = 0;
      for (let i = 0; i < numWheels; i++) {
        let wheel = wheelInfos[i];
        wheel.raycastResult.body && this.numWheelsOnGround++, wheel.sideImpulse = 0, wheel.forwardImpulse = 0, forwardWS[i] || (forwardWS[i] = new Vec3()), axle[i] || (axle[i] = new Vec3());
      }
      for (let i = 0; i < numWheels; i++) {
        let wheel = wheelInfos[i], groundObject = wheel.raycastResult.body;
        if (groundObject) {
          let axlei = axle[i];
          this.getWheelTransformWorld(i).vectorToWorldFrame(directions[this.indexRightAxis], axlei);
          let surfNormalWS = wheel.raycastResult.hitNormalWorld, proj = axlei.dot(surfNormalWS);
          surfNormalWS.scale(proj, surfNormalWS_scaled_proj), axlei.vsub(surfNormalWS_scaled_proj, axlei), axlei.normalize(), surfNormalWS.cross(axlei, forwardWS[i]), forwardWS[i].normalize(), wheel.sideImpulse = resolveSingleBilateral(chassisBody, wheel.raycastResult.hitPointWorld, groundObject, wheel.raycastResult.hitPointWorld, axlei), wheel.sideImpulse *= sideFrictionStiffness2;
        }
      }
      let sideFactor = 1, fwdFactor = 0.5;
      this.sliding = !1;
      for (let i = 0; i < numWheels; i++) {
        let wheel = wheelInfos[i], groundObject = wheel.raycastResult.body, rollingFriction = 0;
        if (wheel.slipInfo = 1, groundObject) {
          let maxImpulse = wheel.brake ? wheel.brake : 0;
          rollingFriction = calcRollingFriction(chassisBody, groundObject, wheel.raycastResult.hitPointWorld, forwardWS[i], maxImpulse), rollingFriction += wheel.engineForce * timeStep;
          let factor = maxImpulse / rollingFriction;
          wheel.slipInfo *= factor;
        }
        if (wheel.forwardImpulse = 0, wheel.skidInfo = 1, groundObject) {
          wheel.skidInfo = 1;
          let maximp = wheel.suspensionForce * timeStep * wheel.frictionSlip, maximpSquared = maximp * maximp;
          wheel.forwardImpulse = rollingFriction;
          let x = wheel.forwardImpulse * fwdFactor / wheel.forwardAcceleration, y = wheel.sideImpulse * sideFactor / wheel.sideAcceleration, impulseSquared = x * x + y * y;
          if (wheel.sliding = !1, impulseSquared > maximpSquared) {
            this.sliding = !0, wheel.sliding = !0;
            let factor = maximp / Math.sqrt(impulseSquared);
            wheel.skidInfo *= factor;
          }
        }
      }
      if (this.sliding)
        for (let i = 0; i < numWheels; i++) {
          let wheel = wheelInfos[i];
          wheel.sideImpulse !== 0 && wheel.skidInfo < 1 && (wheel.forwardImpulse *= wheel.skidInfo, wheel.sideImpulse *= wheel.skidInfo);
        }
      for (let i = 0; i < numWheels; i++) {
        let wheel = wheelInfos[i], rel_pos = new Vec3();
        if (wheel.raycastResult.hitPointWorld.vsub(chassisBody.position, rel_pos), wheel.forwardImpulse !== 0) {
          let impulse = new Vec3();
          forwardWS[i].scale(wheel.forwardImpulse, impulse), chassisBody.applyImpulse(impulse, rel_pos);
        }
        if (wheel.sideImpulse !== 0) {
          let groundObject = wheel.raycastResult.body, rel_pos2 = new Vec3();
          wheel.raycastResult.hitPointWorld.vsub(groundObject.position, rel_pos2);
          let sideImp = new Vec3();
          axle[i].scale(wheel.sideImpulse, sideImp), chassisBody.vectorToLocalFrame(rel_pos, rel_pos), rel_pos["xyz"[this.indexUpAxis]] *= wheel.rollInfluence, chassisBody.vectorToWorldFrame(rel_pos, rel_pos), chassisBody.applyImpulse(sideImp, rel_pos), sideImp.scale(-1, sideImp), groundObject.applyImpulse(sideImp, rel_pos2);
        }
      }
    }
  };
  new Vec3();
  new Vec3();
  new Vec3();
  var tmpVec4 = new Vec3(), tmpVec5 = new Vec3(), tmpVec6 = new Vec3();
  new Ray();
  new Vec3();
  var castRay_rayvector = new Vec3(), castRay_target = new Vec3(), directions = [new Vec3(1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, 0, 1)], updateFriction_surfNormalWS_scaled_proj = new Vec3(), updateFriction_axle = [], updateFriction_forwardWS = [], sideFrictionStiffness2 = 1, calcRollingFriction_vel1 = new Vec3(), calcRollingFriction_vel2 = new Vec3(), calcRollingFriction_vel = new Vec3();
  function calcRollingFriction(body0, body1, frictionPosWorld, frictionDirectionWorld, maxImpulse) {
    let j1 = 0, contactPosWorld = frictionPosWorld, vel1 = calcRollingFriction_vel1, vel2 = calcRollingFriction_vel2, vel = calcRollingFriction_vel;
    body0.getVelocityAtWorldPoint(contactPosWorld, vel1), body1.getVelocityAtWorldPoint(contactPosWorld, vel2), vel1.vsub(vel2, vel);
    let vrel = frictionDirectionWorld.dot(vel), denom0 = computeImpulseDenominator(body0, frictionPosWorld, frictionDirectionWorld), denom1 = computeImpulseDenominator(body1, frictionPosWorld, frictionDirectionWorld), jacDiagABInv = 1 / (denom0 + denom1);
    return j1 = -vrel * jacDiagABInv, maxImpulse < j1 && (j1 = maxImpulse), j1 < -maxImpulse && (j1 = -maxImpulse), j1;
  }
  var computeImpulseDenominator_r0 = new Vec3(), computeImpulseDenominator_c0 = new Vec3(), computeImpulseDenominator_vec = new Vec3(), computeImpulseDenominator_m = new Vec3();
  function computeImpulseDenominator(body, pos, normal) {
    let r0 = computeImpulseDenominator_r0, c0 = computeImpulseDenominator_c0, vec = computeImpulseDenominator_vec, m = computeImpulseDenominator_m;
    return pos.vsub(body.position, r0), r0.cross(normal, c0), body.invInertiaWorld.vmult(c0, m), m.cross(r0, vec), body.invMass + normal.dot(vec);
  }
  var resolveSingleBilateral_vel1 = new Vec3(), resolveSingleBilateral_vel2 = new Vec3(), resolveSingleBilateral_vel = new Vec3();
  function resolveSingleBilateral(body1, pos1, body2, pos2, normal) {
    if (normal.lengthSquared() > 1.1)
      return 0;
    let vel1 = resolveSingleBilateral_vel1, vel2 = resolveSingleBilateral_vel2, vel = resolveSingleBilateral_vel;
    body1.getVelocityAtWorldPoint(pos1, vel1), body2.getVelocityAtWorldPoint(pos2, vel2), vel1.vsub(vel2, vel);
    let rel_vel = normal.dot(vel), contactDamping = 0.2, massTerm = 1 / (body1.invMass + body2.invMass);
    return -contactDamping * rel_vel * massTerm;
  }
  var Sphere = class extends Shape {
    /**
     * The radius of the sphere.
     */
    /**
     *
     * @param radius The radius of the sphere, a non-negative number.
     */
    constructor(radius) {
      if (super({
        type: Shape.types.SPHERE
      }), this.radius = radius !== void 0 ? radius : 1, this.radius < 0)
        throw new Error("The sphere radius cannot be negative.");
      this.updateBoundingSphereRadius();
    }
    /** calculateLocalInertia */
    calculateLocalInertia(mass, target) {
      target === void 0 && (target = new Vec3());
      let I = 2 * mass * this.radius * this.radius / 5;
      return target.x = I, target.y = I, target.z = I, target;
    }
    /** volume */
    volume() {
      return 4 * Math.PI * Math.pow(this.radius, 3) / 3;
    }
    updateBoundingSphereRadius() {
      this.boundingSphereRadius = this.radius;
    }
    calculateWorldAABB(pos, quat, min, max) {
      let r = this.radius, axes = ["x", "y", "z"];
      for (let i = 0; i < axes.length; i++) {
        let ax = axes[i];
        min[ax] = pos[ax] - r, max[ax] = pos[ax] + r;
      }
    }
  }, RigidVehicle = class {
    /**
     * The bodies of the wheels.
     */
    /**
     * The chassis body.
     */
    /**
     * The constraints.
     */
    /**
     * The wheel axes.
     */
    /**
     * The wheel forces.
     */
    constructor(options) {
      options === void 0 && (options = {}), this.wheelBodies = [], this.coordinateSystem = typeof options.coordinateSystem < "u" ? options.coordinateSystem.clone() : new Vec3(1, 2, 3), options.chassisBody ? this.chassisBody = options.chassisBody : this.chassisBody = new Body({
        mass: 1,
        shape: new Box(new Vec3(5, 0.5, 2))
      }), this.constraints = [], this.wheelAxes = [], this.wheelForces = [];
    }
    /**
     * Add a wheel
     */
    addWheel(options) {
      options === void 0 && (options = {});
      let wheelBody;
      options.body ? wheelBody = options.body : wheelBody = new Body({
        mass: 1,
        shape: new Sphere(1.2)
      }), this.wheelBodies.push(wheelBody), this.wheelForces.push(0);
      let position = typeof options.position < "u" ? options.position.clone() : new Vec3(), worldPosition = new Vec3();
      this.chassisBody.pointToWorldFrame(position, worldPosition), wheelBody.position.set(worldPosition.x, worldPosition.y, worldPosition.z);
      let axis = typeof options.axis < "u" ? options.axis.clone() : new Vec3(0, 0, 1);
      this.wheelAxes.push(axis);
      let hingeConstraint = new HingeConstraint(this.chassisBody, wheelBody, {
        pivotA: position,
        axisA: axis,
        pivotB: Vec3.ZERO,
        axisB: axis,
        collideConnected: !1
      });
      return this.constraints.push(hingeConstraint), this.wheelBodies.length - 1;
    }
    /**
     * Set the steering value of a wheel.
     * @todo check coordinateSystem
     */
    setSteeringValue(value, wheelIndex) {
      let axis = this.wheelAxes[wheelIndex], c2 = Math.cos(value), s = Math.sin(value), x = axis.x, z = axis.z;
      this.constraints[wheelIndex].axisA.set(-c2 * x + s * z, 0, s * x + c2 * z);
    }
    /**
     * Set the target rotational speed of the hinge constraint.
     */
    setMotorSpeed(value, wheelIndex) {
      let hingeConstraint = this.constraints[wheelIndex];
      hingeConstraint.enableMotor(), hingeConstraint.motorTargetVelocity = value;
    }
    /**
     * Set the target rotational speed of the hinge constraint.
     */
    disableMotor(wheelIndex) {
      this.constraints[wheelIndex].disableMotor();
    }
    /**
     * Set the wheel force to apply on one of the wheels each time step
     */
    setWheelForce(value, wheelIndex) {
      this.wheelForces[wheelIndex] = value;
    }
    /**
     * Apply a torque on one of the wheels.
     */
    applyWheelForce(value, wheelIndex) {
      let axis = this.wheelAxes[wheelIndex], wheelBody = this.wheelBodies[wheelIndex], bodyTorque = wheelBody.torque;
      axis.scale(value, torque), wheelBody.vectorToWorldFrame(torque, torque), bodyTorque.vadd(torque, bodyTorque);
    }
    /**
     * Add the vehicle including its constraints to the world.
     */
    addToWorld(world) {
      let constraints = this.constraints, bodies = this.wheelBodies.concat([this.chassisBody]);
      for (let i = 0; i < bodies.length; i++)
        world.addBody(bodies[i]);
      for (let i = 0; i < constraints.length; i++)
        world.addConstraint(constraints[i]);
      world.addEventListener("preStep", this._update.bind(this));
    }
    _update() {
      let wheelForces = this.wheelForces;
      for (let i = 0; i < wheelForces.length; i++)
        this.applyWheelForce(wheelForces[i], i);
    }
    /**
     * Remove the vehicle including its constraints from the world.
     */
    removeFromWorld(world) {
      let constraints = this.constraints, bodies = this.wheelBodies.concat([this.chassisBody]);
      for (let i = 0; i < bodies.length; i++)
        world.removeBody(bodies[i]);
      for (let i = 0; i < constraints.length; i++)
        world.removeConstraint(constraints[i]);
    }
    /**
     * Get current rotational velocity of a wheel
     */
    getWheelSpeed(wheelIndex) {
      let axis = this.wheelAxes[wheelIndex], w = this.wheelBodies[wheelIndex].angularVelocity;
      return this.chassisBody.vectorToWorldFrame(axis, worldAxis), w.dot(worldAxis);
    }
  }, torque = new Vec3(), worldAxis = new Vec3(), SPHSystem = class {
    /**
     * The particles array.
     */
    /**
     * Density of the system (kg/m3).
     * @default 1
     */
    /**
     * Distance below which two particles are considered to be neighbors.
     * It should be adjusted so there are about 15-20 neighbor particles within this radius.
     * @default 1
     */
    /**
     * @default 1
     */
    /**
     * Viscosity of the system.
     * @default 0.01
     */
    /**
     * @default 0.000001
     */
    constructor() {
      this.particles = [], this.density = 1, this.smoothingRadius = 1, this.speedOfSound = 1, this.viscosity = 0.01, this.eps = 1e-6, this.pressures = [], this.densities = [], this.neighbors = [];
    }
    /**
     * Add a particle to the system.
     */
    add(particle) {
      this.particles.push(particle), this.neighbors.length < this.particles.length && this.neighbors.push([]);
    }
    /**
     * Remove a particle from the system.
     */
    remove(particle) {
      let idx = this.particles.indexOf(particle);
      idx !== -1 && (this.particles.splice(idx, 1), this.neighbors.length > this.particles.length && this.neighbors.pop());
    }
    /**
     * Get neighbors within smoothing volume, save in the array neighbors
     */
    getNeighbors(particle, neighbors) {
      let N = this.particles.length, id = particle.id, R2 = this.smoothingRadius * this.smoothingRadius, dist = SPHSystem_getNeighbors_dist;
      for (let i = 0; i !== N; i++) {
        let p = this.particles[i];
        p.position.vsub(particle.position, dist), id !== p.id && dist.lengthSquared() < R2 && neighbors.push(p);
      }
    }
    update() {
      let N = this.particles.length, dist = SPHSystem_update_dist, cs = this.speedOfSound, eps = this.eps;
      for (let i = 0; i !== N; i++) {
        let p = this.particles[i], neighbors = this.neighbors[i];
        neighbors.length = 0, this.getNeighbors(p, neighbors), neighbors.push(this.particles[i]);
        let numNeighbors = neighbors.length, sum = 0;
        for (let j = 0; j !== numNeighbors; j++) {
          p.position.vsub(neighbors[j].position, dist);
          let len = dist.length(), weight = this.w(len);
          sum += neighbors[j].mass * weight;
        }
        this.densities[i] = sum, this.pressures[i] = cs * cs * (this.densities[i] - this.density);
      }
      let a_pressure = SPHSystem_update_a_pressure, a_visc = SPHSystem_update_a_visc, gradW = SPHSystem_update_gradW, r_vec = SPHSystem_update_r_vec, u = SPHSystem_update_u;
      for (let i = 0; i !== N; i++) {
        let particle = this.particles[i];
        a_pressure.set(0, 0, 0), a_visc.set(0, 0, 0);
        let Pij, nabla, neighbors = this.neighbors[i], numNeighbors = neighbors.length;
        for (let j = 0; j !== numNeighbors; j++) {
          let neighbor = neighbors[j];
          particle.position.vsub(neighbor.position, r_vec);
          let r = r_vec.length();
          Pij = -neighbor.mass * (this.pressures[i] / (this.densities[i] * this.densities[i] + eps) + this.pressures[j] / (this.densities[j] * this.densities[j] + eps)), this.gradw(r_vec, gradW), gradW.scale(Pij, gradW), a_pressure.vadd(gradW, a_pressure), neighbor.velocity.vsub(particle.velocity, u), u.scale(1 / (1e-4 + this.densities[i] * this.densities[j]) * this.viscosity * neighbor.mass, u), nabla = this.nablaw(r), u.scale(nabla, u), a_visc.vadd(u, a_visc);
        }
        a_visc.scale(particle.mass, a_visc), a_pressure.scale(particle.mass, a_pressure), particle.force.vadd(a_visc, particle.force), particle.force.vadd(a_pressure, particle.force);
      }
    }
    // Calculate the weight using the W(r) weightfunction
    w(r) {
      let h = this.smoothingRadius;
      return 315 / (64 * Math.PI * h ** 9) * (h * h - r * r) ** 3;
    }
    // calculate gradient of the weight function
    gradw(rVec, resultVec) {
      let r = rVec.length(), h = this.smoothingRadius;
      rVec.scale(945 / (32 * Math.PI * h ** 9) * (h * h - r * r) ** 2, resultVec);
    }
    // Calculate nabla(W)
    nablaw(r) {
      let h = this.smoothingRadius;
      return 945 / (32 * Math.PI * h ** 9) * (h * h - r * r) * (7 * r * r - 3 * h * h);
    }
  }, SPHSystem_getNeighbors_dist = new Vec3(), SPHSystem_update_dist = new Vec3(), SPHSystem_update_a_pressure = new Vec3(), SPHSystem_update_a_visc = new Vec3(), SPHSystem_update_gradW = new Vec3(), SPHSystem_update_r_vec = new Vec3(), SPHSystem_update_u = new Vec3(), Cylinder = class extends ConvexPolyhedron {
    /** The radius of the top of the Cylinder. */
    /** The radius of the bottom of the Cylinder. */
    /** The height of the Cylinder. */
    /** The number of segments to build the cylinder out of. */
    /**
     * @param radiusTop The radius of the top of the Cylinder.
     * @param radiusBottom The radius of the bottom of the Cylinder.
     * @param height The height of the Cylinder.
     * @param numSegments The number of segments to build the cylinder out of.
     */
    constructor(radiusTop, radiusBottom, height, numSegments) {
      if (radiusTop === void 0 && (radiusTop = 1), radiusBottom === void 0 && (radiusBottom = 1), height === void 0 && (height = 1), numSegments === void 0 && (numSegments = 8), radiusTop < 0)
        throw new Error("The cylinder radiusTop cannot be negative.");
      if (radiusBottom < 0)
        throw new Error("The cylinder radiusBottom cannot be negative.");
      let N = numSegments, vertices = [], axes = [], faces = [], bottomface = [], topface = [], cos = Math.cos, sin = Math.sin;
      vertices.push(new Vec3(-radiusBottom * sin(0), -height * 0.5, radiusBottom * cos(0))), bottomface.push(0), vertices.push(new Vec3(-radiusTop * sin(0), height * 0.5, radiusTop * cos(0))), topface.push(1);
      for (let i = 0; i < N; i++) {
        let theta = 2 * Math.PI / N * (i + 1), thetaN = 2 * Math.PI / N * (i + 0.5);
        i < N - 1 ? (vertices.push(new Vec3(-radiusBottom * sin(theta), -height * 0.5, radiusBottom * cos(theta))), bottomface.push(2 * i + 2), vertices.push(new Vec3(-radiusTop * sin(theta), height * 0.5, radiusTop * cos(theta))), topface.push(2 * i + 3), faces.push([2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2])) : faces.push([2 * i, 2 * i + 1, 1, 0]), (N % 2 === 1 || i < N / 2) && axes.push(new Vec3(-sin(thetaN), 0, cos(thetaN)));
      }
      faces.push(bottomface), axes.push(new Vec3(0, 1, 0));
      let temp = [];
      for (let i = 0; i < topface.length; i++)
        temp.push(topface[topface.length - i - 1]);
      faces.push(temp), super({
        vertices,
        faces,
        axes
      }), this.type = Shape.types.CYLINDER, this.radiusTop = radiusTop, this.radiusBottom = radiusBottom, this.height = height, this.numSegments = numSegments;
    }
  }, Particle = class extends Shape {
    constructor() {
      super({
        type: Shape.types.PARTICLE
      });
    }
    /**
     * calculateLocalInertia
     */
    calculateLocalInertia(mass, target) {
      return target === void 0 && (target = new Vec3()), target.set(0, 0, 0), target;
    }
    volume() {
      return 0;
    }
    updateBoundingSphereRadius() {
      this.boundingSphereRadius = 0;
    }
    calculateWorldAABB(pos, quat, min, max) {
      min.copy(pos), max.copy(pos);
    }
  }, Plane = class extends Shape {
    /** worldNormal */
    /** worldNormalNeedsUpdate */
    constructor() {
      super({
        type: Shape.types.PLANE
      }), this.worldNormal = new Vec3(), this.worldNormalNeedsUpdate = !0, this.boundingSphereRadius = Number.MAX_VALUE;
    }
    /** computeWorldNormal */
    computeWorldNormal(quat) {
      let n = this.worldNormal;
      n.set(0, 0, 1), quat.vmult(n, n), this.worldNormalNeedsUpdate = !1;
    }
    calculateLocalInertia(mass, target) {
      return target === void 0 && (target = new Vec3()), target;
    }
    volume() {
      return (
        // The plane is infinite...
        Number.MAX_VALUE
      );
    }
    calculateWorldAABB(pos, quat, min, max) {
      tempNormal.set(0, 0, 1), quat.vmult(tempNormal, tempNormal);
      let maxVal = Number.MAX_VALUE;
      min.set(-maxVal, -maxVal, -maxVal), max.set(maxVal, maxVal, maxVal), tempNormal.x === 1 ? max.x = pos.x : tempNormal.x === -1 && (min.x = pos.x), tempNormal.y === 1 ? max.y = pos.y : tempNormal.y === -1 && (min.y = pos.y), tempNormal.z === 1 ? max.z = pos.z : tempNormal.z === -1 && (min.z = pos.z);
    }
    updateBoundingSphereRadius() {
      this.boundingSphereRadius = Number.MAX_VALUE;
    }
  }, tempNormal = new Vec3(), Heightfield = class extends Shape {
    /**
     * An array of numbers, or height values, that are spread out along the x axis.
     */
    /**
     * Max value of the data points in the data array.
     */
    /**
     * Minimum value of the data points in the data array.
     */
    /**
     * World spacing between the data points in X and Y direction.
     * @todo elementSizeX and Y
     * @default 1
     */
    /**
     * @default true
     */
    /**
     * @param data An array of numbers, or height values, that are spread out along the x axis.
     */
    constructor(data, options) {
      options === void 0 && (options = {}), options = Utils.defaults(options, {
        maxValue: null,
        minValue: null,
        elementSize: 1
      }), super({
        type: Shape.types.HEIGHTFIELD
      }), this.data = data, this.maxValue = options.maxValue, this.minValue = options.minValue, this.elementSize = options.elementSize, options.minValue === null && this.updateMinValue(), options.maxValue === null && this.updateMaxValue(), this.cacheEnabled = !0, this.pillarConvex = new ConvexPolyhedron(), this.pillarOffset = new Vec3(), this.updateBoundingSphereRadius(), this._cachedPillars = {};
    }
    /**
     * Call whenever you change the data array.
     */
    update() {
      this._cachedPillars = {};
    }
    /**
     * Update the `minValue` property
     */
    updateMinValue() {
      let data = this.data, minValue = data[0][0];
      for (let i = 0; i !== data.length; i++)
        for (let j = 0; j !== data[i].length; j++) {
          let v = data[i][j];
          v < minValue && (minValue = v);
        }
      this.minValue = minValue;
    }
    /**
     * Update the `maxValue` property
     */
    updateMaxValue() {
      let data = this.data, maxValue = data[0][0];
      for (let i = 0; i !== data.length; i++)
        for (let j = 0; j !== data[i].length; j++) {
          let v = data[i][j];
          v > maxValue && (maxValue = v);
        }
      this.maxValue = maxValue;
    }
    /**
     * Set the height value at an index. Don't forget to update maxValue and minValue after you're done.
     */
    setHeightValueAtIndex(xi, yi, value) {
      let data = this.data;
      data[xi][yi] = value, this.clearCachedConvexTrianglePillar(xi, yi, !1), xi > 0 && (this.clearCachedConvexTrianglePillar(xi - 1, yi, !0), this.clearCachedConvexTrianglePillar(xi - 1, yi, !1)), yi > 0 && (this.clearCachedConvexTrianglePillar(xi, yi - 1, !0), this.clearCachedConvexTrianglePillar(xi, yi - 1, !1)), yi > 0 && xi > 0 && this.clearCachedConvexTrianglePillar(xi - 1, yi - 1, !0);
    }
    /**
     * Get max/min in a rectangle in the matrix data
     * @param result An array to store the results in.
     * @return The result array, if it was passed in. Minimum will be at position 0 and max at 1.
     */
    getRectMinMax(iMinX, iMinY, iMaxX, iMaxY, result) {
      result === void 0 && (result = []);
      let data = this.data, max = this.minValue;
      for (let i = iMinX; i <= iMaxX; i++)
        for (let j = iMinY; j <= iMaxY; j++) {
          let height = data[i][j];
          height > max && (max = height);
        }
      result[0] = this.minValue, result[1] = max;
    }
    /**
     * Get the index of a local position on the heightfield. The indexes indicate the rectangles, so if your terrain is made of N x N height data points, you will have rectangle indexes ranging from 0 to N-1.
     * @param result Two-element array
     * @param clamp If the position should be clamped to the heightfield edge.
     */
    getIndexOfPosition(x, y, result, clamp) {
      let w = this.elementSize, data = this.data, xi = Math.floor(x / w), yi = Math.floor(y / w);
      return result[0] = xi, result[1] = yi, clamp && (xi < 0 && (xi = 0), yi < 0 && (yi = 0), xi >= data.length - 1 && (xi = data.length - 1), yi >= data[0].length - 1 && (yi = data[0].length - 1)), !(xi < 0 || yi < 0 || xi >= data.length - 1 || yi >= data[0].length - 1);
    }
    getTriangleAt(x, y, edgeClamp, a2, b2, c2) {
      let idx = getHeightAt_idx;
      this.getIndexOfPosition(x, y, idx, edgeClamp);
      let xi = idx[0], yi = idx[1], data = this.data;
      edgeClamp && (xi = Math.min(data.length - 2, Math.max(0, xi)), yi = Math.min(data[0].length - 2, Math.max(0, yi)));
      let elementSize = this.elementSize, lowerDist2 = (x / elementSize - xi) ** 2 + (y / elementSize - yi) ** 2, upperDist2 = (x / elementSize - (xi + 1)) ** 2 + (y / elementSize - (yi + 1)) ** 2, upper = lowerDist2 > upperDist2;
      return this.getTriangle(xi, yi, upper, a2, b2, c2), upper;
    }
    getNormalAt(x, y, edgeClamp, result) {
      let a2 = getNormalAt_a, b2 = getNormalAt_b, c2 = getNormalAt_c, e0 = getNormalAt_e0, e1 = getNormalAt_e1;
      this.getTriangleAt(x, y, edgeClamp, a2, b2, c2), b2.vsub(a2, e0), c2.vsub(a2, e1), e0.cross(e1, result), result.normalize();
    }
    /**
     * Get an AABB of a square in the heightfield
     * @param xi
     * @param yi
     * @param result
     */
    getAabbAtIndex(xi, yi, _ref) {
      let {
        lowerBound,
        upperBound
      } = _ref, data = this.data, elementSize = this.elementSize;
      lowerBound.set(xi * elementSize, yi * elementSize, data[xi][yi]), upperBound.set((xi + 1) * elementSize, (yi + 1) * elementSize, data[xi + 1][yi + 1]);
    }
    /**
     * Get the height in the heightfield at a given position
     */
    getHeightAt(x, y, edgeClamp) {
      let data = this.data, a2 = getHeightAt_a, b2 = getHeightAt_b, c2 = getHeightAt_c, idx = getHeightAt_idx;
      this.getIndexOfPosition(x, y, idx, edgeClamp);
      let xi = idx[0], yi = idx[1];
      edgeClamp && (xi = Math.min(data.length - 2, Math.max(0, xi)), yi = Math.min(data[0].length - 2, Math.max(0, yi)));
      let upper = this.getTriangleAt(x, y, edgeClamp, a2, b2, c2);
      barycentricWeights(x, y, a2.x, a2.y, b2.x, b2.y, c2.x, c2.y, getHeightAt_weights);
      let w = getHeightAt_weights;
      return upper ? data[xi + 1][yi + 1] * w.x + data[xi][yi + 1] * w.y + data[xi + 1][yi] * w.z : data[xi][yi] * w.x + data[xi + 1][yi] * w.y + data[xi][yi + 1] * w.z;
    }
    getCacheConvexTrianglePillarKey(xi, yi, getUpperTriangle) {
      return `${xi}_${yi}_${getUpperTriangle ? 1 : 0}`;
    }
    getCachedConvexTrianglePillar(xi, yi, getUpperTriangle) {
      return this._cachedPillars[this.getCacheConvexTrianglePillarKey(xi, yi, getUpperTriangle)];
    }
    setCachedConvexTrianglePillar(xi, yi, getUpperTriangle, convex, offset) {
      this._cachedPillars[this.getCacheConvexTrianglePillarKey(xi, yi, getUpperTriangle)] = {
        convex,
        offset
      };
    }
    clearCachedConvexTrianglePillar(xi, yi, getUpperTriangle) {
      delete this._cachedPillars[this.getCacheConvexTrianglePillarKey(xi, yi, getUpperTriangle)];
    }
    /**
     * Get a triangle from the heightfield
     */
    getTriangle(xi, yi, upper, a2, b2, c2) {
      let data = this.data, elementSize = this.elementSize;
      upper ? (a2.set((xi + 1) * elementSize, (yi + 1) * elementSize, data[xi + 1][yi + 1]), b2.set(xi * elementSize, (yi + 1) * elementSize, data[xi][yi + 1]), c2.set((xi + 1) * elementSize, yi * elementSize, data[xi + 1][yi])) : (a2.set(xi * elementSize, yi * elementSize, data[xi][yi]), b2.set((xi + 1) * elementSize, yi * elementSize, data[xi + 1][yi]), c2.set(xi * elementSize, (yi + 1) * elementSize, data[xi][yi + 1]));
    }
    /**
     * Get a triangle in the terrain in the form of a triangular convex shape.
     */
    getConvexTrianglePillar(xi, yi, getUpperTriangle) {
      let result = this.pillarConvex, offsetResult = this.pillarOffset;
      if (this.cacheEnabled) {
        let data2 = this.getCachedConvexTrianglePillar(xi, yi, getUpperTriangle);
        if (data2) {
          this.pillarConvex = data2.convex, this.pillarOffset = data2.offset;
          return;
        }
        result = new ConvexPolyhedron(), offsetResult = new Vec3(), this.pillarConvex = result, this.pillarOffset = offsetResult;
      }
      let data = this.data, elementSize = this.elementSize, faces = result.faces;
      result.vertices.length = 6;
      for (let i = 0; i < 6; i++)
        result.vertices[i] || (result.vertices[i] = new Vec3());
      faces.length = 5;
      for (let i = 0; i < 5; i++)
        faces[i] || (faces[i] = []);
      let verts = result.vertices, h = (Math.min(data[xi][yi], data[xi + 1][yi], data[xi][yi + 1], data[xi + 1][yi + 1]) - this.minValue) / 2 + this.minValue;
      getUpperTriangle ? (offsetResult.set(
        (xi + 0.75) * elementSize,
        // sort of center of a triangle
        (yi + 0.75) * elementSize,
        h
        // vertical center
      ), verts[0].set(0.25 * elementSize, 0.25 * elementSize, data[xi + 1][yi + 1] - h), verts[1].set(-0.75 * elementSize, 0.25 * elementSize, data[xi][yi + 1] - h), verts[2].set(0.25 * elementSize, -0.75 * elementSize, data[xi + 1][yi] - h), verts[3].set(0.25 * elementSize, 0.25 * elementSize, -Math.abs(h) - 1), verts[4].set(-0.75 * elementSize, 0.25 * elementSize, -Math.abs(h) - 1), verts[5].set(0.25 * elementSize, -0.75 * elementSize, -Math.abs(h) - 1), faces[0][0] = 0, faces[0][1] = 1, faces[0][2] = 2, faces[1][0] = 5, faces[1][1] = 4, faces[1][2] = 3, faces[2][0] = 2, faces[2][1] = 5, faces[2][2] = 3, faces[2][3] = 0, faces[3][0] = 3, faces[3][1] = 4, faces[3][2] = 1, faces[3][3] = 0, faces[4][0] = 1, faces[4][1] = 4, faces[4][2] = 5, faces[4][3] = 2) : (offsetResult.set(
        (xi + 0.25) * elementSize,
        // sort of center of a triangle
        (yi + 0.25) * elementSize,
        h
        // vertical center
      ), verts[0].set(-0.25 * elementSize, -0.25 * elementSize, data[xi][yi] - h), verts[1].set(0.75 * elementSize, -0.25 * elementSize, data[xi + 1][yi] - h), verts[2].set(-0.25 * elementSize, 0.75 * elementSize, data[xi][yi + 1] - h), verts[3].set(-0.25 * elementSize, -0.25 * elementSize, -Math.abs(h) - 1), verts[4].set(0.75 * elementSize, -0.25 * elementSize, -Math.abs(h) - 1), verts[5].set(-0.25 * elementSize, 0.75 * elementSize, -Math.abs(h) - 1), faces[0][0] = 0, faces[0][1] = 1, faces[0][2] = 2, faces[1][0] = 5, faces[1][1] = 4, faces[1][2] = 3, faces[2][0] = 0, faces[2][1] = 2, faces[2][2] = 5, faces[2][3] = 3, faces[3][0] = 1, faces[3][1] = 0, faces[3][2] = 3, faces[3][3] = 4, faces[4][0] = 4, faces[4][1] = 5, faces[4][2] = 2, faces[4][3] = 1), result.computeNormals(), result.computeEdges(), result.updateBoundingSphereRadius(), this.setCachedConvexTrianglePillar(xi, yi, getUpperTriangle, result, offsetResult);
    }
    calculateLocalInertia(mass, target) {
      return target === void 0 && (target = new Vec3()), target.set(0, 0, 0), target;
    }
    volume() {
      return (
        // The terrain is infinite
        Number.MAX_VALUE
      );
    }
    calculateWorldAABB(pos, quat, min, max) {
      min.set(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE), max.set(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    }
    updateBoundingSphereRadius() {
      let data = this.data, s = this.elementSize;
      this.boundingSphereRadius = new Vec3(data.length * s, data[0].length * s, Math.max(Math.abs(this.maxValue), Math.abs(this.minValue))).length();
    }
    /**
     * Sets the height values from an image. Currently only supported in browser.
     */
    setHeightsFromImage(image, scale) {
      let {
        x,
        z,
        y
      } = scale, canvas = document.createElement("canvas");
      canvas.width = image.width, canvas.height = image.height;
      let context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      let imageData = context.getImageData(0, 0, image.width, image.height), matrix = this.data;
      matrix.length = 0, this.elementSize = Math.abs(x) / imageData.width;
      for (let i = 0; i < imageData.height; i++) {
        let row = [];
        for (let j = 0; j < imageData.width; j++) {
          let a2 = imageData.data[(i * imageData.height + j) * 4], b2 = imageData.data[(i * imageData.height + j) * 4 + 1], c2 = imageData.data[(i * imageData.height + j) * 4 + 2], height = (a2 + b2 + c2) / 4 / 255 * z;
          x < 0 ? row.push(height) : row.unshift(height);
        }
        y < 0 ? matrix.unshift(row) : matrix.push(row);
      }
      this.updateMaxValue(), this.updateMinValue(), this.update();
    }
  }, getHeightAt_idx = [], getHeightAt_weights = new Vec3(), getHeightAt_a = new Vec3(), getHeightAt_b = new Vec3(), getHeightAt_c = new Vec3(), getNormalAt_a = new Vec3(), getNormalAt_b = new Vec3(), getNormalAt_c = new Vec3(), getNormalAt_e0 = new Vec3(), getNormalAt_e1 = new Vec3();
  function barycentricWeights(x, y, ax, ay, bx, by, cx, cy, result) {
    result.x = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / ((by - cy) * (ax - cx) + (cx - bx) * (ay - cy)), result.y = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / ((by - cy) * (ax - cx) + (cx - bx) * (ay - cy)), result.z = 1 - result.x - result.y;
  }
  var OctreeNode = class _OctreeNode {
    /** The root node */
    /** Boundary of this node */
    /** Contained data at the current node level */
    /** Children to this node */
    constructor(options) {
      options === void 0 && (options = {}), this.root = options.root || null, this.aabb = options.aabb ? options.aabb.clone() : new AABB(), this.data = [], this.children = [];
    }
    /**
     * reset
     */
    reset() {
      this.children.length = this.data.length = 0;
    }
    /**
     * Insert data into this node
     * @return True if successful, otherwise false
     */
    insert(aabb, elementData, level) {
      level === void 0 && (level = 0);
      let nodeData = this.data;
      if (!this.aabb.contains(aabb))
        return !1;
      let children = this.children, maxDepth = this.maxDepth || this.root.maxDepth;
      if (level < maxDepth) {
        let subdivided = !1;
        children.length || (this.subdivide(), subdivided = !0);
        for (let i = 0; i !== 8; i++)
          if (children[i].insert(aabb, elementData, level + 1))
            return !0;
        subdivided && (children.length = 0);
      }
      return nodeData.push(elementData), !0;
    }
    /**
     * Create 8 equally sized children nodes and put them in the `children` array.
     */
    subdivide() {
      let aabb = this.aabb, l = aabb.lowerBound, u = aabb.upperBound, children = this.children;
      children.push(new _OctreeNode({
        aabb: new AABB({
          lowerBound: new Vec3(0, 0, 0)
        })
      }), new _OctreeNode({
        aabb: new AABB({
          lowerBound: new Vec3(1, 0, 0)
        })
      }), new _OctreeNode({
        aabb: new AABB({
          lowerBound: new Vec3(1, 1, 0)
        })
      }), new _OctreeNode({
        aabb: new AABB({
          lowerBound: new Vec3(1, 1, 1)
        })
      }), new _OctreeNode({
        aabb: new AABB({
          lowerBound: new Vec3(0, 1, 1)
        })
      }), new _OctreeNode({
        aabb: new AABB({
          lowerBound: new Vec3(0, 0, 1)
        })
      }), new _OctreeNode({
        aabb: new AABB({
          lowerBound: new Vec3(1, 0, 1)
        })
      }), new _OctreeNode({
        aabb: new AABB({
          lowerBound: new Vec3(0, 1, 0)
        })
      })), u.vsub(l, halfDiagonal), halfDiagonal.scale(0.5, halfDiagonal);
      let root = this.root || this;
      for (let i = 0; i !== 8; i++) {
        let child = children[i];
        child.root = root;
        let lowerBound = child.aabb.lowerBound;
        lowerBound.x *= halfDiagonal.x, lowerBound.y *= halfDiagonal.y, lowerBound.z *= halfDiagonal.z, lowerBound.vadd(l, lowerBound), lowerBound.vadd(halfDiagonal, child.aabb.upperBound);
      }
    }
    /**
     * Get all data, potentially within an AABB
     * @return The "result" object
     */
    aabbQuery(aabb, result) {
      this.data, this.children;
      let queue2 = [this];
      for (; queue2.length; ) {
        let node = queue2.pop();
        node.aabb.overlaps(aabb) && Array.prototype.push.apply(result, node.data), Array.prototype.push.apply(queue2, node.children);
      }
      return result;
    }
    /**
     * Get all data, potentially intersected by a ray.
     * @return The "result" object
     */
    rayQuery(ray, treeTransform, result) {
      return ray.getAABB(tmpAABB), tmpAABB.toLocalFrame(treeTransform, tmpAABB), this.aabbQuery(tmpAABB, result), result;
    }
    /**
     * removeEmptyNodes
     */
    removeEmptyNodes() {
      for (let i = this.children.length - 1; i >= 0; i--)
        this.children[i].removeEmptyNodes(), !this.children[i].children.length && !this.children[i].data.length && this.children.splice(i, 1);
    }
  }, Octree = class extends OctreeNode {
    /**
     * Maximum subdivision depth
     * @default 8
     */
    /**
     * @param aabb The total AABB of the tree
     */
    constructor(aabb, options) {
      options === void 0 && (options = {}), super({
        root: null,
        aabb
      }), this.maxDepth = typeof options.maxDepth < "u" ? options.maxDepth : 8;
    }
  }, halfDiagonal = new Vec3(), tmpAABB = new AABB(), Trimesh = class _Trimesh extends Shape {
    /**
     * vertices
     */
    /**
     * Array of integers, indicating which vertices each triangle consists of. The length of this array is thus 3 times the number of triangles.
     */
    /**
     * The normals data.
     */
    /**
     * The local AABB of the mesh.
     */
    /**
     * References to vertex pairs, making up all unique edges in the trimesh.
     */
    /**
     * Local scaling of the mesh. Use .setScale() to set it.
     */
    /**
     * The indexed triangles. Use .updateTree() to update it.
     */
    constructor(vertices, indices) {
      super({
        type: Shape.types.TRIMESH
      }), this.vertices = new Float32Array(vertices), this.indices = new Int16Array(indices), this.normals = new Float32Array(indices.length), this.aabb = new AABB(), this.edges = null, this.scale = new Vec3(1, 1, 1), this.tree = new Octree(), this.updateEdges(), this.updateNormals(), this.updateAABB(), this.updateBoundingSphereRadius(), this.updateTree();
    }
    /**
     * updateTree
     */
    updateTree() {
      let tree = this.tree;
      tree.reset(), tree.aabb.copy(this.aabb);
      let scale = this.scale;
      tree.aabb.lowerBound.x *= 1 / scale.x, tree.aabb.lowerBound.y *= 1 / scale.y, tree.aabb.lowerBound.z *= 1 / scale.z, tree.aabb.upperBound.x *= 1 / scale.x, tree.aabb.upperBound.y *= 1 / scale.y, tree.aabb.upperBound.z *= 1 / scale.z;
      let triangleAABB = new AABB(), a2 = new Vec3(), b2 = new Vec3(), c2 = new Vec3(), points = [a2, b2, c2];
      for (let i = 0; i < this.indices.length / 3; i++) {
        let i3 = i * 3;
        this._getUnscaledVertex(this.indices[i3], a2), this._getUnscaledVertex(this.indices[i3 + 1], b2), this._getUnscaledVertex(this.indices[i3 + 2], c2), triangleAABB.setFromPoints(points), tree.insert(triangleAABB, i);
      }
      tree.removeEmptyNodes();
    }
    /**
     * Get triangles in a local AABB from the trimesh.
     * @param result An array of integers, referencing the queried triangles.
     */
    getTrianglesInAABB(aabb, result) {
      unscaledAABB.copy(aabb);
      let scale = this.scale, isx = scale.x, isy = scale.y, isz = scale.z, l = unscaledAABB.lowerBound, u = unscaledAABB.upperBound;
      return l.x /= isx, l.y /= isy, l.z /= isz, u.x /= isx, u.y /= isy, u.z /= isz, this.tree.aabbQuery(unscaledAABB, result);
    }
    /**
     * setScale
     */
    setScale(scale) {
      let wasUniform = this.scale.x === this.scale.y && this.scale.y === this.scale.z, isUniform = scale.x === scale.y && scale.y === scale.z;
      wasUniform && isUniform || this.updateNormals(), this.scale.copy(scale), this.updateAABB(), this.updateBoundingSphereRadius();
    }
    /**
     * Compute the normals of the faces. Will save in the `.normals` array.
     */
    updateNormals() {
      let n = computeNormals_n, normals = this.normals;
      for (let i = 0; i < this.indices.length / 3; i++) {
        let i3 = i * 3, a2 = this.indices[i3], b2 = this.indices[i3 + 1], c2 = this.indices[i3 + 2];
        this.getVertex(a2, va), this.getVertex(b2, vb), this.getVertex(c2, vc), _Trimesh.computeNormal(vb, va, vc, n), normals[i3] = n.x, normals[i3 + 1] = n.y, normals[i3 + 2] = n.z;
      }
    }
    /**
     * Update the `.edges` property
     */
    updateEdges() {
      let edges = {}, add = (a2, b2) => {
        let key = a2 < b2 ? `${a2}_${b2}` : `${b2}_${a2}`;
        edges[key] = !0;
      };
      for (let i = 0; i < this.indices.length / 3; i++) {
        let i3 = i * 3, a2 = this.indices[i3], b2 = this.indices[i3 + 1], c2 = this.indices[i3 + 2];
        add(a2, b2), add(b2, c2), add(c2, a2);
      }
      let keys = Object.keys(edges);
      this.edges = new Int16Array(keys.length * 2);
      for (let i = 0; i < keys.length; i++) {
        let indices = keys[i].split("_");
        this.edges[2 * i] = parseInt(indices[0], 10), this.edges[2 * i + 1] = parseInt(indices[1], 10);
      }
    }
    /**
     * Get an edge vertex
     * @param firstOrSecond 0 or 1, depending on which one of the vertices you need.
     * @param vertexStore Where to store the result
     */
    getEdgeVertex(edgeIndex, firstOrSecond, vertexStore) {
      let vertexIndex = this.edges[edgeIndex * 2 + (firstOrSecond ? 1 : 0)];
      this.getVertex(vertexIndex, vertexStore);
    }
    /**
     * Get a vector along an edge.
     */
    getEdgeVector(edgeIndex, vectorStore) {
      let va2 = getEdgeVector_va, vb2 = getEdgeVector_vb;
      this.getEdgeVertex(edgeIndex, 0, va2), this.getEdgeVertex(edgeIndex, 1, vb2), vb2.vsub(va2, vectorStore);
    }
    /**
     * Get face normal given 3 vertices
     */
    static computeNormal(va2, vb2, vc2, target) {
      vb2.vsub(va2, ab), vc2.vsub(vb2, cb), cb.cross(ab, target), target.isZero() || target.normalize();
    }
    /**
     * Get vertex i.
     * @return The "out" vector object
     */
    getVertex(i, out) {
      let scale = this.scale;
      return this._getUnscaledVertex(i, out), out.x *= scale.x, out.y *= scale.y, out.z *= scale.z, out;
    }
    /**
     * Get raw vertex i
     * @return The "out" vector object
     */
    _getUnscaledVertex(i, out) {
      let i3 = i * 3, vertices = this.vertices;
      return out.set(vertices[i3], vertices[i3 + 1], vertices[i3 + 2]);
    }
    /**
     * Get a vertex from the trimesh,transformed by the given position and quaternion.
     * @return The "out" vector object
     */
    getWorldVertex(i, pos, quat, out) {
      return this.getVertex(i, out), Transform.pointToWorldFrame(pos, quat, out, out), out;
    }
    /**
     * Get the three vertices for triangle i.
     */
    getTriangleVertices(i, a2, b2, c2) {
      let i3 = i * 3;
      this.getVertex(this.indices[i3], a2), this.getVertex(this.indices[i3 + 1], b2), this.getVertex(this.indices[i3 + 2], c2);
    }
    /**
     * Compute the normal of triangle i.
     * @return The "target" vector object
     */
    getNormal(i, target) {
      let i3 = i * 3;
      return target.set(this.normals[i3], this.normals[i3 + 1], this.normals[i3 + 2]);
    }
    /**
     * @return The "target" vector object
     */
    calculateLocalInertia(mass, target) {
      this.computeLocalAABB(cli_aabb);
      let x = cli_aabb.upperBound.x - cli_aabb.lowerBound.x, y = cli_aabb.upperBound.y - cli_aabb.lowerBound.y, z = cli_aabb.upperBound.z - cli_aabb.lowerBound.z;
      return target.set(1 / 12 * mass * (2 * y * 2 * y + 2 * z * 2 * z), 1 / 12 * mass * (2 * x * 2 * x + 2 * z * 2 * z), 1 / 12 * mass * (2 * y * 2 * y + 2 * x * 2 * x));
    }
    /**
     * Compute the local AABB for the trimesh
     */
    computeLocalAABB(aabb) {
      let l = aabb.lowerBound, u = aabb.upperBound, n = this.vertices.length;
      this.vertices;
      let v = computeLocalAABB_worldVert;
      this.getVertex(0, v), l.copy(v), u.copy(v);
      for (let i = 0; i !== n; i++)
        this.getVertex(i, v), v.x < l.x ? l.x = v.x : v.x > u.x && (u.x = v.x), v.y < l.y ? l.y = v.y : v.y > u.y && (u.y = v.y), v.z < l.z ? l.z = v.z : v.z > u.z && (u.z = v.z);
    }
    /**
     * Update the `.aabb` property
     */
    updateAABB() {
      this.computeLocalAABB(this.aabb);
    }
    /**
     * Will update the `.boundingSphereRadius` property
     */
    updateBoundingSphereRadius() {
      let max2 = 0, vertices = this.vertices, v = new Vec3();
      for (let i = 0, N = vertices.length / 3; i !== N; i++) {
        this.getVertex(i, v);
        let norm2 = v.lengthSquared();
        norm2 > max2 && (max2 = norm2);
      }
      this.boundingSphereRadius = Math.sqrt(max2);
    }
    /**
     * calculateWorldAABB
     */
    calculateWorldAABB(pos, quat, min, max) {
      let frame = calculateWorldAABB_frame, result = calculateWorldAABB_aabb;
      frame.position = pos, frame.quaternion = quat, this.aabb.toWorldFrame(frame, result), min.copy(result.lowerBound), max.copy(result.upperBound);
    }
    /**
     * Get approximate volume
     */
    volume() {
      return 4 * Math.PI * this.boundingSphereRadius / 3;
    }
    /**
     * Create a Trimesh instance, shaped as a torus.
     */
    static createTorus(radius, tube, radialSegments, tubularSegments, arc) {
      radius === void 0 && (radius = 1), tube === void 0 && (tube = 0.5), radialSegments === void 0 && (radialSegments = 8), tubularSegments === void 0 && (tubularSegments = 6), arc === void 0 && (arc = Math.PI * 2);
      let vertices = [], indices = [];
      for (let j = 0; j <= radialSegments; j++)
        for (let i = 0; i <= tubularSegments; i++) {
          let u = i / tubularSegments * arc, v = j / radialSegments * Math.PI * 2, x = (radius + tube * Math.cos(v)) * Math.cos(u), y = (radius + tube * Math.cos(v)) * Math.sin(u), z = tube * Math.sin(v);
          vertices.push(x, y, z);
        }
      for (let j = 1; j <= radialSegments; j++)
        for (let i = 1; i <= tubularSegments; i++) {
          let a2 = (tubularSegments + 1) * j + i - 1, b2 = (tubularSegments + 1) * (j - 1) + i - 1, c2 = (tubularSegments + 1) * (j - 1) + i, d = (tubularSegments + 1) * j + i;
          indices.push(a2, b2, d), indices.push(b2, c2, d);
        }
      return new _Trimesh(vertices, indices);
    }
  }, computeNormals_n = new Vec3(), unscaledAABB = new AABB(), getEdgeVector_va = new Vec3(), getEdgeVector_vb = new Vec3(), cb = new Vec3(), ab = new Vec3(), va = new Vec3(), vb = new Vec3(), vc = new Vec3(), cli_aabb = new AABB(), computeLocalAABB_worldVert = new Vec3(), calculateWorldAABB_frame = new Transform(), calculateWorldAABB_aabb = new AABB(), Solver = class {
    /**
     * All equations to be solved
     */
    /**
     * @todo remove useless constructor
     */
    constructor() {
      this.equations = [];
    }
    /**
     * Should be implemented in subclasses!
     * @todo use abstract
     * @return number of iterations performed
     */
    solve(dt, world) {
      return (
        // Should return the number of iterations done!
        0
      );
    }
    /**
     * Add an equation
     */
    addEquation(eq) {
      eq.enabled && !eq.bi.isTrigger && !eq.bj.isTrigger && this.equations.push(eq);
    }
    /**
     * Remove an equation
     */
    removeEquation(eq) {
      let eqs = this.equations, i = eqs.indexOf(eq);
      i !== -1 && eqs.splice(i, 1);
    }
    /**
     * Add all equations
     */
    removeAllEquations() {
      this.equations.length = 0;
    }
  }, GSSolver = class extends Solver {
    /**
     * The number of solver iterations determines quality of the constraints in the world.
     * The more iterations, the more correct simulation. More iterations need more computations though. If you have a large gravity force in your world, you will need more iterations.
     */
    /**
     * When tolerance is reached, the system is assumed to be converged.
     */
    /**
     * @todo remove useless constructor
     */
    constructor() {
      super(), this.iterations = 10, this.tolerance = 1e-7;
    }
    /**
     * Solve
     * @return number of iterations performed
     */
    solve(dt, world) {
      let iter = 0, maxIter = this.iterations, tolSquared = this.tolerance * this.tolerance, equations = this.equations, Neq = equations.length, bodies = world.bodies, Nbodies = bodies.length, h = dt, B, invC, deltalambda, deltalambdaTot, GWlambda, lambdaj;
      if (Neq !== 0)
        for (let i = 0; i !== Nbodies; i++)
          bodies[i].updateSolveMassProperties();
      let invCs = GSSolver_solve_invCs, Bs = GSSolver_solve_Bs, lambda = GSSolver_solve_lambda;
      invCs.length = Neq, Bs.length = Neq, lambda.length = Neq;
      for (let i = 0; i !== Neq; i++) {
        let c2 = equations[i];
        lambda[i] = 0, Bs[i] = c2.computeB(h), invCs[i] = 1 / c2.computeC();
      }
      if (Neq !== 0) {
        for (let i = 0; i !== Nbodies; i++) {
          let b2 = bodies[i], vlambda = b2.vlambda, wlambda = b2.wlambda;
          vlambda.set(0, 0, 0), wlambda.set(0, 0, 0);
        }
        for (iter = 0; iter !== maxIter; iter++) {
          deltalambdaTot = 0;
          for (let j = 0; j !== Neq; j++) {
            let c2 = equations[j];
            B = Bs[j], invC = invCs[j], lambdaj = lambda[j], GWlambda = c2.computeGWlambda(), deltalambda = invC * (B - GWlambda - c2.eps * lambdaj), lambdaj + deltalambda < c2.minForce ? deltalambda = c2.minForce - lambdaj : lambdaj + deltalambda > c2.maxForce && (deltalambda = c2.maxForce - lambdaj), lambda[j] += deltalambda, deltalambdaTot += deltalambda > 0 ? deltalambda : -deltalambda, c2.addToWlambda(deltalambda);
          }
          if (deltalambdaTot * deltalambdaTot < tolSquared)
            break;
        }
        for (let i = 0; i !== Nbodies; i++) {
          let b2 = bodies[i], v = b2.velocity, w = b2.angularVelocity;
          b2.vlambda.vmul(b2.linearFactor, b2.vlambda), v.vadd(b2.vlambda, v), b2.wlambda.vmul(b2.angularFactor, b2.wlambda), w.vadd(b2.wlambda, w);
        }
        let l = equations.length, invDt = 1 / h;
        for (; l--; )
          equations[l].multiplier = lambda[l] * invDt;
      }
      return iter;
    }
  }, GSSolver_solve_lambda = [], GSSolver_solve_invCs = [], GSSolver_solve_Bs = [], SplitSolver = class extends Solver {
    /**
     * The number of solver iterations determines quality of the constraints in the world. The more iterations, the more correct simulation. More iterations need more computations though. If you have a large gravity force in your world, you will need more iterations.
     */
    /**
     * When tolerance is reached, the system is assumed to be converged.
     */
    /** subsolver */
    constructor(subsolver) {
      for (super(), this.iterations = 10, this.tolerance = 1e-7, this.subsolver = subsolver, this.nodes = [], this.nodePool = []; this.nodePool.length < 128; )
        this.nodePool.push(this.createNode());
    }
    /**
     * createNode
     */
    createNode() {
      return {
        body: null,
        children: [],
        eqs: [],
        visited: !1
      };
    }
    /**
     * Solve the subsystems
     * @return number of iterations performed
     */
    solve(dt, world) {
      let nodes = SplitSolver_solve_nodes, nodePool = this.nodePool, bodies = world.bodies, equations = this.equations, Neq = equations.length, Nbodies = bodies.length, subsolver = this.subsolver;
      for (; nodePool.length < Nbodies; )
        nodePool.push(this.createNode());
      nodes.length = Nbodies;
      for (let i = 0; i < Nbodies; i++)
        nodes[i] = nodePool[i];
      for (let i = 0; i !== Nbodies; i++) {
        let node = nodes[i];
        node.body = bodies[i], node.children.length = 0, node.eqs.length = 0, node.visited = !1;
      }
      for (let k = 0; k !== Neq; k++) {
        let eq = equations[k], i = bodies.indexOf(eq.bi), j = bodies.indexOf(eq.bj), ni = nodes[i], nj = nodes[j];
        ni.children.push(nj), ni.eqs.push(eq), nj.children.push(ni), nj.eqs.push(eq);
      }
      let child, n = 0, eqs = SplitSolver_solve_eqs;
      subsolver.tolerance = this.tolerance, subsolver.iterations = this.iterations;
      let dummyWorld = SplitSolver_solve_dummyWorld;
      for (; child = getUnvisitedNode(nodes); ) {
        eqs.length = 0, dummyWorld.bodies.length = 0, bfs(child, visitFunc, dummyWorld.bodies, eqs);
        let Neqs = eqs.length;
        eqs = eqs.sort(sortById);
        for (let i = 0; i !== Neqs; i++)
          subsolver.addEquation(eqs[i]);
        subsolver.solve(dt, dummyWorld), subsolver.removeAllEquations(), n++;
      }
      return n;
    }
  }, SplitSolver_solve_nodes = [], SplitSolver_solve_eqs = [], SplitSolver_solve_dummyWorld = {
    bodies: []
  }, STATIC = Body.STATIC;
  function getUnvisitedNode(nodes) {
    let Nnodes = nodes.length;
    for (let i = 0; i !== Nnodes; i++) {
      let node = nodes[i];
      if (!node.visited && !(node.body.type & STATIC))
        return node;
    }
    return !1;
  }
  var queue = [];
  function bfs(root, visitFunc2, bds, eqs) {
    for (queue.push(root), root.visited = !0, visitFunc2(root, bds, eqs); queue.length; ) {
      let node = queue.pop(), child;
      for (; child = getUnvisitedNode(node.children); )
        child.visited = !0, visitFunc2(child, bds, eqs), queue.push(child);
    }
  }
  function visitFunc(node, bds, eqs) {
    bds.push(node.body);
    let Neqs = node.eqs.length;
    for (let i = 0; i !== Neqs; i++) {
      let eq = node.eqs[i];
      eqs.includes(eq) || eqs.push(eq);
    }
  }
  function sortById(a2, b2) {
    return b2.id - a2.id;
  }
  var Pool = class {
    constructor() {
      this.objects = [], this.type = Object;
    }
    /**
     * Release an object after use
     */
    release() {
      let Nargs = arguments.length;
      for (let i = 0; i !== Nargs; i++)
        this.objects.push(i < 0 || arguments.length <= i ? void 0 : arguments[i]);
      return this;
    }
    /**
     * Get an object
     */
    get() {
      return this.objects.length === 0 ? this.constructObject() : this.objects.pop();
    }
    /**
     * Construct an object. Should be implemented in each subclass.
     */
    constructObject() {
      throw new Error("constructObject() not implemented in this Pool subclass yet!");
    }
    /**
     * @return Self, for chaining
     */
    resize(size) {
      let objects = this.objects;
      for (; objects.length > size; )
        objects.pop();
      for (; objects.length < size; )
        objects.push(this.constructObject());
      return this;
    }
  }, Vec3Pool = class extends Pool {
    constructor() {
      super(...arguments), this.type = Vec3;
    }
    /**
     * Construct a vector
     */
    constructObject() {
      return new Vec3();
    }
  }, COLLISION_TYPES = {
    sphereSphere: Shape.types.SPHERE,
    spherePlane: Shape.types.SPHERE | Shape.types.PLANE,
    boxBox: Shape.types.BOX | Shape.types.BOX,
    sphereBox: Shape.types.SPHERE | Shape.types.BOX,
    planeBox: Shape.types.PLANE | Shape.types.BOX,
    convexConvex: Shape.types.CONVEXPOLYHEDRON,
    sphereConvex: Shape.types.SPHERE | Shape.types.CONVEXPOLYHEDRON,
    planeConvex: Shape.types.PLANE | Shape.types.CONVEXPOLYHEDRON,
    boxConvex: Shape.types.BOX | Shape.types.CONVEXPOLYHEDRON,
    sphereHeightfield: Shape.types.SPHERE | Shape.types.HEIGHTFIELD,
    boxHeightfield: Shape.types.BOX | Shape.types.HEIGHTFIELD,
    convexHeightfield: Shape.types.CONVEXPOLYHEDRON | Shape.types.HEIGHTFIELD,
    sphereParticle: Shape.types.PARTICLE | Shape.types.SPHERE,
    planeParticle: Shape.types.PLANE | Shape.types.PARTICLE,
    boxParticle: Shape.types.BOX | Shape.types.PARTICLE,
    convexParticle: Shape.types.PARTICLE | Shape.types.CONVEXPOLYHEDRON,
    cylinderCylinder: Shape.types.CYLINDER,
    sphereCylinder: Shape.types.SPHERE | Shape.types.CYLINDER,
    planeCylinder: Shape.types.PLANE | Shape.types.CYLINDER,
    boxCylinder: Shape.types.BOX | Shape.types.CYLINDER,
    convexCylinder: Shape.types.CONVEXPOLYHEDRON | Shape.types.CYLINDER,
    heightfieldCylinder: Shape.types.HEIGHTFIELD | Shape.types.CYLINDER,
    particleCylinder: Shape.types.PARTICLE | Shape.types.CYLINDER,
    sphereTrimesh: Shape.types.SPHERE | Shape.types.TRIMESH,
    planeTrimesh: Shape.types.PLANE | Shape.types.TRIMESH
  }, Narrowphase = class {
    /**
     * Internal storage of pooled contact points.
     */
    /**
     * Pooled vectors.
     */
    get [COLLISION_TYPES.sphereSphere]() {
      return this.sphereSphere;
    }
    get [COLLISION_TYPES.spherePlane]() {
      return this.spherePlane;
    }
    get [COLLISION_TYPES.boxBox]() {
      return this.boxBox;
    }
    get [COLLISION_TYPES.sphereBox]() {
      return this.sphereBox;
    }
    get [COLLISION_TYPES.planeBox]() {
      return this.planeBox;
    }
    get [COLLISION_TYPES.convexConvex]() {
      return this.convexConvex;
    }
    get [COLLISION_TYPES.sphereConvex]() {
      return this.sphereConvex;
    }
    get [COLLISION_TYPES.planeConvex]() {
      return this.planeConvex;
    }
    get [COLLISION_TYPES.boxConvex]() {
      return this.boxConvex;
    }
    get [COLLISION_TYPES.sphereHeightfield]() {
      return this.sphereHeightfield;
    }
    get [COLLISION_TYPES.boxHeightfield]() {
      return this.boxHeightfield;
    }
    get [COLLISION_TYPES.convexHeightfield]() {
      return this.convexHeightfield;
    }
    get [COLLISION_TYPES.sphereParticle]() {
      return this.sphereParticle;
    }
    get [COLLISION_TYPES.planeParticle]() {
      return this.planeParticle;
    }
    get [COLLISION_TYPES.boxParticle]() {
      return this.boxParticle;
    }
    get [COLLISION_TYPES.convexParticle]() {
      return this.convexParticle;
    }
    get [COLLISION_TYPES.cylinderCylinder]() {
      return this.convexConvex;
    }
    get [COLLISION_TYPES.sphereCylinder]() {
      return this.sphereConvex;
    }
    get [COLLISION_TYPES.planeCylinder]() {
      return this.planeConvex;
    }
    get [COLLISION_TYPES.boxCylinder]() {
      return this.boxConvex;
    }
    get [COLLISION_TYPES.convexCylinder]() {
      return this.convexConvex;
    }
    get [COLLISION_TYPES.heightfieldCylinder]() {
      return this.heightfieldCylinder;
    }
    get [COLLISION_TYPES.particleCylinder]() {
      return this.particleCylinder;
    }
    get [COLLISION_TYPES.sphereTrimesh]() {
      return this.sphereTrimesh;
    }
    get [COLLISION_TYPES.planeTrimesh]() {
      return this.planeTrimesh;
    }
    // get [COLLISION_TYPES.convexTrimesh]() {
    //   return this.convexTrimesh
    // }
    constructor(world) {
      this.contactPointPool = [], this.frictionEquationPool = [], this.result = [], this.frictionResult = [], this.v3pool = new Vec3Pool(), this.world = world, this.currentContactMaterial = world.defaultContactMaterial, this.enableFrictionReduction = !1;
    }
    /**
     * Make a contact object, by using the internal pool or creating a new one.
     */
    createContactEquation(bi, bj, si, sj, overrideShapeA, overrideShapeB) {
      let c2;
      this.contactPointPool.length ? (c2 = this.contactPointPool.pop(), c2.bi = bi, c2.bj = bj) : c2 = new ContactEquation(bi, bj), c2.enabled = bi.collisionResponse && bj.collisionResponse && si.collisionResponse && sj.collisionResponse;
      let cm = this.currentContactMaterial;
      c2.restitution = cm.restitution, c2.setSpookParams(cm.contactEquationStiffness, cm.contactEquationRelaxation, this.world.dt);
      let matA = si.material || bi.material, matB = sj.material || bj.material;
      return matA && matB && matA.restitution >= 0 && matB.restitution >= 0 && (c2.restitution = matA.restitution * matB.restitution), c2.si = overrideShapeA || si, c2.sj = overrideShapeB || sj, c2;
    }
    createFrictionEquationsFromContact(contactEquation, outArray) {
      let bodyA = contactEquation.bi, bodyB = contactEquation.bj, shapeA = contactEquation.si, shapeB = contactEquation.sj, world = this.world, cm = this.currentContactMaterial, friction = cm.friction, matA = shapeA.material || bodyA.material, matB = shapeB.material || bodyB.material;
      if (matA && matB && matA.friction >= 0 && matB.friction >= 0 && (friction = matA.friction * matB.friction), friction > 0) {
        let mug = friction * (world.frictionGravity || world.gravity).length(), reducedMass = bodyA.invMass + bodyB.invMass;
        reducedMass > 0 && (reducedMass = 1 / reducedMass);
        let pool = this.frictionEquationPool, c1 = pool.length ? pool.pop() : new FrictionEquation(bodyA, bodyB, mug * reducedMass), c2 = pool.length ? pool.pop() : new FrictionEquation(bodyA, bodyB, mug * reducedMass);
        return c1.bi = c2.bi = bodyA, c1.bj = c2.bj = bodyB, c1.minForce = c2.minForce = -mug * reducedMass, c1.maxForce = c2.maxForce = mug * reducedMass, c1.ri.copy(contactEquation.ri), c1.rj.copy(contactEquation.rj), c2.ri.copy(contactEquation.ri), c2.rj.copy(contactEquation.rj), contactEquation.ni.tangents(c1.t, c2.t), c1.setSpookParams(cm.frictionEquationStiffness, cm.frictionEquationRelaxation, world.dt), c2.setSpookParams(cm.frictionEquationStiffness, cm.frictionEquationRelaxation, world.dt), c1.enabled = c2.enabled = contactEquation.enabled, outArray.push(c1, c2), !0;
      }
      return !1;
    }
    /**
     * Take the average N latest contact point on the plane.
     */
    createFrictionFromAverage(numContacts) {
      let c2 = this.result[this.result.length - 1];
      if (!this.createFrictionEquationsFromContact(c2, this.frictionResult) || numContacts === 1)
        return;
      let f1 = this.frictionResult[this.frictionResult.length - 2], f2 = this.frictionResult[this.frictionResult.length - 1];
      averageNormal.setZero(), averageContactPointA.setZero(), averageContactPointB.setZero();
      let bodyA = c2.bi;
      c2.bj;
      for (let i = 0; i !== numContacts; i++)
        c2 = this.result[this.result.length - 1 - i], c2.bi !== bodyA ? (averageNormal.vadd(c2.ni, averageNormal), averageContactPointA.vadd(c2.ri, averageContactPointA), averageContactPointB.vadd(c2.rj, averageContactPointB)) : (averageNormal.vsub(c2.ni, averageNormal), averageContactPointA.vadd(c2.rj, averageContactPointA), averageContactPointB.vadd(c2.ri, averageContactPointB));
      let invNumContacts = 1 / numContacts;
      averageContactPointA.scale(invNumContacts, f1.ri), averageContactPointB.scale(invNumContacts, f1.rj), f2.ri.copy(f1.ri), f2.rj.copy(f1.rj), averageNormal.normalize(), averageNormal.tangents(f1.t, f2.t);
    }
    /**
     * Generate all contacts between a list of body pairs
     * @param p1 Array of body indices
     * @param p2 Array of body indices
     * @param result Array to store generated contacts
     * @param oldcontacts Optional. Array of reusable contact objects
     */
    getContacts(p1, p2, world, result, oldcontacts, frictionResult, frictionPool) {
      this.contactPointPool = oldcontacts, this.frictionEquationPool = frictionPool, this.result = result, this.frictionResult = frictionResult;
      let qi = tmpQuat1, qj = tmpQuat2, xi = tmpVec1, xj = tmpVec2;
      for (let k = 0, N = p1.length; k !== N; k++) {
        let bi = p1[k], bj = p2[k], bodyContactMaterial = null;
        bi.material && bj.material && (bodyContactMaterial = world.getContactMaterial(bi.material, bj.material) || null);
        let justTest = bi.type & Body.KINEMATIC && bj.type & Body.STATIC || bi.type & Body.STATIC && bj.type & Body.KINEMATIC || bi.type & Body.KINEMATIC && bj.type & Body.KINEMATIC;
        for (let i = 0; i < bi.shapes.length; i++) {
          bi.quaternion.mult(bi.shapeOrientations[i], qi), bi.quaternion.vmult(bi.shapeOffsets[i], xi), xi.vadd(bi.position, xi);
          let si = bi.shapes[i];
          for (let j = 0; j < bj.shapes.length; j++) {
            bj.quaternion.mult(bj.shapeOrientations[j], qj), bj.quaternion.vmult(bj.shapeOffsets[j], xj), xj.vadd(bj.position, xj);
            let sj = bj.shapes[j];
            if (!(si.collisionFilterMask & sj.collisionFilterGroup && sj.collisionFilterMask & si.collisionFilterGroup) || xi.distanceTo(xj) > si.boundingSphereRadius + sj.boundingSphereRadius)
              continue;
            let shapeContactMaterial = null;
            si.material && sj.material && (shapeContactMaterial = world.getContactMaterial(si.material, sj.material) || null), this.currentContactMaterial = shapeContactMaterial || bodyContactMaterial || world.defaultContactMaterial;
            let resolverIndex = si.type | sj.type, resolver = this[resolverIndex];
            if (resolver) {
              let retval = !1;
              si.type < sj.type ? retval = resolver.call(this, si, sj, xi, xj, qi, qj, bi, bj, si, sj, justTest) : retval = resolver.call(this, sj, si, xj, xi, qj, qi, bj, bi, si, sj, justTest), retval && justTest && (world.shapeOverlapKeeper.set(si.id, sj.id), world.bodyOverlapKeeper.set(bi.id, bj.id));
            }
          }
        }
      }
    }
    sphereSphere(si, sj, xi, xj, qi, qj, bi, bj, rsi, rsj, justTest) {
      if (justTest)
        return xi.distanceSquared(xj) < (si.radius + sj.radius) ** 2;
      let contactEq = this.createContactEquation(bi, bj, si, sj, rsi, rsj);
      xj.vsub(xi, contactEq.ni), contactEq.ni.normalize(), contactEq.ri.copy(contactEq.ni), contactEq.rj.copy(contactEq.ni), contactEq.ri.scale(si.radius, contactEq.ri), contactEq.rj.scale(-sj.radius, contactEq.rj), contactEq.ri.vadd(xi, contactEq.ri), contactEq.ri.vsub(bi.position, contactEq.ri), contactEq.rj.vadd(xj, contactEq.rj), contactEq.rj.vsub(bj.position, contactEq.rj), this.result.push(contactEq), this.createFrictionEquationsFromContact(contactEq, this.frictionResult);
    }
    spherePlane(si, sj, xi, xj, qi, qj, bi, bj, rsi, rsj, justTest) {
      let r = this.createContactEquation(bi, bj, si, sj, rsi, rsj);
      if (r.ni.set(0, 0, 1), qj.vmult(r.ni, r.ni), r.ni.negate(r.ni), r.ni.normalize(), r.ni.scale(si.radius, r.ri), xi.vsub(xj, point_on_plane_to_sphere), r.ni.scale(r.ni.dot(point_on_plane_to_sphere), plane_to_sphere_ortho), point_on_plane_to_sphere.vsub(plane_to_sphere_ortho, r.rj), -point_on_plane_to_sphere.dot(r.ni) <= si.radius) {
        if (justTest)
          return !0;
        let ri = r.ri, rj = r.rj;
        ri.vadd(xi, ri), ri.vsub(bi.position, ri), rj.vadd(xj, rj), rj.vsub(bj.position, rj), this.result.push(r), this.createFrictionEquationsFromContact(r, this.frictionResult);
      }
    }
    boxBox(si, sj, xi, xj, qi, qj, bi, bj, rsi, rsj, justTest) {
      return si.convexPolyhedronRepresentation.material = si.material, sj.convexPolyhedronRepresentation.material = sj.material, si.convexPolyhedronRepresentation.collisionResponse = si.collisionResponse, sj.convexPolyhedronRepresentation.collisionResponse = sj.collisionResponse, this.convexConvex(si.convexPolyhedronRepresentation, sj.convexPolyhedronRepresentation, xi, xj, qi, qj, bi, bj, si, sj, justTest);
    }
    sphereBox(si, sj, xi, xj, qi, qj, bi, bj, rsi, rsj, justTest) {
      let v3pool = this.v3pool, sides = sphereBox_sides;
      xi.vsub(xj, box_to_sphere), sj.getSideNormals(sides, qj);
      let R = si.radius, found = !1, side_ns = sphereBox_side_ns, side_ns1 = sphereBox_side_ns1, side_ns2 = sphereBox_side_ns2, side_h = null, side_penetrations = 0, side_dot1 = 0, side_dot2 = 0, side_distance = null;
      for (let idx = 0, nsides = sides.length; idx !== nsides && found === !1; idx++) {
        let ns = sphereBox_ns;
        ns.copy(sides[idx]);
        let h = ns.length();
        ns.normalize();
        let dot = box_to_sphere.dot(ns);
        if (dot < h + R && dot > 0) {
          let ns1 = sphereBox_ns1, ns2 = sphereBox_ns2;
          ns1.copy(sides[(idx + 1) % 3]), ns2.copy(sides[(idx + 2) % 3]);
          let h1 = ns1.length(), h2 = ns2.length();
          ns1.normalize(), ns2.normalize();
          let dot1 = box_to_sphere.dot(ns1), dot2 = box_to_sphere.dot(ns2);
          if (dot1 < h1 && dot1 > -h1 && dot2 < h2 && dot2 > -h2) {
            let dist2 = Math.abs(dot - h - R);
            if ((side_distance === null || dist2 < side_distance) && (side_distance = dist2, side_dot1 = dot1, side_dot2 = dot2, side_h = h, side_ns.copy(ns), side_ns1.copy(ns1), side_ns2.copy(ns2), side_penetrations++, justTest))
              return !0;
          }
        }
      }
      if (side_penetrations) {
        found = !0;
        let r2 = this.createContactEquation(bi, bj, si, sj, rsi, rsj);
        side_ns.scale(-R, r2.ri), r2.ni.copy(side_ns), r2.ni.negate(r2.ni), side_ns.scale(side_h, side_ns), side_ns1.scale(side_dot1, side_ns1), side_ns.vadd(side_ns1, side_ns), side_ns2.scale(side_dot2, side_ns2), side_ns.vadd(side_ns2, r2.rj), r2.ri.vadd(xi, r2.ri), r2.ri.vsub(bi.position, r2.ri), r2.rj.vadd(xj, r2.rj), r2.rj.vsub(bj.position, r2.rj), this.result.push(r2), this.createFrictionEquationsFromContact(r2, this.frictionResult);
      }
      let rj = v3pool.get(), sphere_to_corner = sphereBox_sphere_to_corner;
      for (let j = 0; j !== 2 && !found; j++)
        for (let k = 0; k !== 2 && !found; k++)
          for (let l = 0; l !== 2 && !found; l++)
            if (rj.set(0, 0, 0), j ? rj.vadd(sides[0], rj) : rj.vsub(sides[0], rj), k ? rj.vadd(sides[1], rj) : rj.vsub(sides[1], rj), l ? rj.vadd(sides[2], rj) : rj.vsub(sides[2], rj), xj.vadd(rj, sphere_to_corner), sphere_to_corner.vsub(xi, sphere_to_corner), sphere_to_corner.lengthSquared() < R * R) {
              if (justTest)
                return !0;
              found = !0;
              let r2 = this.createContactEquation(bi, bj, si, sj, rsi, rsj);
              r2.ri.copy(sphere_to_corner), r2.ri.normalize(), r2.ni.copy(r2.ri), r2.ri.scale(R, r2.ri), r2.rj.copy(rj), r2.ri.vadd(xi, r2.ri), r2.ri.vsub(bi.position, r2.ri), r2.rj.vadd(xj, r2.rj), r2.rj.vsub(bj.position, r2.rj), this.result.push(r2), this.createFrictionEquationsFromContact(r2, this.frictionResult);
            }
      v3pool.release(rj), rj = null;
      let edgeTangent = v3pool.get(), edgeCenter = v3pool.get(), r = v3pool.get(), orthogonal = v3pool.get(), dist = v3pool.get(), Nsides = sides.length;
      for (let j = 0; j !== Nsides && !found; j++)
        for (let k = 0; k !== Nsides && !found; k++)
          if (j % 3 !== k % 3) {
            sides[k].cross(sides[j], edgeTangent), edgeTangent.normalize(), sides[j].vadd(sides[k], edgeCenter), r.copy(xi), r.vsub(edgeCenter, r), r.vsub(xj, r);
            let orthonorm = r.dot(edgeTangent);
            edgeTangent.scale(orthonorm, orthogonal);
            let l = 0;
            for (; l === j % 3 || l === k % 3; )
              l++;
            dist.copy(xi), dist.vsub(orthogonal, dist), dist.vsub(edgeCenter, dist), dist.vsub(xj, dist);
            let tdist = Math.abs(orthonorm), ndist = dist.length();
            if (tdist < sides[l].length() && ndist < R) {
              if (justTest)
                return !0;
              found = !0;
              let res = this.createContactEquation(bi, bj, si, sj, rsi, rsj);
              edgeCenter.vadd(orthogonal, res.rj), res.rj.copy(res.rj), dist.negate(res.ni), res.ni.normalize(), res.ri.copy(res.rj), res.ri.vadd(xj, res.ri), res.ri.vsub(xi, res.ri), res.ri.normalize(), res.ri.scale(R, res.ri), res.ri.vadd(xi, res.ri), res.ri.vsub(bi.position, res.ri), res.rj.vadd(xj, res.rj), res.rj.vsub(bj.position, res.rj), this.result.push(res), this.createFrictionEquationsFromContact(res, this.frictionResult);
            }
          }
      v3pool.release(edgeTangent, edgeCenter, r, orthogonal, dist);
    }
    planeBox(si, sj, xi, xj, qi, qj, bi, bj, rsi, rsj, justTest) {
      return sj.convexPolyhedronRepresentation.material = sj.material, sj.convexPolyhedronRepresentation.collisionResponse = sj.collisionResponse, sj.convexPolyhedronRepresentation.id = sj.id, this.planeConvex(si, sj.convexPolyhedronRepresentation, xi, xj, qi, qj, bi, bj, si, sj, justTest);
    }
    convexConvex(si, sj, xi, xj, qi, qj, bi, bj, rsi, rsj, justTest, faceListA, faceListB) {
      let sepAxis = convexConvex_sepAxis;
      if (!(xi.distanceTo(xj) > si.boundingSphereRadius + sj.boundingSphereRadius) && si.findSeparatingAxis(sj, xi, qi, xj, qj, sepAxis, faceListA, faceListB)) {
        let res = [], q = convexConvex_q;
        si.clipAgainstHull(xi, qi, sj, xj, qj, sepAxis, -100, 100, res);
        let numContacts = 0;
        for (let j = 0; j !== res.length; j++) {
          if (justTest)
            return !0;
          let r = this.createContactEquation(bi, bj, si, sj, rsi, rsj), ri = r.ri, rj = r.rj;
          sepAxis.negate(r.ni), res[j].normal.negate(q), q.scale(res[j].depth, q), res[j].point.vadd(q, ri), rj.copy(res[j].point), ri.vsub(xi, ri), rj.vsub(xj, rj), ri.vadd(xi, ri), ri.vsub(bi.position, ri), rj.vadd(xj, rj), rj.vsub(bj.position, rj), this.result.push(r), numContacts++, this.enableFrictionReduction || this.createFrictionEquationsFromContact(r, this.frictionResult);
        }
        this.enableFrictionReduction && numContacts && this.createFrictionFromAverage(numContacts);
      }
    }
    sphereConvex(si, sj, xi, xj, qi, qj, bi, bj, rsi, rsj, justTest) {
      let v3pool = this.v3pool;
      xi.vsub(xj, convex_to_sphere);
      let normals = sj.faceNormals, faces = sj.faces, verts = sj.vertices, R = si.radius, found = !1;
      for (let i = 0; i !== verts.length; i++) {
        let v = verts[i], worldCorner = sphereConvex_worldCorner;
        qj.vmult(v, worldCorner), xj.vadd(worldCorner, worldCorner);
        let sphere_to_corner = sphereConvex_sphereToCorner;
        if (worldCorner.vsub(xi, sphere_to_corner), sphere_to_corner.lengthSquared() < R * R) {
          if (justTest)
            return !0;
          found = !0;
          let r = this.createContactEquation(bi, bj, si, sj, rsi, rsj);
          r.ri.copy(sphere_to_corner), r.ri.normalize(), r.ni.copy(r.ri), r.ri.scale(R, r.ri), worldCorner.vsub(xj, r.rj), r.ri.vadd(xi, r.ri), r.ri.vsub(bi.position, r.ri), r.rj.vadd(xj, r.rj), r.rj.vsub(bj.position, r.rj), this.result.push(r), this.createFrictionEquationsFromContact(r, this.frictionResult);
          return;
        }
      }
      for (let i = 0, nfaces = faces.length; i !== nfaces && found === !1; i++) {
        let normal = normals[i], face = faces[i], worldNormal = sphereConvex_worldNormal;
        qj.vmult(normal, worldNormal);
        let worldPoint = sphereConvex_worldPoint;
        qj.vmult(verts[face[0]], worldPoint), worldPoint.vadd(xj, worldPoint);
        let worldSpherePointClosestToPlane = sphereConvex_worldSpherePointClosestToPlane;
        worldNormal.scale(-R, worldSpherePointClosestToPlane), xi.vadd(worldSpherePointClosestToPlane, worldSpherePointClosestToPlane);
        let penetrationVec = sphereConvex_penetrationVec;
        worldSpherePointClosestToPlane.vsub(worldPoint, penetrationVec);
        let penetration = penetrationVec.dot(worldNormal), worldPointToSphere = sphereConvex_sphereToWorldPoint;
        if (xi.vsub(worldPoint, worldPointToSphere), penetration < 0 && worldPointToSphere.dot(worldNormal) > 0) {
          let faceVerts = [];
          for (let j = 0, Nverts = face.length; j !== Nverts; j++) {
            let worldVertex = v3pool.get();
            qj.vmult(verts[face[j]], worldVertex), xj.vadd(worldVertex, worldVertex), faceVerts.push(worldVertex);
          }
          if (pointInPolygon(faceVerts, worldNormal, xi)) {
            if (justTest)
              return !0;
            found = !0;
            let r = this.createContactEquation(bi, bj, si, sj, rsi, rsj);
            worldNormal.scale(-R, r.ri), worldNormal.negate(r.ni);
            let penetrationVec2 = v3pool.get();
            worldNormal.scale(-penetration, penetrationVec2);
            let penetrationSpherePoint = v3pool.get();
            worldNormal.scale(-R, penetrationSpherePoint), xi.vsub(xj, r.rj), r.rj.vadd(penetrationSpherePoint, r.rj), r.rj.vadd(penetrationVec2, r.rj), r.rj.vadd(xj, r.rj), r.rj.vsub(bj.position, r.rj), r.ri.vadd(xi, r.ri), r.ri.vsub(bi.position, r.ri), v3pool.release(penetrationVec2), v3pool.release(penetrationSpherePoint), this.result.push(r), this.createFrictionEquationsFromContact(r, this.frictionResult);
            for (let j = 0, Nfaceverts = faceVerts.length; j !== Nfaceverts; j++)
              v3pool.release(faceVerts[j]);
            return;
          } else
            for (let j = 0; j !== face.length; j++) {
              let v12 = v3pool.get(), v22 = v3pool.get();
              qj.vmult(verts[face[(j + 1) % face.length]], v12), qj.vmult(verts[face[(j + 2) % face.length]], v22), xj.vadd(v12, v12), xj.vadd(v22, v22);
              let edge = sphereConvex_edge;
              v22.vsub(v12, edge);
              let edgeUnit = sphereConvex_edgeUnit;
              edge.unit(edgeUnit);
              let p = v3pool.get(), v1_to_xi = v3pool.get();
              xi.vsub(v12, v1_to_xi);
              let dot = v1_to_xi.dot(edgeUnit);
              edgeUnit.scale(dot, p), p.vadd(v12, p);
              let xi_to_p = v3pool.get();
              if (p.vsub(xi, xi_to_p), dot > 0 && dot * dot < edge.lengthSquared() && xi_to_p.lengthSquared() < R * R) {
                if (justTest)
                  return !0;
                let r = this.createContactEquation(bi, bj, si, sj, rsi, rsj);
                p.vsub(xj, r.rj), p.vsub(xi, r.ni), r.ni.normalize(), r.ni.scale(R, r.ri), r.rj.vadd(xj, r.rj), r.rj.vsub(bj.position, r.rj), r.ri.vadd(xi, r.ri), r.ri.vsub(bi.position, r.ri), this.result.push(r), this.createFrictionEquationsFromContact(r, this.frictionResult);
                for (let j2 = 0, Nfaceverts = faceVerts.length; j2 !== Nfaceverts; j2++)
                  v3pool.release(faceVerts[j2]);
                v3pool.release(v12), v3pool.release(v22), v3pool.release(p), v3pool.release(xi_to_p), v3pool.release(v1_to_xi);
                return;
              }
              v3pool.release(v12), v3pool.release(v22), v3pool.release(p), v3pool.release(xi_to_p), v3pool.release(v1_to_xi);
            }
          for (let j = 0, Nfaceverts = faceVerts.length; j !== Nfaceverts; j++)
            v3pool.release(faceVerts[j]);
        }
      }
    }
    planeConvex(planeShape, convexShape, planePosition, convexPosition, planeQuat, convexQuat, planeBody, convexBody, si, sj, justTest) {
      let worldVertex = planeConvex_v, worldNormal = planeConvex_normal;
      worldNormal.set(0, 0, 1), planeQuat.vmult(worldNormal, worldNormal);
      let numContacts = 0, relpos2 = planeConvex_relpos;
      for (let i = 0; i !== convexShape.vertices.length; i++)
        if (worldVertex.copy(convexShape.vertices[i]), convexQuat.vmult(worldVertex, worldVertex), convexPosition.vadd(worldVertex, worldVertex), worldVertex.vsub(planePosition, relpos2), worldNormal.dot(relpos2) <= 0) {
          if (justTest)
            return !0;
          let r = this.createContactEquation(planeBody, convexBody, planeShape, convexShape, si, sj), projected = planeConvex_projected;
          worldNormal.scale(worldNormal.dot(relpos2), projected), worldVertex.vsub(projected, projected), projected.vsub(planePosition, r.ri), r.ni.copy(worldNormal), worldVertex.vsub(convexPosition, r.rj), r.ri.vadd(planePosition, r.ri), r.ri.vsub(planeBody.position, r.ri), r.rj.vadd(convexPosition, r.rj), r.rj.vsub(convexBody.position, r.rj), this.result.push(r), numContacts++, this.enableFrictionReduction || this.createFrictionEquationsFromContact(r, this.frictionResult);
        }
      this.enableFrictionReduction && numContacts && this.createFrictionFromAverage(numContacts);
    }
    boxConvex(si, sj, xi, xj, qi, qj, bi, bj, rsi, rsj, justTest) {
      return si.convexPolyhedronRepresentation.material = si.material, si.convexPolyhedronRepresentation.collisionResponse = si.collisionResponse, this.convexConvex(si.convexPolyhedronRepresentation, sj, xi, xj, qi, qj, bi, bj, si, sj, justTest);
    }
    sphereHeightfield(sphereShape, hfShape, spherePos, hfPos, sphereQuat, hfQuat, sphereBody, hfBody, rsi, rsj, justTest) {
      let data = hfShape.data, radius = sphereShape.radius, w = hfShape.elementSize, worldPillarOffset2 = sphereHeightfield_tmp2, localSpherePos = sphereHeightfield_tmp1;
      Transform.pointToLocalFrame(hfPos, hfQuat, spherePos, localSpherePos);
      let iMinX = Math.floor((localSpherePos.x - radius) / w) - 1, iMaxX = Math.ceil((localSpherePos.x + radius) / w) + 1, iMinY = Math.floor((localSpherePos.y - radius) / w) - 1, iMaxY = Math.ceil((localSpherePos.y + radius) / w) + 1;
      if (iMaxX < 0 || iMaxY < 0 || iMinX > data.length || iMinY > data[0].length)
        return;
      iMinX < 0 && (iMinX = 0), iMaxX < 0 && (iMaxX = 0), iMinY < 0 && (iMinY = 0), iMaxY < 0 && (iMaxY = 0), iMinX >= data.length && (iMinX = data.length - 1), iMaxX >= data.length && (iMaxX = data.length - 1), iMaxY >= data[0].length && (iMaxY = data[0].length - 1), iMinY >= data[0].length && (iMinY = data[0].length - 1);
      let minMax = [];
      hfShape.getRectMinMax(iMinX, iMinY, iMaxX, iMaxY, minMax);
      let min = minMax[0], max = minMax[1];
      if (localSpherePos.z - radius > max || localSpherePos.z + radius < min)
        return;
      let result = this.result;
      for (let i = iMinX; i < iMaxX; i++)
        for (let j = iMinY; j < iMaxY; j++) {
          let numContactsBefore = result.length, intersecting = !1;
          if (hfShape.getConvexTrianglePillar(i, j, !1), Transform.pointToWorldFrame(hfPos, hfQuat, hfShape.pillarOffset, worldPillarOffset2), spherePos.distanceTo(worldPillarOffset2) < hfShape.pillarConvex.boundingSphereRadius + sphereShape.boundingSphereRadius && (intersecting = this.sphereConvex(sphereShape, hfShape.pillarConvex, spherePos, worldPillarOffset2, sphereQuat, hfQuat, sphereBody, hfBody, sphereShape, hfShape, justTest)), justTest && intersecting || (hfShape.getConvexTrianglePillar(i, j, !0), Transform.pointToWorldFrame(hfPos, hfQuat, hfShape.pillarOffset, worldPillarOffset2), spherePos.distanceTo(worldPillarOffset2) < hfShape.pillarConvex.boundingSphereRadius + sphereShape.boundingSphereRadius && (intersecting = this.sphereConvex(sphereShape, hfShape.pillarConvex, spherePos, worldPillarOffset2, sphereQuat, hfQuat, sphereBody, hfBody, sphereShape, hfShape, justTest)), justTest && intersecting))
            return !0;
          if (result.length - numContactsBefore > 2)
            return;
        }
    }
    boxHeightfield(si, sj, xi, xj, qi, qj, bi, bj, rsi, rsj, justTest) {
      return si.convexPolyhedronRepresentation.material = si.material, si.convexPolyhedronRepresentation.collisionResponse = si.collisionResponse, this.convexHeightfield(si.convexPolyhedronRepresentation, sj, xi, xj, qi, qj, bi, bj, si, sj, justTest);
    }
    convexHeightfield(convexShape, hfShape, convexPos, hfPos, convexQuat, hfQuat, convexBody, hfBody, rsi, rsj, justTest) {
      let data = hfShape.data, w = hfShape.elementSize, radius = convexShape.boundingSphereRadius, worldPillarOffset2 = convexHeightfield_tmp2, faceList = convexHeightfield_faceList, localConvexPos = convexHeightfield_tmp1;
      Transform.pointToLocalFrame(hfPos, hfQuat, convexPos, localConvexPos);
      let iMinX = Math.floor((localConvexPos.x - radius) / w) - 1, iMaxX = Math.ceil((localConvexPos.x + radius) / w) + 1, iMinY = Math.floor((localConvexPos.y - radius) / w) - 1, iMaxY = Math.ceil((localConvexPos.y + radius) / w) + 1;
      if (iMaxX < 0 || iMaxY < 0 || iMinX > data.length || iMinY > data[0].length)
        return;
      iMinX < 0 && (iMinX = 0), iMaxX < 0 && (iMaxX = 0), iMinY < 0 && (iMinY = 0), iMaxY < 0 && (iMaxY = 0), iMinX >= data.length && (iMinX = data.length - 1), iMaxX >= data.length && (iMaxX = data.length - 1), iMaxY >= data[0].length && (iMaxY = data[0].length - 1), iMinY >= data[0].length && (iMinY = data[0].length - 1);
      let minMax = [];
      hfShape.getRectMinMax(iMinX, iMinY, iMaxX, iMaxY, minMax);
      let min = minMax[0], max = minMax[1];
      if (!(localConvexPos.z - radius > max || localConvexPos.z + radius < min))
        for (let i = iMinX; i < iMaxX; i++)
          for (let j = iMinY; j < iMaxY; j++) {
            let intersecting = !1;
            if (hfShape.getConvexTrianglePillar(i, j, !1), Transform.pointToWorldFrame(hfPos, hfQuat, hfShape.pillarOffset, worldPillarOffset2), convexPos.distanceTo(worldPillarOffset2) < hfShape.pillarConvex.boundingSphereRadius + convexShape.boundingSphereRadius && (intersecting = this.convexConvex(convexShape, hfShape.pillarConvex, convexPos, worldPillarOffset2, convexQuat, hfQuat, convexBody, hfBody, null, null, justTest, faceList, null)), justTest && intersecting || (hfShape.getConvexTrianglePillar(i, j, !0), Transform.pointToWorldFrame(hfPos, hfQuat, hfShape.pillarOffset, worldPillarOffset2), convexPos.distanceTo(worldPillarOffset2) < hfShape.pillarConvex.boundingSphereRadius + convexShape.boundingSphereRadius && (intersecting = this.convexConvex(convexShape, hfShape.pillarConvex, convexPos, worldPillarOffset2, convexQuat, hfQuat, convexBody, hfBody, null, null, justTest, faceList, null)), justTest && intersecting))
              return !0;
          }
    }
    sphereParticle(sj, si, xj, xi, qj, qi, bj, bi, rsi, rsj, justTest) {
      let normal = particleSphere_normal;
      if (normal.set(0, 0, 1), xi.vsub(xj, normal), normal.lengthSquared() <= sj.radius * sj.radius) {
        if (justTest)
          return !0;
        let r = this.createContactEquation(bi, bj, si, sj, rsi, rsj);
        normal.normalize(), r.rj.copy(normal), r.rj.scale(sj.radius, r.rj), r.ni.copy(normal), r.ni.negate(r.ni), r.ri.set(0, 0, 0), this.result.push(r), this.createFrictionEquationsFromContact(r, this.frictionResult);
      }
    }
    planeParticle(sj, si, xj, xi, qj, qi, bj, bi, rsi, rsj, justTest) {
      let normal = particlePlane_normal;
      normal.set(0, 0, 1), bj.quaternion.vmult(normal, normal);
      let relpos2 = particlePlane_relpos;
      if (xi.vsub(bj.position, relpos2), normal.dot(relpos2) <= 0) {
        if (justTest)
          return !0;
        let r = this.createContactEquation(bi, bj, si, sj, rsi, rsj);
        r.ni.copy(normal), r.ni.negate(r.ni), r.ri.set(0, 0, 0);
        let projected = particlePlane_projected;
        normal.scale(normal.dot(xi), projected), xi.vsub(projected, projected), r.rj.copy(projected), this.result.push(r), this.createFrictionEquationsFromContact(r, this.frictionResult);
      }
    }
    boxParticle(si, sj, xi, xj, qi, qj, bi, bj, rsi, rsj, justTest) {
      return si.convexPolyhedronRepresentation.material = si.material, si.convexPolyhedronRepresentation.collisionResponse = si.collisionResponse, this.convexParticle(si.convexPolyhedronRepresentation, sj, xi, xj, qi, qj, bi, bj, si, sj, justTest);
    }
    convexParticle(sj, si, xj, xi, qj, qi, bj, bi, rsi, rsj, justTest) {
      let penetratedFaceIndex = -1, penetratedFaceNormal = convexParticle_penetratedFaceNormal, worldPenetrationVec = convexParticle_worldPenetrationVec, minPenetration = null, local = convexParticle_local;
      if (local.copy(xi), local.vsub(xj, local), qj.conjugate(cqj), cqj.vmult(local, local), sj.pointIsInside(local)) {
        sj.worldVerticesNeedsUpdate && sj.computeWorldVertices(xj, qj), sj.worldFaceNormalsNeedsUpdate && sj.computeWorldFaceNormals(qj);
        for (let i = 0, nfaces = sj.faces.length; i !== nfaces; i++) {
          let verts = [sj.worldVertices[sj.faces[i][0]]], normal = sj.worldFaceNormals[i];
          xi.vsub(verts[0], convexParticle_vertexToParticle);
          let penetration = -normal.dot(convexParticle_vertexToParticle);
          if (minPenetration === null || Math.abs(penetration) < Math.abs(minPenetration)) {
            if (justTest)
              return !0;
            minPenetration = penetration, penetratedFaceIndex = i, penetratedFaceNormal.copy(normal);
          }
        }
        if (penetratedFaceIndex !== -1) {
          let r = this.createContactEquation(bi, bj, si, sj, rsi, rsj);
          penetratedFaceNormal.scale(minPenetration, worldPenetrationVec), worldPenetrationVec.vadd(xi, worldPenetrationVec), worldPenetrationVec.vsub(xj, worldPenetrationVec), r.rj.copy(worldPenetrationVec), penetratedFaceNormal.negate(r.ni), r.ri.set(0, 0, 0);
          let ri = r.ri, rj = r.rj;
          ri.vadd(xi, ri), ri.vsub(bi.position, ri), rj.vadd(xj, rj), rj.vsub(bj.position, rj), this.result.push(r), this.createFrictionEquationsFromContact(r, this.frictionResult);
        } else
          console.warn("Point found inside convex, but did not find penetrating face!");
      }
    }
    heightfieldCylinder(hfShape, convexShape, hfPos, convexPos, hfQuat, convexQuat, hfBody, convexBody, rsi, rsj, justTest) {
      return this.convexHeightfield(convexShape, hfShape, convexPos, hfPos, convexQuat, hfQuat, convexBody, hfBody, rsi, rsj, justTest);
    }
    particleCylinder(si, sj, xi, xj, qi, qj, bi, bj, rsi, rsj, justTest) {
      return this.convexParticle(sj, si, xj, xi, qj, qi, bj, bi, rsi, rsj, justTest);
    }
    sphereTrimesh(sphereShape, trimeshShape, spherePos, trimeshPos, sphereQuat, trimeshQuat, sphereBody, trimeshBody, rsi, rsj, justTest) {
      let edgeVertexA = sphereTrimesh_edgeVertexA, edgeVertexB = sphereTrimesh_edgeVertexB, edgeVector = sphereTrimesh_edgeVector, edgeVectorUnit = sphereTrimesh_edgeVectorUnit, localSpherePos = sphereTrimesh_localSpherePos, tmp2 = sphereTrimesh_tmp, localSphereAABB = sphereTrimesh_localSphereAABB, v22 = sphereTrimesh_v2, relpos2 = sphereTrimesh_relpos, triangles = sphereTrimesh_triangles;
      Transform.pointToLocalFrame(trimeshPos, trimeshQuat, spherePos, localSpherePos);
      let sphereRadius = sphereShape.radius;
      localSphereAABB.lowerBound.set(localSpherePos.x - sphereRadius, localSpherePos.y - sphereRadius, localSpherePos.z - sphereRadius), localSphereAABB.upperBound.set(localSpherePos.x + sphereRadius, localSpherePos.y + sphereRadius, localSpherePos.z + sphereRadius), trimeshShape.getTrianglesInAABB(localSphereAABB, triangles);
      let v = sphereTrimesh_v, radiusSquared = sphereShape.radius * sphereShape.radius;
      for (let i = 0; i < triangles.length; i++)
        for (let j = 0; j < 3; j++)
          if (trimeshShape.getVertex(trimeshShape.indices[triangles[i] * 3 + j], v), v.vsub(localSpherePos, relpos2), relpos2.lengthSquared() <= radiusSquared) {
            if (v22.copy(v), Transform.pointToWorldFrame(trimeshPos, trimeshQuat, v22, v), v.vsub(spherePos, relpos2), justTest)
              return !0;
            let r = this.createContactEquation(sphereBody, trimeshBody, sphereShape, trimeshShape, rsi, rsj);
            r.ni.copy(relpos2), r.ni.normalize(), r.ri.copy(r.ni), r.ri.scale(sphereShape.radius, r.ri), r.ri.vadd(spherePos, r.ri), r.ri.vsub(sphereBody.position, r.ri), r.rj.copy(v), r.rj.vsub(trimeshBody.position, r.rj), this.result.push(r), this.createFrictionEquationsFromContact(r, this.frictionResult);
          }
      for (let i = 0; i < triangles.length; i++)
        for (let j = 0; j < 3; j++) {
          trimeshShape.getVertex(trimeshShape.indices[triangles[i] * 3 + j], edgeVertexA), trimeshShape.getVertex(trimeshShape.indices[triangles[i] * 3 + (j + 1) % 3], edgeVertexB), edgeVertexB.vsub(edgeVertexA, edgeVector), localSpherePos.vsub(edgeVertexB, tmp2);
          let positionAlongEdgeB = tmp2.dot(edgeVector);
          localSpherePos.vsub(edgeVertexA, tmp2);
          let positionAlongEdgeA = tmp2.dot(edgeVector);
          if (positionAlongEdgeA > 0 && positionAlongEdgeB < 0 && (localSpherePos.vsub(edgeVertexA, tmp2), edgeVectorUnit.copy(edgeVector), edgeVectorUnit.normalize(), positionAlongEdgeA = tmp2.dot(edgeVectorUnit), edgeVectorUnit.scale(positionAlongEdgeA, tmp2), tmp2.vadd(edgeVertexA, tmp2), tmp2.distanceTo(localSpherePos) < sphereShape.radius)) {
            if (justTest)
              return !0;
            let r = this.createContactEquation(sphereBody, trimeshBody, sphereShape, trimeshShape, rsi, rsj);
            tmp2.vsub(localSpherePos, r.ni), r.ni.normalize(), r.ni.scale(sphereShape.radius, r.ri), r.ri.vadd(spherePos, r.ri), r.ri.vsub(sphereBody.position, r.ri), Transform.pointToWorldFrame(trimeshPos, trimeshQuat, tmp2, tmp2), tmp2.vsub(trimeshBody.position, r.rj), Transform.vectorToWorldFrame(trimeshQuat, r.ni, r.ni), Transform.vectorToWorldFrame(trimeshQuat, r.ri, r.ri), this.result.push(r), this.createFrictionEquationsFromContact(r, this.frictionResult);
          }
        }
      let va2 = sphereTrimesh_va, vb2 = sphereTrimesh_vb, vc2 = sphereTrimesh_vc, normal = sphereTrimesh_normal;
      for (let i = 0, N = triangles.length; i !== N; i++) {
        trimeshShape.getTriangleVertices(triangles[i], va2, vb2, vc2), trimeshShape.getNormal(triangles[i], normal), localSpherePos.vsub(va2, tmp2);
        let dist = tmp2.dot(normal);
        if (normal.scale(dist, tmp2), localSpherePos.vsub(tmp2, tmp2), dist = tmp2.distanceTo(localSpherePos), Ray.pointInTriangle(tmp2, va2, vb2, vc2) && dist < sphereShape.radius) {
          if (justTest)
            return !0;
          let r = this.createContactEquation(sphereBody, trimeshBody, sphereShape, trimeshShape, rsi, rsj);
          tmp2.vsub(localSpherePos, r.ni), r.ni.normalize(), r.ni.scale(sphereShape.radius, r.ri), r.ri.vadd(spherePos, r.ri), r.ri.vsub(sphereBody.position, r.ri), Transform.pointToWorldFrame(trimeshPos, trimeshQuat, tmp2, tmp2), tmp2.vsub(trimeshBody.position, r.rj), Transform.vectorToWorldFrame(trimeshQuat, r.ni, r.ni), Transform.vectorToWorldFrame(trimeshQuat, r.ri, r.ri), this.result.push(r), this.createFrictionEquationsFromContact(r, this.frictionResult);
        }
      }
      triangles.length = 0;
    }
    planeTrimesh(planeShape, trimeshShape, planePos, trimeshPos, planeQuat, trimeshQuat, planeBody, trimeshBody, rsi, rsj, justTest) {
      let v = new Vec3(), normal = planeTrimesh_normal;
      normal.set(0, 0, 1), planeQuat.vmult(normal, normal);
      for (let i = 0; i < trimeshShape.vertices.length / 3; i++) {
        trimeshShape.getVertex(i, v);
        let v22 = new Vec3();
        v22.copy(v), Transform.pointToWorldFrame(trimeshPos, trimeshQuat, v22, v);
        let relpos2 = planeTrimesh_relpos;
        if (v.vsub(planePos, relpos2), normal.dot(relpos2) <= 0) {
          if (justTest)
            return !0;
          let r = this.createContactEquation(planeBody, trimeshBody, planeShape, trimeshShape, rsi, rsj);
          r.ni.copy(normal);
          let projected = planeTrimesh_projected;
          normal.scale(relpos2.dot(normal), projected), v.vsub(projected, projected), r.ri.copy(projected), r.ri.vsub(planeBody.position, r.ri), r.rj.copy(v), r.rj.vsub(trimeshBody.position, r.rj), this.result.push(r), this.createFrictionEquationsFromContact(r, this.frictionResult);
        }
      }
    }
    // convexTrimesh(
    //   si: ConvexPolyhedron, sj: Trimesh, xi: Vec3, xj: Vec3, qi: Quaternion, qj: Quaternion,
    //   bi: Body, bj: Body, rsi?: Shape | null, rsj?: Shape | null,
    //   faceListA?: number[] | null, faceListB?: number[] | null,
    // ) {
    //   const sepAxis = convexConvex_sepAxis;
    //   if(xi.distanceTo(xj) > si.boundingSphereRadius + sj.boundingSphereRadius){
    //       return;
    //   }
    //   // Construct a temp hull for each triangle
    //   const hullB = new ConvexPolyhedron();
    //   hullB.faces = [[0,1,2]];
    //   const va = new Vec3();
    //   const vb = new Vec3();
    //   const vc = new Vec3();
    //   hullB.vertices = [
    //       va,
    //       vb,
    //       vc
    //   ];
    //   for (let i = 0; i < sj.indices.length / 3; i++) {
    //       const triangleNormal = new Vec3();
    //       sj.getNormal(i, triangleNormal);
    //       hullB.faceNormals = [triangleNormal];
    //       sj.getTriangleVertices(i, va, vb, vc);
    //       let d = si.testSepAxis(triangleNormal, hullB, xi, qi, xj, qj);
    //       if(!d){
    //           triangleNormal.scale(-1, triangleNormal);
    //           d = si.testSepAxis(triangleNormal, hullB, xi, qi, xj, qj);
    //           if(!d){
    //               continue;
    //           }
    //       }
    //       const res: ConvexPolyhedronContactPoint[] = [];
    //       const q = convexConvex_q;
    //       si.clipAgainstHull(xi,qi,hullB,xj,qj,triangleNormal,-100,100,res);
    //       for(let j = 0; j !== res.length; j++){
    //           const r = this.createContactEquation(bi,bj,si,sj,rsi,rsj),
    //               ri = r.ri,
    //               rj = r.rj;
    //           r.ni.copy(triangleNormal);
    //           r.ni.negate(r.ni);
    //           res[j].normal.negate(q);
    //           q.mult(res[j].depth, q);
    //           res[j].point.vadd(q, ri);
    //           rj.copy(res[j].point);
    //           // Contact points are in world coordinates. Transform back to relative
    //           ri.vsub(xi,ri);
    //           rj.vsub(xj,rj);
    //           // Make relative to bodies
    //           ri.vadd(xi, ri);
    //           ri.vsub(bi.position, ri);
    //           rj.vadd(xj, rj);
    //           rj.vsub(bj.position, rj);
    //           result.push(r);
    //       }
    //   }
    // }
  }, averageNormal = new Vec3(), averageContactPointA = new Vec3(), averageContactPointB = new Vec3(), tmpVec1 = new Vec3(), tmpVec2 = new Vec3(), tmpQuat1 = new Quaternion(), tmpQuat2 = new Quaternion(), planeTrimesh_normal = new Vec3(), planeTrimesh_relpos = new Vec3(), planeTrimesh_projected = new Vec3(), sphereTrimesh_normal = new Vec3(), sphereTrimesh_relpos = new Vec3();
  new Vec3();
  var sphereTrimesh_v = new Vec3(), sphereTrimesh_v2 = new Vec3(), sphereTrimesh_edgeVertexA = new Vec3(), sphereTrimesh_edgeVertexB = new Vec3(), sphereTrimesh_edgeVector = new Vec3(), sphereTrimesh_edgeVectorUnit = new Vec3(), sphereTrimesh_localSpherePos = new Vec3(), sphereTrimesh_tmp = new Vec3(), sphereTrimesh_va = new Vec3(), sphereTrimesh_vb = new Vec3(), sphereTrimesh_vc = new Vec3(), sphereTrimesh_localSphereAABB = new AABB(), sphereTrimesh_triangles = [], point_on_plane_to_sphere = new Vec3(), plane_to_sphere_ortho = new Vec3(), pointInPolygon_edge = new Vec3(), pointInPolygon_edge_x_normal = new Vec3(), pointInPolygon_vtp = new Vec3();
  function pointInPolygon(verts, normal, p) {
    let positiveResult = null, N = verts.length;
    for (let i = 0; i !== N; i++) {
      let v = verts[i], edge = pointInPolygon_edge;
      verts[(i + 1) % N].vsub(v, edge);
      let edge_x_normal = pointInPolygon_edge_x_normal;
      edge.cross(normal, edge_x_normal);
      let vertex_to_p = pointInPolygon_vtp;
      p.vsub(v, vertex_to_p);
      let r = edge_x_normal.dot(vertex_to_p);
      if (positiveResult === null || r > 0 && positiveResult === !0 || r <= 0 && positiveResult === !1) {
        positiveResult === null && (positiveResult = r > 0);
        continue;
      } else
        return !1;
    }
    return !0;
  }
  var box_to_sphere = new Vec3(), sphereBox_ns = new Vec3(), sphereBox_ns1 = new Vec3(), sphereBox_ns2 = new Vec3(), sphereBox_sides = [new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3(), new Vec3()], sphereBox_sphere_to_corner = new Vec3(), sphereBox_side_ns = new Vec3(), sphereBox_side_ns1 = new Vec3(), sphereBox_side_ns2 = new Vec3(), convex_to_sphere = new Vec3(), sphereConvex_edge = new Vec3(), sphereConvex_edgeUnit = new Vec3(), sphereConvex_sphereToCorner = new Vec3(), sphereConvex_worldCorner = new Vec3(), sphereConvex_worldNormal = new Vec3(), sphereConvex_worldPoint = new Vec3(), sphereConvex_worldSpherePointClosestToPlane = new Vec3(), sphereConvex_penetrationVec = new Vec3(), sphereConvex_sphereToWorldPoint = new Vec3();
  new Vec3();
  new Vec3();
  var planeConvex_v = new Vec3(), planeConvex_normal = new Vec3(), planeConvex_relpos = new Vec3(), planeConvex_projected = new Vec3(), convexConvex_sepAxis = new Vec3(), convexConvex_q = new Vec3(), particlePlane_normal = new Vec3(), particlePlane_relpos = new Vec3(), particlePlane_projected = new Vec3(), particleSphere_normal = new Vec3(), cqj = new Quaternion(), convexParticle_local = new Vec3();
  new Vec3();
  var convexParticle_penetratedFaceNormal = new Vec3(), convexParticle_vertexToParticle = new Vec3(), convexParticle_worldPenetrationVec = new Vec3(), convexHeightfield_tmp1 = new Vec3(), convexHeightfield_tmp2 = new Vec3(), convexHeightfield_faceList = [0], sphereHeightfield_tmp1 = new Vec3(), sphereHeightfield_tmp2 = new Vec3(), OverlapKeeper = class {
    /**
     * @todo Remove useless constructor
     */
    constructor() {
      this.current = [], this.previous = [];
    }
    /**
     * getKey
     */
    getKey(i, j) {
      if (j < i) {
        let temp = j;
        j = i, i = temp;
      }
      return i << 16 | j;
    }
    /**
     * set
     */
    set(i, j) {
      let key = this.getKey(i, j), current = this.current, index = 0;
      for (; key > current[index]; )
        index++;
      if (key !== current[index]) {
        for (let j2 = current.length - 1; j2 >= index; j2--)
          current[j2 + 1] = current[j2];
        current[index] = key;
      }
    }
    /**
     * tick
     */
    tick() {
      let tmp2 = this.current;
      this.current = this.previous, this.previous = tmp2, this.current.length = 0;
    }
    /**
     * getDiff
     */
    getDiff(additions2, removals2) {
      let a2 = this.current, b2 = this.previous, al = a2.length, bl = b2.length, j = 0;
      for (let i = 0; i < al; i++) {
        let found = !1, keyA = a2[i];
        for (; keyA > b2[j]; )
          j++;
        found = keyA === b2[j], found || unpackAndPush(additions2, keyA);
      }
      j = 0;
      for (let i = 0; i < bl; i++) {
        let found = !1, keyB = b2[i];
        for (; keyB > a2[j]; )
          j++;
        found = a2[j] === keyB, found || unpackAndPush(removals2, keyB);
      }
    }
  };
  function unpackAndPush(array, key) {
    array.push((key & 4294901760) >> 16, key & 65535);
  }
  var getKey = (i, j) => i < j ? `${i}-${j}` : `${j}-${i}`, TupleDictionary = class {
    constructor() {
      this.data = {
        keys: []
      };
    }
    /** get */
    get(i, j) {
      let key = getKey(i, j);
      return this.data[key];
    }
    /** set */
    set(i, j, value) {
      let key = getKey(i, j);
      this.get(i, j) || this.data.keys.push(key), this.data[key] = value;
    }
    /** delete */
    delete(i, j) {
      let key = getKey(i, j), index = this.data.keys.indexOf(key);
      index !== -1 && this.data.keys.splice(index, 1), delete this.data[key];
    }
    /** reset */
    reset() {
      let data = this.data, keys = data.keys;
      for (; keys.length > 0; ) {
        let key = keys.pop();
        delete data[key];
      }
    }
  }, World = class extends EventTarget {
    /**
     * Currently / last used timestep. Is set to -1 if not available. This value is updated before each internal step, which means that it is "fresh" inside event callbacks.
     */
    /**
     * Makes bodies go to sleep when they've been inactive.
     * @default false
     */
    /**
     * All the current contacts (instances of ContactEquation) in the world.
     */
    /**
     * How often to normalize quaternions. Set to 0 for every step, 1 for every second etc.. A larger value increases performance. If bodies tend to explode, set to a smaller value (zero to be sure nothing can go wrong).
     * @default 0
     */
    /**
     * Set to true to use fast quaternion normalization. It is often enough accurate to use.
     * If bodies tend to explode, set to false.
     * @default false
     */
    /**
     * The wall-clock time since simulation start.
     */
    /**
     * Number of timesteps taken since start.
     */
    /**
     * Default and last timestep sizes.
     */
    /**
     * The gravity of the world.
     */
    /**
     * Gravity to use when approximating the friction max force (mu*mass*gravity).
     * If undefined, global gravity will be used.
     * Use to enable friction in a World with a null gravity vector (no gravity).
     */
    /**
     * The broadphase algorithm to use.
     * @default NaiveBroadphase
     */
    /**
     * All bodies in this world
     */
    /**
     * True if any bodies are not sleeping, false if every body is sleeping.
     */
    /**
     * The solver algorithm to use.
     * @default GSSolver
     */
    /**
     * collisionMatrix
     */
    /**
     * CollisionMatrix from the previous step.
     */
    /**
     * All added contactmaterials.
     */
    /**
     * Used to look up a ContactMaterial given two instances of Material.
     */
    /**
     * The default material of the bodies.
     */
    /**
     * This contact material is used if no suitable contactmaterial is found for a contact.
     */
    /**
     * Time accumulator for interpolation.
     * @see https://gafferongames.com/game-physics/fix-your-timestep/
     */
    /**
     * Dispatched after a body has been added to the world.
     */
    /**
     * Dispatched after a body has been removed from the world.
     */
    constructor(options) {
      options === void 0 && (options = {}), super(), this.dt = -1, this.allowSleep = !!options.allowSleep, this.contacts = [], this.frictionEquations = [], this.quatNormalizeSkip = options.quatNormalizeSkip !== void 0 ? options.quatNormalizeSkip : 0, this.quatNormalizeFast = options.quatNormalizeFast !== void 0 ? options.quatNormalizeFast : !1, this.time = 0, this.stepnumber = 0, this.default_dt = 1 / 60, this.nextId = 0, this.gravity = new Vec3(), options.gravity && this.gravity.copy(options.gravity), options.frictionGravity && (this.frictionGravity = new Vec3(), this.frictionGravity.copy(options.frictionGravity)), this.broadphase = options.broadphase !== void 0 ? options.broadphase : new NaiveBroadphase(), this.bodies = [], this.hasActiveBodies = !1, this.solver = options.solver !== void 0 ? options.solver : new GSSolver(), this.constraints = [], this.narrowphase = new Narrowphase(this), this.collisionMatrix = new ArrayCollisionMatrix(), this.collisionMatrixPrevious = new ArrayCollisionMatrix(), this.bodyOverlapKeeper = new OverlapKeeper(), this.shapeOverlapKeeper = new OverlapKeeper(), this.contactmaterials = [], this.contactMaterialTable = new TupleDictionary(), this.defaultMaterial = new Material("default"), this.defaultContactMaterial = new ContactMaterial(this.defaultMaterial, this.defaultMaterial, {
        friction: 0.3,
        restitution: 0
      }), this.doProfiling = !1, this.profile = {
        solve: 0,
        makeContactConstraints: 0,
        broadphase: 0,
        integrate: 0,
        narrowphase: 0
      }, this.accumulator = 0, this.subsystems = [], this.addBodyEvent = {
        type: "addBody",
        body: null
      }, this.removeBodyEvent = {
        type: "removeBody",
        body: null
      }, this.idToBodyMap = {}, this.broadphase.setWorld(this);
    }
    /**
     * Get the contact material between materials m1 and m2
     * @return The contact material if it was found.
     */
    getContactMaterial(m1, m2) {
      return this.contactMaterialTable.get(m1.id, m2.id);
    }
    /**
     * Store old collision state info
     */
    collisionMatrixTick() {
      let temp = this.collisionMatrixPrevious;
      this.collisionMatrixPrevious = this.collisionMatrix, this.collisionMatrix = temp, this.collisionMatrix.reset(), this.bodyOverlapKeeper.tick(), this.shapeOverlapKeeper.tick();
    }
    /**
     * Add a constraint to the simulation.
     */
    addConstraint(c2) {
      this.constraints.push(c2);
    }
    /**
     * Removes a constraint
     */
    removeConstraint(c2) {
      let idx = this.constraints.indexOf(c2);
      idx !== -1 && this.constraints.splice(idx, 1);
    }
    /**
     * Raycast test
     * @deprecated Use .raycastAll, .raycastClosest or .raycastAny instead.
     */
    rayTest(from, to, result) {
      result instanceof RaycastResult ? this.raycastClosest(from, to, {
        skipBackfaces: !0
      }, result) : this.raycastAll(from, to, {
        skipBackfaces: !0
      }, result);
    }
    /**
     * Ray cast against all bodies. The provided callback will be executed for each hit with a RaycastResult as single argument.
     * @return True if any body was hit.
     */
    raycastAll(from, to, options, callback) {
      return options === void 0 && (options = {}), options.mode = Ray.ALL, options.from = from, options.to = to, options.callback = callback, tmpRay.intersectWorld(this, options);
    }
    /**
     * Ray cast, and stop at the first result. Note that the order is random - but the method is fast.
     * @return True if any body was hit.
     */
    raycastAny(from, to, options, result) {
      return options === void 0 && (options = {}), options.mode = Ray.ANY, options.from = from, options.to = to, options.result = result, tmpRay.intersectWorld(this, options);
    }
    /**
     * Ray cast, and return information of the closest hit.
     * @return True if any body was hit.
     */
    raycastClosest(from, to, options, result) {
      return options === void 0 && (options = {}), options.mode = Ray.CLOSEST, options.from = from, options.to = to, options.result = result, tmpRay.intersectWorld(this, options);
    }
    /**
     * Add a rigid body to the simulation.
     * @todo If the simulation has not yet started, why recrete and copy arrays for each body? Accumulate in dynamic arrays in this case.
     * @todo Adding an array of bodies should be possible. This would save some loops too
     */
    addBody(body) {
      this.bodies.includes(body) || (body.index = this.bodies.length, this.bodies.push(body), body.world = this, body.initPosition.copy(body.position), body.initVelocity.copy(body.velocity), body.timeLastSleepy = this.time, body instanceof Body && (body.initAngularVelocity.copy(body.angularVelocity), body.initQuaternion.copy(body.quaternion)), this.collisionMatrix.setNumObjects(this.bodies.length), this.addBodyEvent.body = body, this.idToBodyMap[body.id] = body, this.dispatchEvent(this.addBodyEvent));
    }
    /**
     * Remove a rigid body from the simulation.
     */
    removeBody(body) {
      body.world = null;
      let n = this.bodies.length - 1, bodies = this.bodies, idx = bodies.indexOf(body);
      if (idx !== -1) {
        bodies.splice(idx, 1);
        for (let i = 0; i !== bodies.length; i++)
          bodies[i].index = i;
        this.collisionMatrix.setNumObjects(n), this.removeBodyEvent.body = body, delete this.idToBodyMap[body.id], this.dispatchEvent(this.removeBodyEvent);
      }
    }
    getBodyById(id) {
      return this.idToBodyMap[id];
    }
    /**
     * @todo Make a faster map
     */
    getShapeById(id) {
      let bodies = this.bodies;
      for (let i = 0; i < bodies.length; i++) {
        let shapes = bodies[i].shapes;
        for (let j = 0; j < shapes.length; j++) {
          let shape = shapes[j];
          if (shape.id === id)
            return shape;
        }
      }
      return null;
    }
    /**
     * Adds a contact material to the World
     */
    addContactMaterial(cmat) {
      this.contactmaterials.push(cmat), this.contactMaterialTable.set(cmat.materials[0].id, cmat.materials[1].id, cmat);
    }
    /**
     * Removes a contact material from the World.
     */
    removeContactMaterial(cmat) {
      let idx = this.contactmaterials.indexOf(cmat);
      idx !== -1 && (this.contactmaterials.splice(idx, 1), this.contactMaterialTable.delete(cmat.materials[0].id, cmat.materials[1].id));
    }
    /**
     * Step the simulation forward keeping track of last called time
     * to be able to step the world at a fixed rate, independently of framerate.
     *
     * @param dt The fixed time step size to use (default: 1 / 60).
     * @param maxSubSteps Maximum number of fixed steps to take per function call (default: 10).
     * @see https://gafferongames.com/post/fix_your_timestep/
     * @example
     *     // Run the simulation independently of framerate every 1 / 60 ms
     *     world.fixedStep()
     */
    fixedStep(dt, maxSubSteps) {
      dt === void 0 && (dt = 1 / 60), maxSubSteps === void 0 && (maxSubSteps = 10);
      let time = performance.now() / 1e3;
      if (!this.lastCallTime)
        this.step(dt, void 0, maxSubSteps);
      else {
        let timeSinceLastCalled = time - this.lastCallTime;
        this.step(dt, timeSinceLastCalled, maxSubSteps);
      }
      this.lastCallTime = time;
    }
    /**
     * Step the physics world forward in time.
     *
     * There are two modes. The simple mode is fixed timestepping without interpolation. In this case you only use the first argument. The second case uses interpolation. In that you also provide the time since the function was last used, as well as the maximum fixed timesteps to take.
     *
     * @param dt The fixed time step size to use.
     * @param timeSinceLastCalled The time elapsed since the function was last called.
     * @param maxSubSteps Maximum number of fixed steps to take per function call (default: 10).
     * @see https://web.archive.org/web/20180426154531/http://bulletphysics.org/mediawiki-1.5.8/index.php/Stepping_The_World#What_do_the_parameters_to_btDynamicsWorld::stepSimulation_mean.3F
     * @example
     *     // fixed timestepping without interpolation
     *     world.step(1 / 60)
     */
    step(dt, timeSinceLastCalled, maxSubSteps) {
      if (maxSubSteps === void 0 && (maxSubSteps = 10), timeSinceLastCalled === void 0)
        this.internalStep(dt), this.time += dt;
      else {
        this.accumulator += timeSinceLastCalled;
        let t0 = performance.now(), substeps = 0;
        for (; this.accumulator >= dt && substeps < maxSubSteps && (this.internalStep(dt), this.accumulator -= dt, substeps++, !(performance.now() - t0 > dt * 1e3)); )
          ;
        this.accumulator = this.accumulator % dt;
        let t = this.accumulator / dt;
        for (let j = 0; j !== this.bodies.length; j++) {
          let b2 = this.bodies[j];
          b2.previousPosition.lerp(b2.position, t, b2.interpolatedPosition), b2.previousQuaternion.slerp(b2.quaternion, t, b2.interpolatedQuaternion), b2.previousQuaternion.normalize();
        }
        this.time += timeSinceLastCalled;
      }
    }
    internalStep(dt) {
      this.dt = dt;
      let contacts = this.contacts, p1 = World_step_p1, p2 = World_step_p2, N = this.bodies.length, bodies = this.bodies, solver = this.solver, gravity = this.gravity, doProfiling = this.doProfiling, profile = this.profile, DYNAMIC = Body.DYNAMIC, profilingStart = -1 / 0, constraints = this.constraints, frictionEquationPool = World_step_frictionEquationPool;
      gravity.length();
      let gx = gravity.x, gy = gravity.y, gz = gravity.z, i = 0;
      for (doProfiling && (profilingStart = performance.now()), i = 0; i !== N; i++) {
        let bi = bodies[i];
        if (bi.type === DYNAMIC) {
          let f = bi.force, m = bi.mass;
          f.x += m * gx, f.y += m * gy, f.z += m * gz;
        }
      }
      for (let i2 = 0, Nsubsystems = this.subsystems.length; i2 !== Nsubsystems; i2++)
        this.subsystems[i2].update();
      doProfiling && (profilingStart = performance.now()), p1.length = 0, p2.length = 0, this.broadphase.collisionPairs(this, p1, p2), doProfiling && (profile.broadphase = performance.now() - profilingStart);
      let Nconstraints = constraints.length;
      for (i = 0; i !== Nconstraints; i++) {
        let c2 = constraints[i];
        if (!c2.collideConnected)
          for (let j = p1.length - 1; j >= 0; j -= 1)
            (c2.bodyA === p1[j] && c2.bodyB === p2[j] || c2.bodyB === p1[j] && c2.bodyA === p2[j]) && (p1.splice(j, 1), p2.splice(j, 1));
      }
      this.collisionMatrixTick(), doProfiling && (profilingStart = performance.now());
      let oldcontacts = World_step_oldContacts, NoldContacts = contacts.length;
      for (i = 0; i !== NoldContacts; i++)
        oldcontacts.push(contacts[i]);
      contacts.length = 0;
      let NoldFrictionEquations = this.frictionEquations.length;
      for (i = 0; i !== NoldFrictionEquations; i++)
        frictionEquationPool.push(this.frictionEquations[i]);
      for (this.frictionEquations.length = 0, this.narrowphase.getContacts(
        p1,
        p2,
        this,
        contacts,
        oldcontacts,
        // To be reused
        this.frictionEquations,
        frictionEquationPool
      ), doProfiling && (profile.narrowphase = performance.now() - profilingStart), doProfiling && (profilingStart = performance.now()), i = 0; i < this.frictionEquations.length; i++)
        solver.addEquation(this.frictionEquations[i]);
      let ncontacts = contacts.length;
      for (let k = 0; k !== ncontacts; k++) {
        let c2 = contacts[k], bi = c2.bi, bj = c2.bj, si = c2.si, sj = c2.sj, cm;
        if (bi.material && bj.material ? cm = this.getContactMaterial(bi.material, bj.material) || this.defaultContactMaterial : cm = this.defaultContactMaterial, cm.friction, bi.material && bj.material && (bi.material.friction >= 0 && bj.material.friction >= 0 && bi.material.friction * bj.material.friction, bi.material.restitution >= 0 && bj.material.restitution >= 0 && (c2.restitution = bi.material.restitution * bj.material.restitution)), solver.addEquation(c2), bi.allowSleep && bi.type === Body.DYNAMIC && bi.sleepState === Body.SLEEPING && bj.sleepState === Body.AWAKE && bj.type !== Body.STATIC) {
          let speedSquaredB = bj.velocity.lengthSquared() + bj.angularVelocity.lengthSquared(), speedLimitSquaredB = bj.sleepSpeedLimit ** 2;
          speedSquaredB >= speedLimitSquaredB * 2 && (bi.wakeUpAfterNarrowphase = !0);
        }
        if (bj.allowSleep && bj.type === Body.DYNAMIC && bj.sleepState === Body.SLEEPING && bi.sleepState === Body.AWAKE && bi.type !== Body.STATIC) {
          let speedSquaredA = bi.velocity.lengthSquared() + bi.angularVelocity.lengthSquared(), speedLimitSquaredA = bi.sleepSpeedLimit ** 2;
          speedSquaredA >= speedLimitSquaredA * 2 && (bj.wakeUpAfterNarrowphase = !0);
        }
        this.collisionMatrix.set(bi, bj, !0), this.collisionMatrixPrevious.get(bi, bj) || (World_step_collideEvent.body = bj, World_step_collideEvent.contact = c2, bi.dispatchEvent(World_step_collideEvent), World_step_collideEvent.body = bi, bj.dispatchEvent(World_step_collideEvent)), this.bodyOverlapKeeper.set(bi.id, bj.id), this.shapeOverlapKeeper.set(si.id, sj.id);
      }
      for (this.emitContactEvents(), doProfiling && (profile.makeContactConstraints = performance.now() - profilingStart, profilingStart = performance.now()), i = 0; i !== N; i++) {
        let bi = bodies[i];
        bi.wakeUpAfterNarrowphase && (bi.wakeUp(), bi.wakeUpAfterNarrowphase = !1);
      }
      for (Nconstraints = constraints.length, i = 0; i !== Nconstraints; i++) {
        let c2 = constraints[i];
        c2.update();
        for (let j = 0, Neq = c2.equations.length; j !== Neq; j++) {
          let eq = c2.equations[j];
          solver.addEquation(eq);
        }
      }
      solver.solve(dt, this), doProfiling && (profile.solve = performance.now() - profilingStart), solver.removeAllEquations();
      let pow = Math.pow;
      for (i = 0; i !== N; i++) {
        let bi = bodies[i];
        if (bi.type & DYNAMIC) {
          let ld = pow(1 - bi.linearDamping, dt), v = bi.velocity;
          v.scale(ld, v);
          let av = bi.angularVelocity;
          if (av) {
            let ad = pow(1 - bi.angularDamping, dt);
            av.scale(ad, av);
          }
        }
      }
      this.dispatchEvent(World_step_preStepEvent), doProfiling && (profilingStart = performance.now());
      let quatNormalize = this.stepnumber % (this.quatNormalizeSkip + 1) === 0, quatNormalizeFast = this.quatNormalizeFast;
      for (i = 0; i !== N; i++)
        bodies[i].integrate(dt, quatNormalize, quatNormalizeFast);
      this.clearForces(), this.broadphase.dirty = !0, doProfiling && (profile.integrate = performance.now() - profilingStart), this.stepnumber += 1, this.dispatchEvent(World_step_postStepEvent);
      let hasActiveBodies = !0;
      if (this.allowSleep)
        for (hasActiveBodies = !1, i = 0; i !== N; i++) {
          let bi = bodies[i];
          bi.sleepTick(this.time), bi.sleepState !== Body.SLEEPING && (hasActiveBodies = !0);
        }
      this.hasActiveBodies = hasActiveBodies;
    }
    emitContactEvents() {
      let hasBeginContact = this.hasAnyEventListener("beginContact"), hasEndContact = this.hasAnyEventListener("endContact");
      if ((hasBeginContact || hasEndContact) && this.bodyOverlapKeeper.getDiff(additions, removals), hasBeginContact) {
        for (let i = 0, l = additions.length; i < l; i += 2)
          beginContactEvent.bodyA = this.getBodyById(additions[i]), beginContactEvent.bodyB = this.getBodyById(additions[i + 1]), this.dispatchEvent(beginContactEvent);
        beginContactEvent.bodyA = beginContactEvent.bodyB = null;
      }
      if (hasEndContact) {
        for (let i = 0, l = removals.length; i < l; i += 2)
          endContactEvent.bodyA = this.getBodyById(removals[i]), endContactEvent.bodyB = this.getBodyById(removals[i + 1]), this.dispatchEvent(endContactEvent);
        endContactEvent.bodyA = endContactEvent.bodyB = null;
      }
      additions.length = removals.length = 0;
      let hasBeginShapeContact = this.hasAnyEventListener("beginShapeContact"), hasEndShapeContact = this.hasAnyEventListener("endShapeContact");
      if ((hasBeginShapeContact || hasEndShapeContact) && this.shapeOverlapKeeper.getDiff(additions, removals), hasBeginShapeContact) {
        for (let i = 0, l = additions.length; i < l; i += 2) {
          let shapeA = this.getShapeById(additions[i]), shapeB = this.getShapeById(additions[i + 1]);
          beginShapeContactEvent.shapeA = shapeA, beginShapeContactEvent.shapeB = shapeB, shapeA && (beginShapeContactEvent.bodyA = shapeA.body), shapeB && (beginShapeContactEvent.bodyB = shapeB.body), this.dispatchEvent(beginShapeContactEvent);
        }
        beginShapeContactEvent.bodyA = beginShapeContactEvent.bodyB = beginShapeContactEvent.shapeA = beginShapeContactEvent.shapeB = null;
      }
      if (hasEndShapeContact) {
        for (let i = 0, l = removals.length; i < l; i += 2) {
          let shapeA = this.getShapeById(removals[i]), shapeB = this.getShapeById(removals[i + 1]);
          endShapeContactEvent.shapeA = shapeA, endShapeContactEvent.shapeB = shapeB, shapeA && (endShapeContactEvent.bodyA = shapeA.body), shapeB && (endShapeContactEvent.bodyB = shapeB.body), this.dispatchEvent(endShapeContactEvent);
        }
        endShapeContactEvent.bodyA = endShapeContactEvent.bodyB = endShapeContactEvent.shapeA = endShapeContactEvent.shapeB = null;
      }
    }
    /**
     * Sets all body forces in the world to zero.
     */
    clearForces() {
      let bodies = this.bodies, N = bodies.length;
      for (let i = 0; i !== N; i++) {
        let b2 = bodies[i];
        b2.force, b2.torque, b2.force.set(0, 0, 0), b2.torque.set(0, 0, 0);
      }
    }
  };
  new AABB();
  var tmpRay = new Ray(), performance = globalThis.performance || {};
  if (!performance.now) {
    let nowOffset = Date.now();
    performance.timing && performance.timing.navigationStart && (nowOffset = performance.timing.navigationStart), performance.now = () => Date.now() - nowOffset;
  }
  new Vec3();
  var World_step_postStepEvent = {
    type: "postStep"
  }, World_step_preStepEvent = {
    type: "preStep"
  }, World_step_collideEvent = {
    type: Body.COLLIDE_EVENT_NAME,
    body: null,
    contact: null
  }, World_step_oldContacts = [], World_step_frictionEquationPool = [], World_step_p1 = [], World_step_p2 = [], additions = [], removals = [], beginContactEvent = {
    type: "beginContact",
    bodyA: null,
    bodyB: null
  }, endContactEvent = {
    type: "endContact",
    bodyA: null,
    bodyB: null
  }, beginShapeContactEvent = {
    type: "beginShapeContact",
    bodyA: null,
    bodyB: null,
    shapeA: null,
    shapeB: null
  }, endShapeContactEvent = {
    type: "endShapeContact",
    bodyA: null,
    bodyB: null,
    shapeA: null,
    shapeB: null
  };
  return __toCommonJS(cannon_es_exports);
})();
