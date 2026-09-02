import type { BoatControls } from '../entities/Boat';

/**
 * Keyboard + gamepad input mapped to boat controls.
 * Keyboard: WASD/arrows, Space jump, Shift boost, Q/E air roll, C camera, Esc pause.
 * Gamepad (standard mapping): left stick steer/pitch, RT throttle, LT reverse, A jump, B/RB boost, X roll, Y camera.
 */
export class Input {
  private keys = new Set<string>();
  private jumpQueued = false;
  private cameraToggleQueued = false;
  private pauseQueued = false;
  private prevPadJump = false;
  private prevPadCam = false;
  private prevPadPause = false;
  readonly controls: BoatControls = { throttle: 0, steer: 0, pitch: 0, roll: 0, boost: false, jump: false };
  gamepadActive = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpQueued = true;
      if (e.code === 'KeyC') this.cameraToggleQueued = true;
      if (e.code === 'Escape') this.pauseQueued = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private key(...codes: string[]) {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** Call once per frame. Returns edge-triggered events consumed this frame. */
  poll(): { cameraToggle: boolean; pause: boolean } {
    const c = this.controls;
    let throttle = (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0);
    let steer = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
    let roll = (this.key('KeyE') ? 1 : 0) - (this.key('KeyQ') ? 1 : 0);
    let boost = this.key('ShiftLeft', 'ShiftRight');
    let jump = this.jumpQueued;
    let camToggle = this.cameraToggleQueued;
    let pause = this.pauseQueued;
    this.jumpQueued = false;
    this.cameraToggleQueued = false;
    this.pauseQueued = false;

    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = pads && pads.length ? Array.from(pads).find((p) => p && p.connected) : null;
    this.gamepadActive = false;
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
      const lx = dz(pad.axes[0] ?? 0);
      const ly = dz(pad.axes[1] ?? 0);
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      const padThrottle = rt - lt;
      if (Math.abs(lx) > 0 || Math.abs(ly) > 0 || Math.abs(padThrottle) > 0.05) this.gamepadActive = true;
      if (Math.abs(lx) > 0) steer = lx;
      if (Math.abs(padThrottle) > 0.05) throttle = padThrottle;
      const padPitch = ly; // stick forward (negative) = nose down -> positive pitch
      if (Math.abs(padPitch) > 0) c.pitch = -padPitch;
      if (pad.buttons[2]?.pressed) roll = lx !== 0 ? lx : roll;
      if (pad.buttons[1]?.pressed || pad.buttons[5]?.pressed) boost = true;
      const padJump = pad.buttons[0]?.pressed ?? false;
      if (padJump && !this.prevPadJump) jump = true;
      this.prevPadJump = padJump;
      const padCam = pad.buttons[3]?.pressed ?? false;
      if (padCam && !this.prevPadCam) camToggle = true;
      this.prevPadCam = padCam;
      const padPause = pad.buttons[9]?.pressed ?? false;
      if (padPause && !this.prevPadPause) pause = true;
      this.prevPadPause = padPause;
    }
    c.throttle = throttle;
    c.steer = steer;
    if (!this.gamepadActive) c.pitch = throttle; // W = nose down in the air, S = nose up
    c.roll = roll;
    c.boost = boost;
    c.jump = jump;
    return { cameraToggle: camToggle, pause };
  }
}
