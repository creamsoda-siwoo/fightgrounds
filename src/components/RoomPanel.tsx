'use client';

import { useEffect, useState } from 'react';
import { DIFFICULTY, TOTAL_PLAYERS, type Difficulty } from '@/game/config';
import { MAX_ROOM, cleanCode, watchRooms, type Room, type RoomInfo } from '@/game/net/Room';

interface Props {
  name: string;
  room: Room | null;
  available: boolean;
  difficulty: Difficulty;
  onName: (v: string) => void;
  onDifficulty: (d: Difficulty) => void;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onLeave: () => void;
  onBack: () => void;
}

export default function RoomPanel(p: Props) {
  const [code, setCode] = useState('');
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [copied, setCopied] = useState(false);
  const room = p.room;
  const inRoom = !!room && (room.status === 'connecting' || room.status === 'open');

  useEffect(() => {
    if (!p.available || inRoom) return;
    return watchRooms(setRooms);
  }, [p.available, inRoom]);

  if (!p.available) {
    return (
      <div className="room">
        <h2>같이 하기</h2>
        <p className="room-note">온라인 기능이 설정되지 않아 이 서버에서는 함께 플레이할 수 없습니다.</p>
        <button type="button" className="btn" onClick={p.onBack}>혼자 하기로 돌아가기</button>
      </div>
    );
  }

  if (room && inRoom) {
    const isHost = room.isHost;
    const busy = room.members.some((m) => m.state === 'playing' && m.id !== room.me.id);
    const n = Math.min(room.members.length, MAX_ROOM);
    return (
      <div className="room">
        <div className="room-head">
          <div>
            <span className="room-label">방 코드</span>
            <b className="room-code">{room.code}</b>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const url = `${window.location.origin}/?room=${room.code}`;
              navigator.clipboard?.writeText(url).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }).catch(() => {});
            }}
          >
            {copied ? '복사됨' : '초대 링크 복사'}
          </button>
        </div>
        {room.status === 'connecting' ? (
          <p className="room-note">방에 연결하는 중…</p>
        ) : (
          <>
            <input aria-label="닉네임" className="room-input" value={p.name} maxLength={16} autoComplete="off" spellCheck={false} onChange={(e) => p.onName(e.target.value)} placeholder="내 닉네임" />
            <ul className="room-members">
              {room.members.slice(0, MAX_ROOM).map((m, i) => (
                <li key={m.id} className={m.id === room.me.id ? 'me' : ''}>
                  <span className="room-slot">{i === 0 ? '방장' : `P${i + 1}`}</span>
                  <b>{m.name}</b>
                  <em>{m.state === 'playing' ? '경기 중' : '대기'}</em>
                </li>
              ))}
              {Array.from({ length: MAX_ROOM - n }, (_, i) => (
                <li key={`e${i}`} className="empty"><span className="room-slot">P{n + i + 1}</span><b>빈 자리 · AI</b></li>
              ))}
            </ul>
            {isHost ? (
              <>
                <div className="difficulty" role="group" aria-label="AI 난이도">
                  <span>AI 난이도</span>
                  {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
                    <button type="button" key={d} className={p.difficulty === d ? 'on' : ''} onClick={() => p.onDifficulty(d)}>{DIFFICULTY[d].label}</button>
                  ))}
                </div>
                <button type="button" className="btn primary big" onClick={() => room.start(p.difficulty)}>
                  {n}명 + AI {TOTAL_PLAYERS - n}명으로 시작
                </button>
                {busy && <p className="room-note">경기 중인 사람이 있습니다. 시작하면 모두 새 경기로 이동합니다.</p>}
              </>
            ) : (
              <p className="room-note">{busy ? '경기가 진행 중입니다. 다음 경기부터 함께합니다.' : '방장이 시작하면 모두 함께 수송기에 탑승합니다.'}</p>
            )}
          </>
        )}
        <button type="button" className="btn room-leave" onClick={p.onLeave}>방 나가기</button>
      </div>
    );
  }

  return (
    <div className="room">
      <h2>같이 하기 <small>최대 {MAX_ROOM}명 · 빈 자리는 AI</small></h2>
      <label htmlFor="nick-room">닉네임</label>
      <input id="nick-room" className="room-input" value={p.name} maxLength={16} autoComplete="off" spellCheck={false} onChange={(e) => p.onName(e.target.value)} placeholder="생존자 이름" />
      {room && (room.status === 'error' || room.status === 'full') && <p className="room-note warn">{room.error}</p>}
      <button type="button" className="btn primary big" onClick={p.onCreate}>방 만들기</button>
      <form
        className="room-join"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 4) p.onJoin(code);
        }}
      >
        <input className="room-input code" value={code} maxLength={4} placeholder="방 코드" autoComplete="off" spellCheck={false} onChange={(e) => setCode(cleanCode(e.target.value))} />
        <button type="submit" className="btn" disabled={code.length !== 4}>참가</button>
      </form>
      <div className="room-list">
        <span className="room-label">열린 방</span>
        {rooms.length === 0 && <p className="room-note">지금 열린 방이 없습니다. 방을 만들고 초대 링크를 보내 보세요.</p>}
        {rooms.slice(0, 6).map((r) => (
          <button type="button" key={r.code} className="room-row" disabled={r.n >= MAX_ROOM} onClick={() => p.onJoin(r.code)}>
            <b>{r.code}</b>
            <span>{r.host}</span>
            <em>{r.playing ? '경기 중' : '대기 중'} · {r.n}/{MAX_ROOM}</em>
          </button>
        ))}
      </div>
      <button type="button" className="btn room-leave" onClick={p.onBack}>혼자 하기</button>
    </div>
  );
}
