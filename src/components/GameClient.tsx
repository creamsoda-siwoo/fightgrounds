'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Game } from '@/game/Game';
import type { Difficulty, Quality } from '@/game/config';
import { Room, cleanCode, makeCode, type StartMsg } from '@/game/net/Room';
import { HudStore } from '@/game/store';
import { supabaseConfigured } from '@/lib/supabase';
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
  const [difficulty, setDifficulty] = useState<Difficulty>(() => load<Difficulty>('fightgrounds.difficulty', 'normal'));
  const [error, setError] = useState('');
  const [touch] = useState(() => window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
  const [autoFire, setAutoFire] = useState(() => load('fightgrounds.autofire', touch));
  const [matchKey, setMatchKey] = useState(0);
  const [room, setRoom] = useState<Room | null>(null);
  const [, setRoomTick] = useState(0);
  const roomRef = useRef<Room | null>(null);
  const nameRef = useRef(name);
  const openRef = useRef<(code: string) => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let game: Game | null = null;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('quality') as Quality | null;
    const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    const quality = q && QUALITIES.includes(q) ? q : load<Quality>('fightgrounds.quality', coarse ? 'low' : 'medium');
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
        game.setAutoFire(load('fightgrounds.autofire', coarse));
        game.audio.volume = vol;
        gameRef.current = game;
        setGame(game);
        (window as unknown as { __game: Game }).__game = game;
        await game.init();
        // invite links (?room=CODE) drop you straight into that room
        const code = cleanCode(params.get('room') ?? '');
        if (!cancelled && code.length === 4) openRef.current(code);
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

  useEffect(() => {
    nameRef.current = name;
    roomRef.current?.setName(name);
  }, [name]);
  useEffect(() => () => roomRef.current?.leave(), []);

  const enterFullscreen = useCallback(() => {
    if (!touch) return;
    // phones: go fullscreen landscape when the browser allows it
    const el = document.documentElement;
    el.requestFullscreen?.().then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape')).catch(() => {});
  }, [touch]);

  const startOnline = useCallback((r: Room, m: StartMsg) => {
    const g = gameRef.current;
    const slot = m.roster.findIndex((x) => x.id === r.me.id);
    if (!g || slot < 0 || g.store.state.phase === 'loading') return;
    save('fightgrounds.name', nameRef.current);
    setMatchKey((k) => k + 1);
    enterFullscreen();
    g.startMatch(nameRef.current, { room: r, start: m, slot });
    r.setState('playing');
  }, [enterFullscreen]);

  const setUrlRoom = (code: string) => {
    const url = new URL(window.location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    window.history.replaceState(null, '', url.toString());
  };

  const openRoom = useCallback((code: string) => {
    roomRef.current?.leave();
    const r = new Room(code, nameRef.current);
    r.onChange = () => {
      setRoomTick((n) => n + 1);
      gameRef.current?.net?.refresh();
    };
    r.onPacket = (p) => gameRef.current?.net?.receive(p);
    r.onStart = (m) => startOnline(r, m);
    roomRef.current = r;
    setRoom(r);
    setUrlRoom(code);
    r.join();
  }, [startOnline]);
  useEffect(() => {
    openRef.current = openRoom;
  }, [openRoom]);

  const leaveRoom = useCallback(() => {
    const g = gameRef.current;
    if (g?.net) g.toMenu();
    roomRef.current?.leave();
    roomRef.current = null;
    setRoom(null);
    setUrlRoom('');
  }, []);

  const start = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    save('fightgrounds.name', name);
    setMatchKey((k) => k + 1);
    enterFullscreen();
    g.difficulty = difficulty;
    g.startMatch(name);
  }, [name, difficulty, enterFullscreen]);

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
          difficulty={difficulty}
          autoFire={autoFire}
          onAutoFire={(v) => {
            setAutoFire(v);
            save('fightgrounds.autofire', v);
            gameRef.current?.setAutoFire(v);
          }}
          onDifficulty={(d) => {
            setDifficulty(d);
            save('fightgrounds.difficulty', d);
          }}
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
          room={room}
          roomAvailable={supabaseConfigured()}
          onCreateRoom={() => openRoom(makeCode())}
          onJoinRoom={openRoom}
          onLeaveRoom={leaveRoom}
        />
      )}
      {live && game && <Hud game={game} s={s} />}
      {touch && game && (s.phase === 'flight' || s.phase === 'drop' || s.phase === 'playing') && !s.paused && !s.inventory && <TouchControls game={game} s={s} />}
      {touch && <div className="rotate-hint">화면을 가로로 돌려 주세요</div>}
      {s.phase === 'dead' && s.redeploy && game && (
        <div className="redeploy">
          <div className="redeploy-card">
            <span className="end-kicker">{s.result?.killer ? `${s.result.killer}에게 당했습니다` : '쓰러졌습니다'}</span>
            <h2>재강하 1회</h2>
            <p>두 번째 폭풍이 닫히기 전에 쓰러졌습니다. 안전 구역 상공에서 권총 한 자루로 다시 뛰어내릴 수 있습니다. 킬과 피해량 기록은 그대로 이어집니다.</p>
            <div className="end-actions">
              <button className="btn primary big" onClick={() => game.redeploy()}>재강하</button>
              <button className="btn" onClick={() => game.declineRedeploy()}>결과 보기</button>
            </div>
          </div>
        </div>
      )}
      {(s.phase === 'dead' || s.phase === 'won') && s.result && game && !s.redeploy && (
        <div style={{ display: s.spectating ? 'none' : 'contents' }}>
          <EndScreen
            key={matchKey}
            result={s.result}
            name={name}
            online={s.online}
            onAgain={s.online ? () => game.toMenu() : start}
            onMenu={s.online ? leaveRoom : () => game.toMenu()}
            onSpectate={s.phase === 'dead' && s.alive > 1 ? () => game.spectateNext(game.player.lastHitBy) : undefined}
          />
        </div>
      )}
      {s.phase === 'dead' && s.spectating && game && (
        <div className="spectate">
          <span>관전 중</span>
          <b>{s.spectating}</b>
          <em>생존 {s.alive}</em>
          <button className="btn" onClick={() => game.spectateNext()}>다음 생존자</button>
          <button className="btn primary" onClick={() => game.stopSpectate()}>결과 보기</button>
        </div>
      )}
      <div id="status" hidden>{error ? `error: ${error}` : s.phase}</div>
    </div>
  );
}
