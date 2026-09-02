import * as THREE from 'three';
import { ARENA, FIXED_DT, MATCH, QUALITY, TEAM_COLORS, type QualityLevel, type QualitySettings, type Team } from '../config';
import { Physics } from '../physics/Physics';
import { GameRenderer } from '../render/GameRenderer';
import { CameraRig } from '../render/CameraRig';
import { WaterSurface } from '../water/WaterSurface';
import { Environment } from '../world/Environment';
import { Arena } from '../world/Arena';
import { BoostPads } from '../world/BoostPads';
import { Decorations } from '../world/Decorations';
import { Boat } from '../entities/Boat';
import { Ball, BALL_SHAPES, type BallShape } from '../entities/Ball';
import { BoatAI } from '../ai/BoatAI';
import { Input } from '../input/Input';
import { ParticleSystem } from '../fx/Particles';
import { FxContext } from '../fx/FxContext';
import { AudioEngine } from '../audio/AudioEngine';
import { HUD } from '../ui/HUD';

export interface MatchOptions {
  duration: number;
  morphInterval: number;
  difficulty: number;
}

export interface MatchResult {
  winner: Team | null;
  score: [number, number];
  stats: { name: string; team: Team; goals: number; touches: number; saves: number }[];
}

type Phase = 'idle' | 'kickoff' | 'play' | 'goal' | 'ended';

const BOAT_NAMES = ['You', 'Bubbles', 'Captain Squeak', 'Duckworth'];

export class Game {
  readonly scene = new THREE.Scene();
  readonly renderer: GameRenderer;
  readonly rig: CameraRig;
  readonly water: WaterSurface;
  readonly env: Environment;
  readonly arena: Arena;
  readonly pads: BoostPads;
  readonly decorations: Decorations;
  readonly boats: Boat[] = [];
  readonly ball: Ball;
  readonly ai: BoatAI[] = [];
  readonly input = new Input();
  readonly audio: AudioEngine;
  readonly fx: FxContext;
  readonly hud: HUD;

  phase: Phase = 'idle';
  paused = false;
  score: [number, number] = [0, 0];
  clock = 300;
  overtime = false;
  onMatchEnd: ((r: MatchResult) => void) | null = null;
  onPause: (() => void) | null = null;

  private options: MatchOptions = { duration: 300, morphInterval: 8, difficulty: 0.8 };
  private time = 0;
  private accumulator = 0;
  private phaseTimer = 0;
  private slowmo = 1;
  private morphTimer = 8;
  private nextShape: BallShape = BALL_SHAPES[1];
  private lastCountdownTick = -1;
  private stoppage = false;
  private demoAI: BoatAI | null = null;
  private running = true;
  private lastFrame = performance.now();

  constructor(canvas: HTMLCanvasElement, physics: Physics, quality: QualityLevel, hud: HUD, audio: AudioEngine) {
    this.hud = hud;
    this.audio = audio;
    const q = QUALITY[quality];
    this.quality = q;
    this.renderer = new GameRenderer(canvas, q);
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.env = new Environment(this.scene, this.renderer.renderer, q);

    const bw = Math.floor(window.innerWidth * q.pixelRatio * q.reflectionScale);
    const bh = Math.floor(window.innerHeight * q.pixelRatio * q.reflectionScale);
    this.water = new WaterSurface(q.waterSegments, q.rippleSize, q.reflection, [Math.max(8, bw), Math.max(8, bh)]);
    this.water.setEnvironment(this.env.waterEnv);
    this.scene.add(this.water.mesh);

    this.arena = new Arena(physics, this.scene);
    this.pads = new BoostPads(this.scene);
    this.decorations = new Decorations(this.scene);

    const spray = new ParticleSystem(q.particles, false);
    const glow = new ParticleSystem(Math.floor(q.particles * 0.6), true);
    this.scene.add(spray.points, glow.points);
    this.fx = new FxContext(this.water.ripple, spray, glow, audio);

    this.ball = new Ball(physics, this.scene);
    const teams: Team[] = [0, 0, 1, 1];
    for (let i = 0; i < 4; i++) {
      const boat = new Boat(i, teams[i], BOAT_NAMES[i], i === 0, physics, this.scene, i % 2);
      this.boats.push(boat);
      if (i > 0) this.ai.push(new BoatAI(boat, this.options.difficulty));
    }
    this.demoAI = new BoatAI(this.boats[0], 0.8);
    this.physics = physics;

    this.resize();
    window.addEventListener('resize', this.resize);
    this.placeKickoff();
    this.water.ripple.clear(this.renderer.renderer);
    this.rig.mode = 'cinematic';
    requestAnimationFrame(this.frame);
  }

  private physics: Physics;
  private quality: QualitySettings;

  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.water.setReflectionSize(this.renderer.bufferWidth * this.quality.reflectionScale, this.renderer.bufferHeight * this.quality.reflectionScale);
    this.fx.spray.setViewportHeight(this.renderer.bufferHeight);
    this.fx.glow.setViewportHeight(this.renderer.bufferHeight);
  };

  /* ---------------------------------------------------------------- match flow */

  startMatch(options: MatchOptions) {
    this.options = options;
    for (const ai of this.ai) ai.difficulty = options.difficulty;
    this.score = [0, 0];
    this.clock = options.duration;
    this.overtime = false;
    this.stoppage = false;
    for (const b of this.boats) b.stats = { touches: 0, goals: 0, saves: 0, boostUsed: 0 };
    this.hud.clearFeed();
    this.hud.setScore(0, 0);
    this.morphTimer = options.morphInterval || 0;
    this.pickNextShape();
    this.ball.morphTo(BALL_SHAPES[0]);
    this.hud.show(true);
    this.rig.mode = 'ball';
    for (const b of this.boats) this.audio.ensureEngine(b.id);
    this.beginKickoff();
  }

  private beginKickoff() {
    this.phase = 'kickoff';
    this.phaseTimer = MATCH.kickoffCountdown;
    this.lastCountdownTick = -1;
    this.slowmo = 1;
    this.placeKickoff();
    this.pads.reset();
    this.hud.hideGoal();
    if (this.rig.mode === 'cinematic') this.rig.mode = 'ball';
    const p = this.boats[0];
    this.rig.snapTo(p.position, p.forward, this.ball.position);
  }

  private placeKickoff() {
    const spots: [number, number][] = [
      [-10, -31],
      [10, -31],
      [0, -36],
      [-14, -34],
      [14, -34],
    ];
    const pick = [0, 1, 2, 3, 4].sort(() => Math.random() - 0.5).slice(0, 2);
    for (let i = 0; i < 4; i++) {
      const boat = this.boats[i];
      const [sx, sz] = spots[pick[i % 2]];
      const s = boat.team === 0 ? 1 : -1;
      const x = sx * s;
      const z = sz * s;
      const yaw = Math.atan2(-x, -z);
      boat.reset(x, z, yaw);
    }
    this.ball.reset(0, 1.6, 0);
  }

  private pickNextShape() {
    const candidates = BALL_SHAPES.filter((s) => s.id !== this.ball.shape.id && s.id !== this.nextShape.id);
    this.nextShape = candidates[Math.floor(Math.random() * candidates.length)];
  }

  private scoreGoal(scoringTeam: Team) {
    this.score[scoringTeam]++;
    this.hud.setScore(this.score[0], this.score[1]);
    const scorerId = this.ball.lastTouchBoat;
    const scorer = scorerId >= 0 ? this.boats[scorerId] : null;
    let label: string;
    if (scorer && scorer.team === scoringTeam) {
      scorer.stats.goals++;
      label = `${scorer.name} scores for ${TEAM_COLORS[scoringTeam].name}!`;
    } else if (scorer) {
      label = `Own goal by ${scorer.name}!`;
    } else {
      label = `${TEAM_COLORS[scoringTeam].name} scores!`;
    }
    this.hud.showGoal(scoringTeam, label);
    this.hud.event(label, scoringTeam);
    this.audio.goal();
    const colors = [new THREE.Color(TEAM_COLORS[scoringTeam].main), new THREE.Color(TEAM_COLORS[scoringTeam].accent), new THREE.Color(1, 1, 1)];
    this.fx.confetti(this.ball.position.clone().add(new THREE.Vector3(0, 2, 0)), colors, 260);
    this.arena.flashGoal(scoringTeam === 0 ? 1 : 0, 1);
    this.rig.addShake(0.8);
    this.rig.mode = 'cinematic';
    this.phase = 'goal';
    this.phaseTimer = MATCH.goalCelebration;
    this.slowmo = 0.3;
    if (this.overtime) {
      this.phaseTimer = 2.5;
    }
  }

  private endMatch() {
    this.phase = 'ended';
    this.rig.mode = 'cinematic';
    this.audio.whistle();
    const winner: Team | null = this.score[0] === this.score[1] ? null : this.score[0] > this.score[1] ? 0 : 1;
    this.hud.setCenter('');
    this.onMatchEnd?.({
      winner,
      score: [this.score[0], this.score[1]],
      stats: this.boats.map((b) => ({ name: b.name, team: b.team, goals: b.stats.goals, touches: b.stats.touches, saves: b.stats.saves })),
    });
  }

  quitToMenu() {
    this.phase = 'idle';
    this.hud.show(false);
    this.hud.hideGoal();
    this.rig.mode = 'cinematic';
    this.placeKickoff();
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (!p) this.lastFrame = performance.now();
  }

  /* ---------------------------------------------------------------- simulation */

  private fixedStep(dt: number) {
    this.time += dt;
    const controllable = this.phase === 'play' || this.phase === 'idle';

    for (const b of this.boats) {
      if (!controllable) {
        b.controls.throttle = 0;
        b.controls.steer *= 0.9;
        b.controls.boost = false;
        b.controls.jump = false;
      }
      b.fixedUpdate(dt, this.time, this.fx);
      b.controls.jump = false;
    }
    if (this.phase === 'kickoff') {
      this.ball.body.setTranslation({ x: 0, y: 1.6, z: 0 }, true);
      this.ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.ball.body.setAngvel({ x: 0, y: 0.6, z: 0 }, true);
    }
    this.ball.fixedUpdate(dt, this.time, this.fx);
    this.physics.step();
    this.handleCollisions();

    if (this.phase === 'play') {
      for (const t of [0, 1] as Team[]) {
        if (this.physics.world.intersectionPair(this.arena.goalSensors[t], this.ball.collider)) {
          this.scoreGoal(t === 0 ? 1 : 0);
          break;
        }
      }
    }

    // respawn demolished boats after their timer
    for (const b of this.boats) {
      if (b.demolished > 0 && b.demolished < dt * 1.5) {
        const s = b.team === 0 ? 1 : -1;
        b.reset((Math.random() - 0.5) * 20, -36 * s, Math.atan2(0, s));
        b.demolished = 0;
      }
    }
  }

  private handleCollisions() {
    this.physics.drainCollisions((a, b) => {
      if (a.kind === 'boat' && b.kind === 'boat') {
        const b1 = this.boats[a.id];
        const b2 = this.boats[b.id];
        const rel = b1.velocity.distanceTo(b2.velocity);
        b1.punch(Math.min(0.35, rel * 0.02));
        b2.punch(Math.min(0.35, rel * 0.02));
        this.audio.hit(Math.min(1.2, rel / 15), b1.position);
        if (b1.isPlayer || b2.isPlayer) this.rig.addShake(Math.min(0.6, rel * 0.03));
        // demolition: a supersonic boat wrecks the other
        for (const [hitter, victim] of [[b1, b2], [b2, b1]] as [Boat, Boat][]) {
          if (hitter.supersonic && rel > 24 && victim.demolished <= 0 && hitter.team !== victim.team) {
            victim.demolished = 3;
            this.fx.splash(victim.position, 1.6, 2.5);
            this.fx.burst(victim.position, new THREE.Color(1, 0.3, 0.2), 60, 9);
            this.hud.event(`${hitter.name} demolished ${victim.name}!`, hitter.team);
          }
        }
        return;
      }
      const boatOwner = a.kind === 'boat' ? a : b.kind === 'boat' ? b : null;
      const other = a.kind === 'boat' ? b : a;
      if (boatOwner && other.kind === 'ball') {
        const boat = this.boats[boatOwner.id];
        if (this.phase === 'play' || this.phase === 'idle') {
          this.ball.applyHitBoost(boat.position, boat.velocity, boat.id, boat.team, this.time);
          boat.stats.touches++;
          const strength = Math.min(1.5, boat.velocity.distanceTo(this.ball.velocity) / 12);
          boat.punch(Math.min(0.3, strength * 0.25));
          this.audio.hit(strength, this.ball.position);
          if (boat.isPlayer) this.rig.addShake(Math.min(0.5, strength * 0.35));
          this.fx.burst(this.ball.position, boat.teamColor, Math.floor(8 + strength * 20), 3 + strength * 4);
          // save detection: ball was heading into own goal
          const ownGoalZ = boat.team === 0 ? -ARENA.length / 2 : ARENA.length / 2;
          const towardOwnGoal = Math.sign(this.ball.velocity.z) === Math.sign(ownGoalZ) && Math.abs(this.ball.position.z - ownGoalZ) < 16 && Math.abs(this.ball.velocity.z) > 6;
          if (towardOwnGoal && Math.abs(this.ball.position.x) < ARENA.goalWidth) {
            boat.stats.saves++;
            if (this.phase === 'play') this.hud.event(`${boat.name} makes a save!`, boat.team);
          }
        }
        return;
      }
      if (other.kind === 'wall' && boatOwner) {
        const boat = this.boats[boatOwner.id];
        const sp = boat.speed;
        if (sp > 6) {
          boat.punch(Math.min(0.3, sp * 0.012));
          this.audio.hit(Math.min(0.8, sp / 30), boat.position);
        }
        return;
      }
      if ((a.kind === 'ball' && b.kind === 'wall') || (a.kind === 'wall' && b.kind === 'ball')) {
        const sp = this.ball.velocity.length();
        if (sp > 5) this.audio.hit(Math.min(0.7, sp / 35), this.ball.position);
      }
    });
  }

  private updatePhase(dt: number) {
    switch (this.phase) {
      case 'kickoff': {
        this.phaseTimer -= dt;
        const tick = Math.ceil(this.phaseTimer);
        if (tick !== this.lastCountdownTick) {
          this.lastCountdownTick = tick;
          if (tick > 0) this.audio.countdown(false);
        }
        if (this.phaseTimer > 0) {
          this.hud.setCenter(String(Math.max(1, tick)), this.overtime ? 'OVERTIME - NEXT GOAL WINS' : '');
        } else {
          this.phase = 'play';
          this.audio.countdown(true);
          this.hud.setCenter('GO!');
          setTimeout(() => {
            if (this.phase === 'play') this.hud.setCenter('');
          }, 700);
        }
        break;
      }
      case 'play': {
        if (!this.overtime) {
          if (this.clock > 0) {
            this.clock -= dt;
            if (this.clock <= 0) {
              this.clock = 0;
              this.stoppage = true;
            }
          } else {
            // regulation is over: play continues until the ball touches the water
            if (this.ball.submerged > 0.04 || this.ball.position.y < 2.2) {
              if (this.score[0] === this.score[1] && MATCH.overtimeEnabled) {
                this.overtime = true;
                this.stoppage = false;
                this.clock = 0;
                this.hud.event('Overtime! Next goal wins.');
                this.beginKickoff();
              } else {
                this.endMatch();
              }
            }
          }
        } else {
          this.clock += dt;
        }
        if (this.options.morphInterval > 0) {
          this.morphTimer -= dt;
          if (this.morphTimer <= 0) {
            this.morphTimer = this.options.morphInterval;
            this.ball.morphTo(this.nextShape);
            this.hud.flashShape();
            this.hud.event(`Ball morphs into a ${this.nextShape.name}!`);
            this.pickNextShape();
          }
        }
        break;
      }
      case 'goal': {
        this.phaseTimer -= dt;
        this.slowmo += (1 - this.slowmo) * Math.min(1, dt * 0.9);
        if (this.phaseTimer <= 0) {
          if (this.overtime || (this.clock <= 0 && !this.overtime && this.score[0] !== this.score[1])) {
            this.endMatch();
          } else {
            this.beginKickoff();
          }
        }
        break;
      }
      case 'idle': {
        // attract mode: everyone is a bot
        if (this.options.morphInterval > 0) {
          this.morphTimer -= dt;
          if (this.morphTimer <= 0) {
            this.morphTimer = 8;
            this.ball.morphTo(this.nextShape);
            this.pickNextShape();
          }
        }
        for (const t of [0, 1] as Team[]) {
          if (this.physics.world.intersectionPair(this.arena.goalSensors[t], this.ball.collider)) {
            this.fx.confetti(this.ball.position.clone(), [new THREE.Color(TEAM_COLORS[t === 0 ? 1 : 0].main), new THREE.Color(1, 1, 1)], 120);
            this.placeKickoff();
          }
        }
        break;
      }
      default:
        break;
    }
  }

  private frame = (now: number) => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    let realDt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.paused) return;
    if (realDt <= 0) realDt = 0.0001;

    // ---- input & AI
    const events = this.input.poll();
    if (events.pause && (this.phase === 'play' || this.phase === 'kickoff')) {
      this.onPause?.();
      return;
    }
    if (events.cameraToggle) this.rig.toggle();
    const aiWorld = { ball: this.ball, boats: this.boats, pads: this.pads, time: this.time, kickoff: this.phase === 'kickoff' || this.time < 2 };
    const player = this.boats[0];
    if (this.phase === 'idle' || this.phase === 'ended') {
      this.demoAI?.update(realDt, aiWorld);
    } else {
      const c = this.input.controls;
      player.controls.throttle = c.throttle;
      player.controls.steer = c.steer;
      player.controls.pitch = c.pitch;
      player.controls.roll = c.roll;
      player.controls.boost = c.boost;
      if (c.jump) player.controls.jump = true;
    }
    for (const ai of this.ai) ai.update(realDt, aiWorld);

    // ---- physics
    const dt = realDt * this.slowmo;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < 4) {
      this.fixedStep(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === 4) this.accumulator = 0;
    const alpha = this.accumulator / FIXED_DT;
    this.updatePhase(dt);

    // ---- visuals
    const simTime = this.time + this.accumulator;
    this.water.update(simTime, this.rig.camera);
    this.env.update(simTime);
    this.arena.update(simTime, dt);
    this.pads.update(dt, simTime, this.boats, this.fx);
    this.decorations.update(simTime);
    for (const b of this.boats) b.update(dt, simTime, alpha, this.ball.position, this.fx);
    this.ball.update(dt, simTime, alpha);
    this.fx.spray.update(dt);
    this.fx.glow.update(dt);

    this.rig.update(realDt, simTime, player.position, player.forward, player.velocity, this.ball.position);
    this.audio.setListener(this.rig.camera.position);
    for (const b of this.boats) this.audio.updateEngine(b.id, b.controls.throttle, b.speed, b.boosting, b.inWater, b.position, b.isPlayer);

    // ---- HUD
    if (this.phase !== 'idle') {
      this.hud.setBoost(player.boost);
      this.hud.setSpeed(player.speed, player.supersonic);
      this.hud.setClock(this.clock, this.overtime, this.stoppage);
      this.hud.setShape(this.ball.shape.name, this.ball.shape.icon, this.nextShape.name, this.options.morphInterval > 0 ? this.morphTimer : 0, this.options.morphInterval);
    }

    this.renderer.render(this.scene, this.rig.camera, this.water, realDt);
  };

  dispose() {
    this.running = false;
    window.removeEventListener('resize', this.resize);
    this.water.dispose();
    this.renderer.dispose();
  }
}
