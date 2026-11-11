'use client';

import { useEffect, useRef, useState } from 'react';
import type { Game } from '@/game/Game';
import type { Quality } from '@/game/config';

export default function GameClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let game: Game | null = null;
    let cancelled = false;
    (async () => {
      const { Game } = await import('@/game/Game');
      if (cancelled || !canvasRef.current) return;
      const params = new URLSearchParams(window.location.search);
      const quality = (params.get('quality') as Quality) || 'high';
      game = new Game(canvasRef.current, quality);
      game.manual = params.has('manual');
      (window as unknown as { __game: Game }).__game = game;
      game.onProgress = (p, label) => setStatus(`${Math.round(p * 100)}% ${label}`);
      try {
        await game.init();
        setStatus('ready');
      } catch (e) {
        console.error(e);
        setStatus('error: ' + (e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      game?.dispose();
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div id="status" style={{ position: 'fixed', left: 8, top: 8, color: '#fff', font: '12px monospace' }}>{status}</div>
    </div>
  );
}
