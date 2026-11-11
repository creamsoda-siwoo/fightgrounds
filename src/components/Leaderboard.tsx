'use client';

import { useEffect, useState } from 'react';
import { fetchLeaderboard, scoreOf, type MatchRow } from '@/lib/supabase';

export default function Leaderboard({ refresh = 0, limit = 10, highlight }: { refresh?: number; limit?: number; highlight?: string }) {
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [source, setSource] = useState<'online' | 'local'>('local');

  useEffect(() => {
    let alive = true;
    fetchLeaderboard(limit).then((r) => {
      if (!alive) return;
      setRows(r.rows);
      setSource(r.source);
    });
    return () => {
      alive = false;
    };
  }, [refresh, limit]);

  return (
    <div className="board">
      <div className="board-head">
        <h3>명예의 전당</h3>
        <span className={`board-src ${source}`}>{source === 'online' ? '온라인 랭킹' : '이 기기 기록'}</span>
      </div>
      {rows === null && <p className="board-empty">불러오는 중…</p>}
      {rows !== null && rows.length === 0 && <p className="board-empty">아직 기록이 없습니다. 첫 번째 생존자가 되어 보세요.</p>}
      {rows !== null && rows.length > 0 && (
        <table>
          <thead>
            <tr><th>#</th><th>닉네임</th><th>순위</th><th>킬</th><th>피해량</th><th>점수</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`${r.placement === 1 ? 'win' : ''} ${highlight && r.nickname === highlight ? 'me' : ''}`}>
                <td>{i + 1}</td>
                <td className="nick">{r.nickname}</td>
                <td>{r.placement === 1 ? '우승' : `${r.placement}위`}</td>
                <td>{r.kills}</td>
                <td>{r.damage}</td>
                <td className="score">{r.score ?? scoreOf(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
