'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Game } from '@/game/Game';
import type { Quality } from '@/game/config';
import { HudStore } from '@/game/store';
import EndScreen from './EndScreen';
import Hud from './Hud';
import Menu from './Menu';
import TouchControls from './TouchControls';

const QUALITIES: Quality[] = ['low', 'medium', 'high', 'ultra'];

function load<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export default function GameClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [store] = useState(() => new HudStore());
  const s = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // this component only ever renders in the browser (see GameLoader), so
  // reading saved preferences during the first render is safe
  const [name, setName] = useState(() => load('fightgrounds.name', ''));
  const [sensitivity, setSensitivity] = useState(() => load('fightgrounds.sens', 1));
  const [volume, setVolume] = useState(() => load('fightgrounds.volume', 0.8));
  const [error, setError] = useState('');
  const [touch] = useState(() => window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
  const [matchKey, setMatchKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let game: Game | null = null;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('quality') as Quality | null;
    const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    const quality = q && QUALITIES.includes(q) ? q : load<Quality>('fightgrounds.quality', coarse ? 'low' : 'high');
    const sens = load('fightgrounds.sens', 1);
    const vol = load('fightgrounds.volume', 0.8);
    (async () => {
      try {
        const { Game: GameClass } = await import('@/game/Game');
        if (cancelled || !canvasRef.current) return;
        game = new GameClass(canvasRef.current, QUALITIES.includes(quality) ? quality : 'high', store);
        game.manual = params.has('manual');
        game.input.sensitivity = sens;
        game.input.touch = coarse;
        game.audio.volume = vol;
        gameRef.current = game;
        setGame(game);
        (window as unknown as { __game: Game }).__game = game;
        await game.init();
      } catch (e) {
        console.error(e);
        if (!cancelled) setError((e as Error).message || 'WebGL을 초기화하지 못했습니다.');
      }
    })();
    return () => {
      cancelled = true;
      game?.dispose();
      gameRef.current = null;
    };
  }, [store]);

  const start = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    save('fightgrounds.name', name);
    setMatchKey((k) => k + 1);
    if (touch) {
      // phones: go fullscreen landscape when the browser allows it
      const el = document.documentElement;
      el.requestFullscreen?.().then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape')).catch(() => {});
    }
    g.startMatch(name);
  }, [name, touch]);

  const live = s.phase === 'flight' || s.phase === 'drop' || s.phase === 'playing' || s.phase === 'dead' || s.phase === 'won';

  return (
    <div className={`game-root ${touch ? 'is-touch' : ''}`}>
      <canvas ref={canvasRef} className="game-canvas" />
      {s.phase === 'loading' && !error && (
        <div className="loading">
          <h1>FIGHT<em>GROUNDS</em></h1>
          <div className="loading-bar"><i style={{ width: `${Math.round(s.progress * 100)}%` }} /></div>
          <p>{s.progressLabel || '준비 중'} · {Math.round(s.progress * 100)}%</p>
        </div>
      )}
      {error && (
        <div className="loading">
          <h1>FIGHT<em>GROUNDS</em></h1>
          <p className="err">게임을 시작할 수 없습니다: {error}</p>
          <p>WebGL2를 지원하는 최신 데스크톱 브라우저에서 다시 시도해 주세요.</p>
        </div>
      )}
      {s.phase === 'menu' && (
        <Menu
          name={name}
          quality={s.quality}
          sensitivity={sensitivity}
          volume={volume}
          fps={s.fps}
          onName={setName}
          onQuality={(q) => {
            if (q === s.quality) return;
            save('fightgrounds.quality', q);
            const url = new URL(window.location.href);
            url.searchParams.delete('quality');
            window.location.href = url.toString();
          }}
          onSensitivity={(v) => {
            setSensitivity(v);
            save('fightgrounds.sens', v);
            if (gameRef.current) gameRef.current.input.sensitivity = v;
          }}
          onVolume={(v) => {
            setVolume(v);
            save('fightgrounds.volume', v);
            gameRef.current?.audio.setVolume(v);
          }}
          onStart={start}
        />
      )}
      {live && game && <Hud game={game} s={s} />}
      {touch && game && (s.phase === 'flight' || s.phase === 'drop' || s.phase === 'playing') && !s.paused && !s.inventory && <TouchControls game={game} s={s} />}
      {touch && <div className="rotate-hint">화면을 가로로 돌려 주세요</div>}
      {(s.phase === 'dead' || s.phase === 'won') && s.result && game && (
        <EndScreen key={matchKey} result={s.result} name={name} onAgain={start} onMenu={() => game.toMenu()} />
      )}
      <div id="status" hidden>{error ? `error: ${error}` : s.phase}</div>
    </div>
  );
}
