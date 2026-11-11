'use client';

import { useEffect, useRef, useState } from 'react';
import type { MatchResult } from '@/game/store';
import { submitMatch } from '@/lib/supabase';
import Leaderboard from './Leaderboard';

function fmt(t: number): string {
  return `${Math.floor(t / 60)}분 ${String(t % 60).padStart(2, '0')}초`;
}

export default function EndScreen({ result, name, onAgain, onMenu }: { result: MatchResult; name: string; onAgain: () => void; onMenu: () => void }) {
  const [saved, setSaved] = useState<'saving' | 'online' | 'local'>('saving');
  const [refresh, setRefresh] = useState(0);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    submitMatch({
      nickname: name.trim().slice(0, 16) || '플레이어',
      placement: result.placement,
      total_players: result.total,
      kills: result.kills,
      damage: result.damage,
      headshots: Math.min(result.headshots, result.kills),
      longest_kill: result.longest,
      survival_seconds: result.time,
    }).then((where) => {
      setSaved(where);
      setRefresh((n) => n + 1);
    });
  }, [result, name]);

  return (
    <div className={`end ${result.won ? 'won' : 'lost'}`}>
      <div className="end-card">
        <span className="end-kicker">{result.won ? '최후의 생존자' : result.killer ? `${result.killer}에게 당했습니다` : '탈락'}</span>
        <h2>{result.won ? '승리!' : `#${result.placement}`}<small> / {result.total}</small></h2>
        <div className="end-stats">
          <div><b>{result.kills}</b><span>킬</span></div>
          <div><b>{result.damage}</b><span>피해량</span></div>
          <div><b>{result.headshots}</b><span>헤드샷</span></div>
          <div><b>{result.longest}m</b><span>최장 킬 거리</span></div>
          <div><b>{fmt(result.time)}</b><span>생존 시간</span></div>
        </div>
        <p className="end-saved">
          {saved === 'saving' && '기록 저장 중…'}
          {saved === 'online' && '온라인 랭킹에 기록되었습니다.'}
          {saved === 'local' && '이 기기에 기록되었습니다.'}
        </p>
        <div className="end-actions">
          <button className="btn primary big" onClick={onAgain}>다시 강하</button>
          <button className="btn" onClick={onMenu}>로비로</button>
        </div>
      </div>
      <Leaderboard refresh={refresh} limit={8} highlight={name} />
    </div>
  );
}
