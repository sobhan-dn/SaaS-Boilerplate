import * as THREE from 'three';
import { ARENA } from '../config';
import type { Boat } from '../entities/Boat';
import type { Ball } from '../entities/Ball';
import type { BoostPads } from '../world/BoostPads';
import { waterHeightAt } from '../water/WaveModel';

export interface AIWorld {
  ball: Ball;
  boats: Boat[];
  pads: BoostPads;
  time: number;
  kickoff: boolean;
}

type Role = 'attack' | 'defend' | 'boost';

const L2 = ARENA.length / 2;

/**
 * Utility bot: picks a role (attacker / defender / boost run) with its teammate, drives to a target point
 * with realistic steering, boosts when aligned, jumps and dodge-shoots when the ball is reachable.
 */
export class BoatAI {
  role: Role = 'attack';
  private jitter = new THREE.Vector3();
  private jitterTimer = 0;
  private stuckTimer = 0;
  private reverseTimer = 0;
  private dodgeTimer = -1;
  private jumpCooldown = 0;
  private target = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private padTarget: { x: number; z: number } | null = null;

  constructor(
    readonly boat: Boat,
    public difficulty: number,
  ) {}

  update(dt: number, w: AIWorld) {
    const b = this.boat;
    const c = b.controls;
    c.jump = false;
    const ball = w.ball;
    const ownGoalZ = b.team === 0 ? -L2 : L2;
    const enemyGoalZ = -ownGoalZ;
    const toEnemy = enemyGoalZ > 0 ? 1 : -1;

    // aim error that shrinks with difficulty
    this.jitterTimer -= dt;
    if (this.jitterTimer <= 0) {
      this.jitterTimer = 0.4 + Math.random() * 0.5;
      const err = (1.1 - this.difficulty) * 4;
      this.jitter.set((Math.random() - 0.5) * err, 0, (Math.random() - 0.5) * err);
    }

    // ---- role selection
    const mate = w.boats.find((o) => o.team === b.team && o !== b);
    const myDist = b.position.distanceTo(ball.position);
    const mateDist = mate ? mate.position.distanceTo(ball.position) : 999;
    const myEta = myDist / (b.speed + 10);
    const mateEta = mate ? mateDist / (mate.speed + 10) : 999;
    const ballToOwnGoal = Math.abs(ball.position.z - ownGoalZ);
    const ballThreat = ballToOwnGoal < 26 && Math.sign(ball.velocity.z) === Math.sign(ownGoalZ - ball.position.z) && Math.abs(ball.velocity.z) > 3;
    if (w.kickoff) {
      this.role = myEta <= mateEta ? 'attack' : 'defend';
    } else if (myEta <= mateEta * 1.15 || (mate && mate.demolished > 0)) {
      this.role = 'attack';
    } else if (ballThreat && ballToOwnGoal < 18) {
      this.role = 'attack';
    } else if (b.boost < 28 && ballToOwnGoal > 30) {
      this.role = 'boost';
    } else {
      this.role = 'defend';
    }

    // ---- target selection
    const waterY = waterHeightAt(ball.position.x, ball.position.z, w.time);
    const ballHeight = ball.position.y - waterY;
    const predictT = THREE.MathUtils.clamp(myDist / 28, 0, 1.4) * (0.5 + 0.5 * this.difficulty);
    const predicted = this.tmp.copy(ball.position).addScaledVector(ball.velocity, predictT);
    predicted.x = THREE.MathUtils.clamp(predicted.x, -ARENA.width / 2 + 2, ARENA.width / 2 - 2);
    predicted.z = THREE.MathUtils.clamp(predicted.z, -L2 + 1, L2 - 1);

    if (this.role === 'attack') {
      // line up behind the ball relative to the enemy goal
      const goal = this.tmp2.set(THREE.MathUtils.clamp(ball.position.x * 0.3, -5, 5), 0, enemyGoalZ);
      const shotDir = this.tmp2.subVectors(goal, predicted).setY(0).normalize();
      const wrongSide = (b.position.z - predicted.z) * toEnemy > 1.5;
      if (wrongSide && myDist < 14) {
        const side = b.position.x > predicted.x ? 1 : -1;
        this.target.set(predicted.x + side * 6, 0, predicted.z - toEnemy * 6);
      } else {
        const offset = myDist > 8 ? 3.4 : 1.2;
        this.target.copy(predicted).addScaledVector(shotDir, -offset);
      }
    } else if (this.role === 'defend') {
      const goalPos = this.tmp2.set(0, 0, ownGoalZ);
      const dir = this.tmp.subVectors(ball.position, goalPos).setY(0);
      const d = Math.min(dir.length(), 11 + (1 - this.difficulty) * 4);
      dir.normalize();
      this.target.copy(goalPos).addScaledVector(dir, d);
      this.target.x = THREE.MathUtils.clamp(this.target.x, -13, 13);
    } else {
      if (!this.padTarget) {
        let best: { x: number; z: number } | null = null;
        let bestD = Infinity;
        for (const p of w.pads.pads) {
          if (!p.big || p.timer > 0) continue;
          const d = Math.hypot(p.x - b.position.x, p.z - b.position.z) + Math.abs(p.z - ownGoalZ) * 0.3;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        this.padTarget = best;
      }
      if (this.padTarget) this.target.set(this.padTarget.x, 0, this.padTarget.z);
      else this.target.set(0, 0, ownGoalZ + toEnemy * 12);
    }
    if (this.role !== 'boost') this.padTarget = null;
    this.target.add(this.jitter);

    // ---- steering
    const toT = this.tmp.subVectors(this.target, b.position).setY(0);
    const dist = toT.length();
    const fwd = this.tmp2.set(b.forward.x, 0, b.forward.z).normalize();
    const rightX = fwd.z;
    const rightZ = -fwd.x;
    const angle = Math.atan2(toT.x * rightX + toT.z * rightZ, toT.x * fwd.x + toT.z * fwd.z);
    let steer = THREE.MathUtils.clamp(angle * 1.9, -1, 1);
    let throttle = 1;
    if (Math.abs(angle) > 2.1 && dist < 9) {
      throttle = -1;
      steer = -steer;
    } else if (this.role === 'defend' && dist < 7) {
      throttle = THREE.MathUtils.clamp((dist - 1.5) / 5, -0.4, 1);
      if (dist < 2.5) {
        // hold position facing the ball
        const toBall = this.tmp.subVectors(ball.position, b.position).setY(0);
        const a2 = Math.atan2(toBall.x * rightX + toBall.z * rightZ, toBall.x * fwd.x + toBall.z * fwd.z);
        steer = THREE.MathUtils.clamp(a2 * 1.5, -1, 1);
        throttle = Math.abs(a2) > 0.4 ? 0.35 : 0;
      }
    }

    // stuck handling
    if (b.speed < 1.2 && Math.abs(throttle) > 0.5 && b.inWater) this.stuckTimer += dt;
    else this.stuckTimer = 0;
    if (this.stuckTimer > 1.8) {
      this.reverseTimer = 1.1;
      this.stuckTimer = 0;
    }
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      throttle = -1;
      steer = -steer;
    }

    // ---- boost
    let boost = false;
    const aligned = Math.abs(angle) < 0.22;
    if (this.role === 'attack') {
      if (aligned && dist > 9 && b.boost > 8 && b.speed < 31) boost = Math.random() < 0.6 + this.difficulty * 0.4;
      if (aligned && myDist < 7 && ballHeight < 2 && b.boost > 5) boost = true;
    } else if (this.role === 'defend' && ballThreat && aligned && dist > 6 && b.boost > 15) {
      boost = true;
    } else if (this.role === 'boost' && aligned && dist > 12 && b.boost > 20) {
      boost = true;
    }
    if (w.kickoff && aligned) boost = true;
    if (!b.inWater) boost = boost && b.forward.y > -0.3 && b.speed < 30;

    // ---- jumping / dodge shots
    this.jumpCooldown -= dt;
    let jump = false;
    const approaching = this.tmp.subVectors(ball.position, b.position).dot(b.velocity) > 0;
    if (this.role === 'attack' && b.inWater && this.jumpCooldown <= 0 && approaching) {
      const eta = myDist / Math.max(6, b.speed);
      if (ballHeight > 1.6 && ballHeight < 6.5 && eta < 0.55 && Math.abs(angle) < 0.5) {
        jump = true;
        this.jumpCooldown = 1.4;
        if (ballHeight > 3.6) this.dodgeTimer = 0.34; // plain double jump later
      } else if (ballHeight < 1.8 && myDist < 4.2 && Math.abs(angle) < 0.35 && b.speed > 8 && Math.random() < 0.35 + this.difficulty * 0.5) {
        jump = true;
        this.jumpCooldown = 1.6;
        this.dodgeTimer = 0.16; // forward flip into the ball
      }
    }
    if (this.dodgeTimer >= 0) {
      this.dodgeTimer -= dt;
      if (this.dodgeTimer < 0 && !b.inWater) {
        jump = true;
        throttle = 1;
        steer = 0;
      }
    }

    // ---- air control: level out and point at the target
    let pitch = 0;
    let roll = 0;
    if (!b.inWater) {
      pitch = THREE.MathUtils.clamp(b.forward.y * 2.2, -1, 1);
      const rightY = b.right.y;
      roll = THREE.MathUtils.clamp(-rightY * 2.5, -1, 1);
      steer = THREE.MathUtils.clamp(angle * 1.2, -1, 1);
      throttle = 0.2;
    }

    c.throttle = throttle;
    c.steer = steer;
    c.pitch = pitch;
    c.roll = roll;
    c.boost = boost;
    c.jump = jump;
  }
}
