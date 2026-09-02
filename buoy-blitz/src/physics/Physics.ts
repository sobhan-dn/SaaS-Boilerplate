import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT, GRAVITY } from '../config';

export type ColliderOwner = { kind: 'boat'; id: number } | { kind: 'ball' } | { kind: 'wall' } | { kind: 'goal'; team: number };

export class Physics {
  readonly world: RAPIER.World;
  readonly eventQueue: RAPIER.EventQueue;
  readonly owners = new Map<number, ColliderOwner>();

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
    this.world.integrationParameters.numSolverIterations = 8;
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  register(collider: RAPIER.Collider, owner: ColliderOwner) {
    this.owners.set(collider.handle, owner);
  }

  unregister(collider: RAPIER.Collider) {
    this.owners.delete(collider.handle);
  }

  step() {
    this.world.step(this.eventQueue);
  }

  drainCollisions(cb: (a: ColliderOwner, b: ColliderOwner, h1: number, h2: number) => void) {
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.owners.get(h1);
      const b = this.owners.get(h2);
      if (a && b) cb(a, b, h1, h2);
    });
  }
}

export { RAPIER };
