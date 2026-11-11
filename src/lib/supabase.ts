import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Leaderboard storage. When the Supabase environment variables are present the
 * game reads and writes the shared `fightgrounds_matches` table; without them
 * (or when the network is unavailable) results are kept in localStorage so the
 * game stays fully playable offline.
 */

export interface MatchRow {
  nickname: string;
  placement: number;
  total_players: number;
  kills: number;
  damage: number;
  headshots: number;
  longest_kill: number;
  survival_seconds: number;
  score?: number;
  created_at?: string;
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const TABLE = 'fightgrounds_matches';
const LOCAL_KEY = 'fightgrounds.matches';

let client: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return !!URL && !!KEY;
}

function db(): SupabaseClient | null {
  if (!URL || !KEY) return null;
  if (!client) client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export function scoreOf(r: MatchRow): number {
  return r.kills * 100 + (r.total_players - r.placement) * 12 + Math.floor(r.damage / 10) + (r.placement === 1 ? 500 : 0);
}

function readLocal(): MatchRow[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as MatchRow[]) : [];
  } catch {
    return [];
  }
}
function writeLocal(rows: MatchRow[]): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(rows.slice(0, 50)));
  } catch {
    /* storage unavailable */
  }
}

export async function submitMatch(row: MatchRow): Promise<'online' | 'local'> {
  const local = readLocal();
  local.push({ ...row, score: scoreOf(row), created_at: new Date().toISOString() });
  local.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  writeLocal(local);
  const c = db();
  if (!c) return 'local';
  try {
    const { error } = await c.from(TABLE).insert(row);
    if (error) throw error;
    return 'online';
  } catch (e) {
    console.warn('[leaderboard] online submit failed, kept locally', e);
    return 'local';
  }
}

export async function fetchLeaderboard(limit = 15): Promise<{ rows: MatchRow[]; source: 'online' | 'local' }> {
  const c = db();
  if (c) {
    try {
      const { data, error } = await c
        .from(TABLE)
        .select('nickname,placement,total_players,kills,damage,headshots,longest_kill,survival_seconds,score,created_at')
        .order('score', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return { rows: (data ?? []) as MatchRow[], source: 'online' };
    } catch (e) {
      console.warn('[leaderboard] online fetch failed, showing local results', e);
    }
  }
  return { rows: readLocal().slice(0, limit), source: 'local' };
}
