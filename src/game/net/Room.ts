import type { RealtimeChannel } from '@supabase/supabase-js';
import { realtimeClient } from '@/lib/supabase';
import type { Difficulty } from '../config';

/**
 * Multiplayer rooms on Supabase Realtime. A room is one broadcast channel:
 * presence lists who is in it, `start` launches a match for everyone and `p`
 * carries the in-match packets (see NetSync). Open rooms announce themselves
 * on a shared lobby channel so others can find them without a code.
 */

export const MAX_ROOM = 4;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface Member {
  id: string;
  name: string;
  /** join time, used for ordering (the earliest member is the host) */
  at: number;
  state: 'lobby' | 'playing';
  /** match this member walked out of (they no longer take part in it) */
  left: number;
}
export interface RosterEntry {
  id: string;
  name: string;
}
export interface StartMsg {
  mid: number;
  seed: number;
  roster: RosterEntry[];
  difficulty: Difficulty;
}
export interface Packet {
  /** sender */
  f: string;
  /** match id */
  m: number;
  /** sender clock (s) */
  t: number;
  /** sender's send interval (s) */
  iv: number;
  /** character snapshots */
  c: number[][];
  /** events */
  e: (string | number)[][];
  /** zone state (host only) */
  z?: number[];
}
export interface RoomInfo {
  code: string;
  host: string;
  n: number;
  playing: boolean;
}

export function makeCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
export function cleanCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

let tabId = '';
function myId(): string {
  if (!tabId) tabId = Math.random().toString(36).slice(2, 10);
  return tabId;
}

// ---------------------------------------------------------------- lobby board

interface Board {
  ch: RealtimeChannel;
  rooms: RoomInfo[];
  listeners: Set<(rooms: RoomInfo[]) => void>;
  ready: boolean;
  pending: RoomInfo | null | undefined;
}
let board: Board | null = null;

function lobbyBoard(): Board | null {
  if (board) return board;
  const sb = realtimeClient();
  if (!sb) return null;
  const ch = sb.channel('fg-lobby', { config: { presence: { key: myId(), enabled: true } } });
  const b: Board = { ch, rooms: [], listeners: new Set(), ready: false, pending: undefined };
  const read = () => {
    const st = ch.presenceState<RoomInfo>();
    const out: RoomInfo[] = [];
    for (const k of Object.keys(st)) {
      const m = st[k][st[k].length - 1];
      if (m && m.code) out.push({ code: m.code, host: m.host, n: m.n, playing: m.playing });
    }
    out.sort((a, b2) => Number(a.playing) - Number(b2.playing) || b2.n - a.n);
    b.rooms = out;
    for (const l of b.listeners) l(out);
  };
  ch.on('presence', { event: 'sync' }, read);
  ch.subscribe((status) => {
    if (status !== 'SUBSCRIBED') return;
    b.ready = true;
    if (b.pending !== undefined) {
      const p = b.pending;
      b.pending = undefined;
      void (p ? ch.track(p) : ch.untrack());
    }
  });
  board = b;
  return b;
}

/** live list of open rooms; returns an unsubscribe function */
export function watchRooms(cb: (rooms: RoomInfo[]) => void): () => void {
  const b = lobbyBoard();
  if (!b) return () => {};
  b.listeners.add(cb);
  cb(b.rooms);
  return () => b.listeners.delete(cb);
}

function announce(info: RoomInfo | null): void {
  const b = lobbyBoard();
  if (!b) return;
  if (!b.ready) {
    b.pending = info;
    return;
  }
  void (info ? b.ch.track(info) : b.ch.untrack());
}

// ----------------------------------------------------------------------- room

export class Room {
  status: 'connecting' | 'open' | 'full' | 'error' | 'closed' = 'connecting';
  error = '';
  members: Member[] = [];
  me: Member;
  onChange: (() => void) | null = null;
  onStart: ((m: StartMsg) => void) | null = null;
  onPacket: ((p: Packet) => void) | null = null;
  private ch: RealtimeChannel | null = null;
  private announced = '';
  private synced = false;

  constructor(public code: string, name: string) {
    this.me = { id: myId(), name: name.trim().slice(0, 16) || '플레이어', at: Date.now(), state: 'lobby', left: 0 };
  }

  get hostId(): string {
    return this.members[0]?.id ?? this.me.id;
  }
  get isHost(): boolean {
    return this.hostId === this.me.id;
  }
  get playing(): boolean {
    return this.members.some((m) => m.state === 'playing');
  }

  join(): void {
    const sb = realtimeClient();
    if (!sb) {
      this.fail('온라인 기능이 설정되지 않았습니다.');
      return;
    }
    const ch = sb.channel(`fg-room-${this.code}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.me.id, enabled: true } },
    });
    this.ch = ch;
    ch.on('presence', { event: 'sync' }, () => this.sync());
    ch.on('broadcast', { event: 'start' }, ({ payload }) => {
      const m = payload as StartMsg;
      if (m.roster.some((r) => r.id === this.me.id)) this.onStart?.(m);
    });
    ch.on('broadcast', { event: 'p' }, ({ payload }) => this.onPacket?.(payload as Packet));
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void ch.track(this.me);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        if (this.status === 'connecting') this.fail('방에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    });
    // presence normally syncs within a second; give up if it never does
    window.setTimeout(() => {
      if (this.status === 'connecting') this.fail('방에 연결하지 못했습니다. 네트워크를 확인해 주세요.');
    }, 12000);
  }

  private fail(msg: string): void {
    this.status = 'error';
    this.error = msg;
    this.close();
    this.onChange?.();
  }

  private sync(): void {
    if (!this.ch) return;
    const st = this.ch.presenceState<Member>();
    const out: Member[] = [];
    for (const k of Object.keys(st)) {
      const m = st[k][st[k].length - 1];
      if (m && m.id) out.push({ id: m.id, name: m.name, at: m.at, state: m.state, left: m.left ?? 0 });
    }
    out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    if (!out.some((m) => m.id === this.me.id)) {
      // our own presence has not been echoed yet
      if (!this.synced) return;
      out.push(this.me);
    }
    this.synced = true;
    this.members = out;
    if (this.status === 'connecting') {
      const idx = out.findIndex((m) => m.id === this.me.id);
      if (idx >= MAX_ROOM) {
        this.status = 'full';
        this.error = `방이 가득 찼습니다 (최대 ${MAX_ROOM}명).`;
        this.close();
        this.onChange?.();
        return;
      }
      this.status = 'open';
    }
    this.updateBoard();
    this.onChange?.();
  }

  private updateBoard(): void {
    if (this.status !== 'open' || !this.isHost) {
      if (this.announced) {
        this.announced = '';
        announce(null);
      }
      return;
    }
    const info: RoomInfo = { code: this.code, host: this.me.name, n: this.members.length, playing: this.playing };
    const key = JSON.stringify(info);
    if (key === this.announced) return;
    this.announced = key;
    announce(info);
  }

  setName(name: string): void {
    const n = name.trim().slice(0, 16) || '플레이어';
    if (n === this.me.name) return;
    this.me = { ...this.me, name: n };
    if (this.status === 'open') void this.ch?.track(this.me);
  }

  setState(state: Member['state'], left = this.me.left): void {
    this.me = { ...this.me, state, left };
    const i = this.members.findIndex((m) => m.id === this.me.id);
    if (i >= 0) this.members[i] = this.me;
    if (this.status === 'open') void this.ch?.track(this.me);
    this.updateBoard();
  }

  /** host only: launch a match for everyone currently in the room */
  start(difficulty: Difficulty): void {
    if (!this.ch || this.status !== 'open' || !this.isHost) return;
    const roster = this.members.slice(0, MAX_ROOM).map((m) => ({ id: m.id, name: m.name }));
    const msg: StartMsg = { mid: (Math.random() * 2 ** 31) >>> 0, seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0, roster, difficulty };
    void this.ch.send({ type: 'broadcast', event: 'start', payload: msg });
    this.onStart?.(msg);
  }

  send(p: Packet): void {
    if (!this.ch || this.status !== 'open') return;
    void this.ch.send({ type: 'broadcast', event: 'p', payload: p });
  }

  private close(): void {
    if (this.announced) {
      this.announced = '';
      announce(null);
    }
    const ch = this.ch;
    this.ch = null;
    if (ch) void realtimeClient()?.removeChannel(ch);
  }

  leave(): void {
    this.status = 'closed';
    this.close();
    this.onChange = this.onStart = this.onPacket = null;
  }
}
