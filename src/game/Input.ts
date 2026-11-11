/** Keyboard + mouse state with pointer lock handling. */
export class Input {
  keys = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  lmb = false;
  rmb = false;
  private lmbPressed = false;
  private rmbPressed = false;
  locked = false;
  /** set by the game when the cursor should be free (inventory, map, menus) */
  wantFree = false;
  onLockChange: (locked: boolean) => void = () => {};
  sensitivity = 1;
  /** on-screen controls drive the game; there is no pointer lock on phones */
  touch = false;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', this.kd);
    window.addEventListener('keyup', this.ku);
    window.addEventListener('blur', this.blur);
    el.addEventListener('mousedown', this.md);
    window.addEventListener('mouseup', this.mu);
    window.addEventListener('mousemove', this.mm);
    el.addEventListener('wheel', this.wh, { passive: true });
    el.addEventListener('contextmenu', this.ctx);
    document.addEventListener('pointerlockchange', this.plc);
  }

  private kd = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    if (['Tab', 'Space', 'KeyF', 'KeyM', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    if (!e.repeat) this.pressed.add(e.code);
    this.keys.add(e.code);
  };
  private ku = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private blur = (): void => {
    this.keys.clear();
    this.lmb = false;
    this.rmb = false;
  };
  private md = (e: MouseEvent): void => {
    if (this.touch) return;
    if (!this.locked) {
      if (!this.wantFree) this.lock();
      return;
    }
    if (e.button === 0) {
      this.lmb = true;
      this.lmbPressed = true;
    } else if (e.button === 2) {
      this.rmb = true;
      this.rmbPressed = true;
    }
  };
  private mu = (e: MouseEvent): void => {
    if (this.touch) return;
    if (e.button === 0) this.lmb = false;
    else if (e.button === 2) this.rmb = false;
  };
  private mm = (e: MouseEvent): void => {
    if (!this.locked || this.touch) return;
    // some browsers report a huge delta on the first locked event
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };
  private wh = (e: WheelEvent): void => {
    this.wheel += Math.sign(e.deltaY);
  };
  private ctx = (e: Event): void => e.preventDefault();
  private plc = (): void => {
    this.locked = document.pointerLockElement === this.el;
    if (!this.locked) {
      this.lmb = false;
      this.rmb = false;
    }
    this.onLockChange(this.locked);
  };

  lock(): void {
    if (this.locked) return;
    if (this.touch) {
      this.locked = true;
      this.onLockChange(true);
      return;
    }
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* pointer lock unavailable */
    }
  }
  unlock(): void {
    if (this.touch) {
      if (!this.locked) return;
      this.locked = false;
      this.lmb = false;
      this.rmb = false;
      this.keys.clear();
      this.onLockChange(false);
      return;
    }
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  // ---- virtual input used by the touch controls
  press(code: string): void {
    if (!this.keys.has(code)) this.pressed.add(code);
    this.keys.add(code);
  }
  release(code: string): void {
    this.keys.delete(code);
  }
  tap(code: string): void {
    this.pressed.add(code);
  }
  look(dx: number, dy: number): void {
    if (!this.locked) return;
    this.mouseDX += dx;
    this.mouseDY += dy;
  }
  setFire(on: boolean): void {
    if (on && !this.lmb) this.lmbPressed = true;
    this.lmb = on && this.locked;
  }
  scroll(dir: number): void {
    this.wheel += dir;
  }
  setAds(on: boolean): void {
    this.rmb = on && this.locked;
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }
  /** true only on the frame the key went down */
  hit(code: string): boolean {
    return this.pressed.has(code);
  }
  lmbHit(): boolean {
    return this.lmbPressed;
  }
  rmbHit(): boolean {
    return this.rmbPressed;
  }
  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.lmbPressed = false;
    this.rmbPressed = false;
  }
  dispose(): void {
    window.removeEventListener('keydown', this.kd);
    window.removeEventListener('keyup', this.ku);
    window.removeEventListener('blur', this.blur);
    this.el.removeEventListener('mousedown', this.md);
    window.removeEventListener('mouseup', this.mu);
    window.removeEventListener('mousemove', this.mm);
    this.el.removeEventListener('wheel', this.wh);
    this.el.removeEventListener('contextmenu', this.ctx);
    document.removeEventListener('pointerlockchange', this.plc);
  }
}
