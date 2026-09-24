// player.js — first-person controller whose "down" follows the surface.
//
// The view frame is a quaternion whose local +Y is the player's up. Each step
// that up is eased toward the target normal with the *minimal* rotation
// (parallel transport), applied to the whole frame — so walking over an edge
// tips the world smoothly while keeping the heading.
import * as THREE from 'three';

const V3 = THREE.Vector3;
const Y = new V3(0, 1, 0), FWD = new V3(0, 0, -1), RIGHT = new V3(1, 0, 0);
const _up = new V3(), _target = new V3(), _n = new V3(), _cn = new V3();
const _f = new V3(), _r = new V3(), _wish = new V3(), _vt = new V3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

const WALK = 6, SPRINT = 11, JUMP = 10.5, GRAVITY = 26;
const UP_RATE_GROUND = 10, UP_RATE_AIR = 2.4;

export class Player {
  constructor(field, spawn) {
    this.field = field;
    this.spawn = spawn;
    this.R = 0.5;         // collision sphere radius (centre sits R above ground)
    this.eye = 1.15;      // camera offset above the sphere centre
    this.pos = new V3();
    this.prevPos = new V3();
    this.vel = new V3();
    this.frame = new THREE.Quaternion();
    this.prevFrame = new THREE.Quaternion();
    this.groundN = new V3(0, 1, 0);
    this.pitch = 0;
    this.grounded = false;
    this.jumpBuffer = 0;
    this.jumpLock = 0;
    this.coyote = 0;
    this.speed = 0;
    this.walked = 0;
    this.reset();
  }

  reset(spawn = this.spawn) {
    const up = spawn.up.clone().normalize();
    const right = new V3().crossVectors(spawn.forward, up).normalize();
    const back = new V3().crossVectors(right, up);
    this.frame.setFromRotationMatrix(_m.makeBasis(right, up, back));
    this.prevFrame.copy(this.frame);
    this.pos.copy(spawn.pos);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.groundN.copy(up);
    this.pitch = 0;
    this.grounded = false;
  }

  up(out) { return out.copy(Y).applyQuaternion(this.frame); }

  /** yaw about the local up, pitch clamped; applied to prevFrame too so interpolation never lags the mouse */
  look(dYaw, dPitch) {
    _q.setFromAxisAngle(Y, -dYaw);
    this.frame.multiply(_q);
    this.prevFrame.multiply(_q);
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dPitch));
  }

  step(dt, input) {
    const f = this.field;
    this.prevPos.copy(this.pos);
    this.prevFrame.copy(this.frame);

    /* 1 ── re-orient: ease up toward the surface normal (ground) or field gradient (air) */
    const up = this.up(_up);
    f.gradSoft(this.pos, _n);
    _target.copy(this.grounded ? this.groundN : _n);
    if (up.dot(_target) < -0.9) _target.addScaledVector(_f.copy(FWD).applyQuaternion(this.frame), 0.6).normalize();
    const a = 1 - Math.exp(-(this.grounded ? UP_RATE_GROUND : UP_RATE_AIR) * dt);
    _target.lerpVectors(up, _target, a).normalize();
    this.frame.premultiply(_q.setFromUnitVectors(up, _target)).normalize();
    up.copy(_target);

    /* 2 ── walk in the tangent plane */
    _f.copy(FWD).applyQuaternion(this.frame);
    _r.copy(RIGHT).applyQuaternion(this.frame);
    _wish.set(0, 0, 0).addScaledVector(_f, input.z).addScaledVector(_r, input.x);
    if (_wish.lengthSq() > 1) _wish.normalize();
    _wish.multiplyScalar(input.sprint ? SPRINT : WALK);
    const vn = this.vel.dot(up);
    _vt.copy(this.vel).addScaledVector(up, -vn);
    if (this.grounded) _vt.lerp(_wish, 1 - Math.exp(-14 * dt));
    else if (_wish.lengthSq() > 0) _vt.lerp(_wish, 1 - Math.exp(-1.6 * dt));
    this.vel.copy(_vt).addScaledVector(up, vn);
    this.speed = _vt.length();

    /* 3 ── gravity: toward the ground we stand on, else down the smooth field (weaker far out) */
    const dSoft = f.soft(this.pos);
    const g = GRAVITY / (1 + Math.max(0, dSoft - 2) * 0.05);
    this.vel.addScaledVector(this.grounded ? this.groundN : _n, -g * dt);

    /* 4 ── jump (buffered + coyote time) */
    if (input.jump) { this.jumpBuffer = 0.15; input.jump = false; }
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      const inward = this.vel.dot(up);
      if (inward < 0) this.vel.addScaledVector(up, -inward);
      this.vel.addScaledVector(up, JUMP);
      this.jumpBuffer = this.coyote = 0;
      this.jumpLock = 0.25;
      this.grounded = false;
    }
    this.jumpLock = Math.max(0, this.jumpLock - dt);

    /* 5 ── integrate + collide against the exact union */
    this.pos.addScaledVector(this.vel, dt);
    const was = this.grounded;
    this.grounded = false;
    for (let i = 0; i < 4; i++) {
      const d = f.hard(this.pos);
      if (d >= this.R) break;
      f.gradHard(this.pos, _cn);
      this.pos.addScaledVector(_cn, this.R - d + 1e-4);
      const into = this.vel.dot(_cn);
      if (into < 0) this.vel.addScaledVector(_cn, -into);
      // any landing from the air grabs you; on foot, steep walls stay walls
      if (!was || _cn.dot(up) > 0.3) { this.grounded = true; this.groundN.copy(_cn); }
    }

    /* 6 ── stick to the surface over convex edges instead of launching off them */
    if (!this.grounded && was && this.jumpLock === 0) {
      const d = f.hard(this.pos);
      if (d < this.R + 0.75) {
        f.gradHard(this.pos, _cn);
        this.pos.addScaledVector(_cn, this.R - d);
        const out = this.vel.dot(_cn);
        if (out > 0) this.vel.addScaledVector(_cn, -out);
        this.grounded = true;
        this.groundN.copy(_cn);
      }
    }

    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
    if (this.grounded) this.walked += this.speed * dt;
    if (dSoft > 160) this.reset();
  }
}
