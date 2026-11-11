'use client';

import { useEffect, useRef } from 'react';
import type { Game } from '@/game/Game';
import { WORLD_HALF, WORLD_SIZE } from '@/game/config';

const TAU = Math.PI * 2;

function wrap(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** draws the map window used by both the minimap and the full map */
function drawMap(g: CanvasRenderingContext2D, game: Game, size: number, cx: number, cz: number, span: number, full: boolean): void {
  const map = game.mapCanvas;
  if (!map) return;
  const scale = size / span;
  const toX = (x: number) => (x - cx) * scale + size / 2;
  const toY = (z: number) => (z - cz) * scale + size / 2;
  g.save();
  g.beginPath();
  if (full) g.rect(0, 0, size, size);
  else g.roundRect(0, 0, size, size, 10);
  g.clip();
  g.fillStyle = '#1a4268';
  g.fillRect(0, 0, size, size);
  const mpp = map.width / WORLD_SIZE;
  const sx = (cx - span / 2 + WORLD_HALF) * mpp;
  const sy = (cz - span / 2 + WORLD_HALF) * mpp;
  g.imageSmoothingQuality = 'high';
  g.drawImage(map, sx, sy, span * mpp, span * mpp, 0, 0, size, size);

  const zone = game.zone;
  if (zone.state !== 'idle') {
    // storm: everything outside the live circle is tinted
    g.save();
    g.beginPath();
    g.rect(0, 0, size, size);
    g.arc(toX(zone.cx), toY(zone.cz), Math.max(0.1, zone.r * scale), 0, TAU, true);
    g.fillStyle = 'rgba(128, 62, 220, 0.34)';
    g.fill('evenodd');
    g.restore();
    g.lineWidth = full ? 2.5 : 2;
    g.strokeStyle = 'rgba(214, 150, 255, 0.95)';
    g.beginPath();
    g.arc(toX(zone.cx), toY(zone.cz), Math.max(0.1, zone.r * scale), 0, TAU);
    g.stroke();
    if (zone.state !== 'final') {
      g.setLineDash([6, 5]);
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = full ? 2 : 1.5;
      g.beginPath();
      g.arc(toX(zone.nx), toY(zone.nz), Math.max(0.1, zone.nr * scale), 0, TAU);
      g.stroke();
      g.setLineDash([]);
    }
  }
  const plane = game.plane;
  if (plane.active) {
    g.strokeStyle = 'rgba(255,255,255,0.65)';
    g.setLineDash([10, 8]);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(toX(plane.from.x), toY(plane.from.z));
    g.lineTo(toX(plane.to.x), toY(plane.to.z));
    g.stroke();
    g.setLineDash([]);
    g.save();
    g.translate(toX(plane.pos.x), toY(plane.pos.z));
    g.rotate(Math.atan2(plane.dir.x, -plane.dir.z));
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(3, -2);
    g.lineTo(10, 2);
    g.lineTo(3, 3);
    g.lineTo(3, 8);
    g.lineTo(-3, 8);
    g.lineTo(-3, 3);
    g.lineTo(-10, 2);
    g.lineTo(-3, -2);
    g.closePath();
    g.fill();
    g.restore();
  }
  const p = game.player;
  // gunfire pings: who is shooting nearby
  for (const c of game.chars) {
    if (c === p || !c.alive || c.sinceShot > 1.6 || c.mode !== 'ground') continue;
    const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
    if (d > 190) continue;
    const a = 1 - c.sinceShot / 1.6;
    g.fillStyle = `rgba(255, 122, 48, ${0.85 * a})`;
    g.beginPath();
    g.arc(toX(c.pos.x), toY(c.pos.z), full ? 5 : 4, 0, TAU);
    g.fill();
    g.strokeStyle = `rgba(255, 122, 48, ${0.5 * a})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(toX(c.pos.x), toY(c.pos.z), (full ? 5 : 4) + (1 - a) * 12, 0, TAU);
    g.stroke();
  }
  // line to the next safe zone when outside it
  if (zone.state !== 'idle' && p.alive && !zone.insideNext(p.pos.x, p.pos.z)) {
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 1.5;
    g.setLineDash([3, 4]);
    g.beginPath();
    g.moveTo(toX(p.pos.x), toY(p.pos.z));
    const dx = zone.nx - p.pos.x;
    const dz = zone.nz - p.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    g.lineTo(toX(zone.nx - (dx / d) * zone.nr), toY(zone.nz - (dz / d) * zone.nr));
    g.stroke();
    g.setLineDash([]);
  }
  // player
  g.save();
  g.translate(toX(p.pos.x), toY(p.pos.z));
  g.rotate(Math.PI - game.ctl.yaw);
  g.fillStyle = p.alive ? '#ffd23e' : '#ff5a4a';
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.lineWidth = 2;
  const s = full ? 9 : 8;
  g.beginPath();
  g.moveTo(0, -s);
  g.lineTo(s * 0.7, s * 0.8);
  g.lineTo(0, s * 0.35);
  g.lineTo(-s * 0.7, s * 0.8);
  g.closePath();
  g.stroke();
  g.fill();
  g.restore();
  g.restore();
}

/**
 * Everything on the HUD that changes every frame is painted on canvases here
 * so React never re-renders at 60 Hz: crosshair, hit markers, damage
 * direction, compass, minimap and the full-screen map.
 */
export default function HudCanvas({ game, showMap }: { game: Game; showMap: boolean }) {
  const overlay = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const big = useRef<HTMLCanvasElement>(null);
  const mapOpen = useRef(showMap);
  useEffect(() => {
    mapOpen.current = showMap;
  }, [showMap]);

  useEffect(() => {
    let raf = 0;
    let frame = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      frame++;
      const cv = overlay.current;
      if (!cv) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const p = game.player;
      const ctl = game.ctl;
      if (!p || !ctl) return;
      const cx = w / 2;
      const cy = h / 2;
      const phase = game.store.state.phase;
      const playing = phase === 'playing' && p.alive;

      // ---------------------------------------------------- compass
      if (phase !== 'dead' && phase !== 'won') {
        const heading = Math.atan2(Math.sin(ctl.yaw), -Math.cos(ctl.yaw)); // clockwise from north
        const deg = ((heading * 180) / Math.PI + 360) % 360;
        const cw = Math.min(520, w * 0.42);
        const top = 18;
        g.save();
        g.beginPath();
        g.rect(cx - cw / 2, top - 4, cw, 44);
        g.clip();
        const ppd = cw / 120;
        g.textAlign = 'center';
        g.font = '600 12px system-ui, sans-serif';
        for (let a = -180; a < 540; a += 5) {
          let off = a - deg;
          while (off > 180) off -= 360;
          while (off < -180) off += 360;
          if (Math.abs(off) > 62) continue;
          const x = cx + off * ppd;
          const fade = 1 - Math.pow(Math.abs(off) / 62, 3);
          const an = ((a % 360) + 360) % 360;
          const major = an % 45 === 0;
          g.strokeStyle = `rgba(255,255,255,${(major ? 0.95 : an % 15 === 0 ? 0.6 : 0.3) * fade})`;
          g.lineWidth = major ? 2 : 1;
          g.beginPath();
          g.moveTo(x, top);
          g.lineTo(x, top + (major ? 11 : an % 15 === 0 ? 7 : 4));
          g.stroke();
          if (an % 15 === 0) {
            const label = an === 0 ? 'N' : an === 90 ? 'E' : an === 180 ? 'S' : an === 270 ? 'W' : an === 45 ? 'NE' : an === 135 ? 'SE' : an === 225 ? 'SW' : an === 315 ? 'NW' : String(an);
            g.fillStyle = an === 0 ? `rgba(255,178,62,${fade})` : `rgba(255,255,255,${(major ? 0.95 : 0.6) * fade})`;
            g.font = major ? '700 13px system-ui, sans-serif' : '500 10px system-ui, sans-serif';
            g.shadowColor = 'rgba(0,0,0,0.9)';
            g.shadowBlur = 4;
            g.fillText(label, x, top + 27);
            g.shadowBlur = 0;
          }
        }
        g.restore();
        g.fillStyle = '#ffb23e';
        g.beginPath();
        g.moveTo(cx, top - 1);
        g.lineTo(cx - 5, top - 9);
        g.lineTo(cx + 5, top - 9);
        g.closePath();
        g.fill();
      }

      // -------------------------------------------- damage direction
      const now = game.time;
      for (const m of game.damageMarks) {
        const age = now - m.t;
        if (age > 2.2) continue;
        const rel = wrap(m.angle - ctl.yaw); // positive = to the left
        const sa = -Math.PI / 2 - rel;
        const alpha = Math.min(1, (2.2 - age) / 1.2);
        g.strokeStyle = `rgba(255, 60, 40, ${0.85 * alpha})`;
        g.lineWidth = 9;
        g.lineCap = 'round';
        g.beginPath();
        g.arc(cx, cy, 118, sa - 0.2, sa + 0.2);
        g.stroke();
        g.strokeStyle = `rgba(255, 150, 120, ${0.6 * alpha})`;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(cx, cy, 126, sa - 0.11, sa + 0.11);
        g.stroke();
        g.lineCap = 'butt';
      }

      // ---------------------------------------------------- crosshair
      if (playing && p.mode === 'ground' && !game.store.state.inventory) {
        const tanHalf = Math.tan((game.camera.fov * Math.PI) / 360);
        if (ctl.scoped) {
          g.strokeStyle = 'rgba(8,10,12,0.95)';
          g.lineWidth = 1.4;
          const r = h * 0.425;
          g.beginPath();
          g.moveTo(cx - r, cy);
          g.lineTo(cx - 14, cy);
          g.moveTo(cx + 14, cy);
          g.lineTo(cx + r, cy);
          g.moveTo(cx, cy + 14);
          g.lineTo(cx, cy + r);
          g.moveTo(cx, cy - r);
          g.lineTo(cx, cy - 40);
          g.stroke();
          g.lineWidth = 3.5;
          g.beginPath();
          g.moveTo(cx - r, cy);
          g.lineTo(cx - r * 0.42, cy);
          g.moveTo(cx + r * 0.42, cy);
          g.lineTo(cx + r, cy);
          g.moveTo(cx, cy + r * 0.42);
          g.lineTo(cx, cy + r);
          g.stroke();
          g.fillStyle = 'rgba(220, 40, 30, 0.95)';
          g.beginPath();
          g.arc(cx, cy, 1.6, 0, TAU);
          g.fill();
          g.strokeStyle = 'rgba(8,10,12,0.8)';
          g.lineWidth = 1;
          for (let k = 1; k <= 4; k++) {
            g.beginPath();
            g.moveTo(cx - 5, cy + k * 22);
            g.lineTo(cx + 5, cy + k * 22);
            g.stroke();
          }
        } else if (p.weapon) {
          const gap = 4 + (Math.tan(ctl.spread) / tanHalf) * (h / 2);
          const len = p.ads ? 5 : 9;
          const line = (x0: number, y0: number, x1: number, y1: number) => {
            g.strokeStyle = 'rgba(0,0,0,0.65)';
            g.lineWidth = 3.4;
            g.beginPath();
            g.moveTo(x0, y0);
            g.lineTo(x1, y1);
            g.stroke();
            g.strokeStyle = 'rgba(255,255,255,0.96)';
            g.lineWidth = 1.6;
            g.beginPath();
            g.moveTo(x0, y0);
            g.lineTo(x1, y1);
            g.stroke();
          };
          line(cx - gap - len, cy, cx - gap, cy);
          line(cx + gap, cy, cx + gap + len, cy);
          line(cx, cy + gap, cx, cy + gap + len);
          if (!p.ads) line(cx, cy - gap - len, cx, cy - gap);
          g.fillStyle = 'rgba(255,255,255,0.9)';
          g.fillRect(cx - 1, cy - 1, 2, 2);
        } else {
          g.fillStyle = 'rgba(0,0,0,0.6)';
          g.beginPath();
          g.arc(cx, cy, 3.2, 0, TAU);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.95)';
          g.beginPath();
          g.arc(cx, cy, 2, 0, TAU);
          g.fill();
        }
      }
      // ---------------------------------------------------- hit marker
      const ha = now - game.hitT;
      const ka = now - game.killT;
      if (ha < 0.28 || ka < 0.5) {
        const kill = ka < 0.5;
        const t = kill ? ka / 0.5 : ha / 0.28;
        const s = 7 + (kill ? 5 : 0) + t * 4;
        g.strokeStyle = kill ? `rgba(255, 70, 50, ${1 - t})` : game.hitHead ? `rgba(255, 190, 60, ${1 - t})` : `rgba(255,255,255,${1 - t})`;
        g.lineWidth = kill ? 3 : 2.2;
        for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
          g.beginPath();
          g.moveTo(cx + sx * s, cy + sy * s);
          g.lineTo(cx + sx * (s + 8), cy + sy * (s + 8));
          g.stroke();
        }
      }

      // ------------------------------------------------------ minimap
      const mc = mini.current;
      if (mc && frame % 2 === 0 && phase !== 'dead' && phase !== 'won') {
        const mg = mc.getContext('2d');
        if (mg) {
          const size = mc.width;
          mg.setTransform(1, 0, 0, 1, 0, 0);
          mg.clearRect(0, 0, size, size);
          const span = p.mode === 'ground' ? 300 : 620;
          const src = p.mode === 'plane' ? game.plane.pos : p.pos;
          drawMap(mg, game, size, src.x, src.z, span, false);
        }
      }
      const bc = big.current;
      if (bc && mapOpen.current && frame % 3 === 0) {
        const bg = bc.getContext('2d');
        if (bg) {
          bg.setTransform(1, 0, 0, 1, 0, 0);
          drawMap(bg, game, bc.width, 0, 0, WORLD_SIZE, true);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [game]);

  return (
    <>
      <canvas ref={overlay} className="hud-overlay" />
      <div className="minimap">
        <canvas ref={mini} width={440} height={440} />
        <span className="minimap-n">N</span>
      </div>
      <div className={`bigmap ${showMap ? 'open' : ''}`}>
        <canvas ref={big} width={1024} height={1024} />
        <div className="bigmap-legend">
          <span><i className="dot you" /> 내 위치</span>
          <span><i className="ring storm" /> 폭풍 경계</span>
          <span><i className="ring safe" /> 다음 안전 구역</span>
          <span><i className="dot fire" /> 총성</span>
          <span className="hint">M 닫기</span>
        </div>
      </div>
    </>
  );
}
