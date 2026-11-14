'use client';

import { useRef, useState, type PointerEvent as RPE } from 'react';
import type { Game } from '@/game/Game';
import type { HudState } from '@/game/store';

const RADIUS = 56;
const LOOK = 2.4;

/** On-screen controls for phones and tablets: move stick, drag-to-look, action buttons. */
export default function TouchControls({ game, s }: { game: Game; s: HudState }) {
  const input = game.input;
  const knob = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const looks = useRef(new Map<number, { x: number; y: number }>());
  const [ads, setAds] = useState(false);

  const setStick = (dx: number, dy: number) => {
    const len = Math.hypot(dx, dy);
    // drag the stick well past its rim, straight up, to lock running
    if (dy < -RADIUS * 1.6 && Math.abs(dx) < RADIUS * 0.8) game.setAutoRun(true);
    const k = len > RADIUS ? RADIUS / len : 1;
    dx *= k;
    dy *= k;
    if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / RADIUS;
    const ny = dy / RADIUS;
    const set = (code: string, on: boolean) => (on ? input.press(code) : input.release(code));
    set('KeyW', ny < -0.3);
    set('KeyS', ny > 0.3);
    set('KeyA', nx < -0.3);
    set('KeyD', nx > 0.3);
    set('ShiftLeft', ny < -0.88);
  };
  const stickDown = (e: RPE<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (s.autoRun) game.setAutoRun(false);
    stick.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (base.current) {
      const r = e.currentTarget.getBoundingClientRect();
      base.current.style.left = `${e.clientX - r.left}px`;
      base.current.style.top = `${e.clientY - r.top}px`;
      base.current.classList.add('on');
    }
    setStick(0, 0);
  };
  const stickMove = (e: RPE<HTMLDivElement>) => {
    const st = stick.current;
    if (st && st.id === e.pointerId) setStick(e.clientX - st.x, e.clientY - st.y);
  };
  const stickUp = (e: RPE<HTMLDivElement>) => {
    if (stick.current?.id !== e.pointerId) return;
    stick.current = null;
    setStick(0, 0);
    base.current?.classList.remove('on');
  };

  // any drag that is not the stick turns the camera (including on the fire button)
  const lookDown = (e: RPE<HTMLElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    looks.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const lookMove = (e: RPE<HTMLElement>) => {
    const p = looks.current.get(e.pointerId);
    if (!p) return;
    input.look((e.clientX - p.x) * LOOK, (e.clientY - p.y) * LOOK);
    p.x = e.clientX;
    p.y = e.clientY;
  };
  const lookUp = (e: RPE<HTMLElement>) => {
    looks.current.delete(e.pointerId);
  };

  const tap = (code: string) => (e: RPE<HTMLElement>) => {
    e.stopPropagation();
    input.tap(code);
  };
  const ground = s.phase === 'playing';
  const active = s.active >= 0 ? s.slots[s.active] : null;

  return (
    <div className="touch" onContextMenu={(e) => e.preventDefault()}>
      <div className="touch-look" onPointerDown={lookDown} onPointerMove={lookMove} onPointerUp={lookUp} onPointerCancel={lookUp} />
      <div className="touch-stick" onPointerDown={stickDown} onPointerMove={stickMove} onPointerUp={stickUp} onPointerCancel={stickUp}>
        <div className="stick-base" ref={base}><div className="stick-knob" ref={knob} /></div>
      </div>

      <div className="touch-top">
        <button onClick={() => input.unlock()}>Ⅱ</button>
        <button onPointerDown={tap('KeyM')}>지도</button>
        {ground && <button onPointerDown={tap('Tab')}>가방</button>}
        <button className={s.autoPlay ? 'on' : ''} onClick={() => game.setAutoPlay(!s.autoPlay)}>오토</button>
        {ground && <button onPointerDown={(e) => { e.stopPropagation(); game.placePing(); }}>핑</button>}
      </div>

      {!s.autoPlay && <button className="tb interact" onPointerDown={tap('KeyF')}>
        {s.phase === 'flight' ? '강하' : s.phase === 'drop' ? '낙하산' : '줍기'}
      </button>}

      {ground && !s.autoPlay && active?.mode && (
        <button className="tb mode" onPointerDown={tap('KeyB')}>{active.mode}</button>
      )}
      {ground && !s.autoPlay && (
        <>
          <button
            className="tb fire"
            onPointerDown={(e) => { lookDown(e); input.setFire(true); }}
            onPointerMove={lookMove}
            onPointerUp={(e) => { lookUp(e); input.setFire(false); }}
            onPointerCancel={(e) => { lookUp(e); input.setFire(false); }}
          >
            사격
          </button>
          <button className={`tb ads ${ads ? 'on' : ''}`} onPointerDown={(e) => { e.stopPropagation(); input.setAds(!ads); setAds(!ads); }}>조준</button>
          <button className="tb jump" onPointerDown={tap('Space')}>점프</button>
          <button className="tb crouch" onPointerDown={tap('KeyC')}>앉기</button>
          <button className="tb reload" onPointerDown={tap('KeyR')}>장전</button>
          <button className="tb swap" onPointerDown={(e) => { e.stopPropagation(); input.scroll(1); }}>무기</button>
          <button className="tb heal" onPointerDown={tap('KeyH')}>회복</button>
          <button className="tb nade" onPointerDown={tap('KeyG')}>수류탄</button>
        </>
      )}
    </div>
  );
}
