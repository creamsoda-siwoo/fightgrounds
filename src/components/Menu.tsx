'use client';

import { useState } from 'react';
import { QUALITY, TOTAL_PLAYERS, type Quality } from '@/game/config';
import Leaderboard from './Leaderboard';

const CONTROLS: [string, string][] = [
  ['W A S D', '이동'],
  ['마우스', '시점 / 조준'],
  ['좌클릭', '사격 · 주먹'],
  ['우클릭', '정조준 (스코프)'],
  ['Shift', '달리기'],
  ['Space', '점프'],
  ['C / Ctrl', '앉기'],
  ['R', '재장전'],
  ['F', '줍기 · 강하 · 낙하산'],
  ['1 2 3', '무기 교체'],
  ['4 5 6', '구급상자 · 붕대 · 드링크'],
  ['G', '수류탄 투척'],
  ['Tab', '인벤토리'],
  ['M', '전체 지도'],
];

interface Props {
  name: string;
  quality: Quality;
  sensitivity: number;
  volume: number;
  fps: number;
  onName: (v: string) => void;
  onQuality: (q: Quality) => void;
  onSensitivity: (v: number) => void;
  onVolume: (v: number) => void;
  onStart: () => void;
}

export default function Menu(p: Props) {
  const [tab, setTab] = useState<'board' | 'keys' | 'settings'>('board');
  return (
    <div className="menu">
      <div className="menu-left">
        <div className="brand">
          <span className="brand-kicker">ISLAND SURVIVAL · {TOTAL_PLAYERS}인 배틀로얄</span>
          <h1>FIGHT<em>GROUNDS</em></h1>
          <p>폭풍이 조여 오는 해란 섬에 {TOTAL_PLAYERS}명이 강하합니다. 무기를 찾고, 안전 구역을 따라 이동하며, 마지막 한 명으로 살아남으세요.</p>
        </div>
        <form
          className="start"
          onSubmit={(e) => {
            e.preventDefault();
            p.onStart();
          }}
        >
          <label htmlFor="nick">닉네임</label>
          <input id="nick" value={p.name} maxLength={16} autoComplete="off" spellCheck={false} onChange={(e) => p.onName(e.target.value)} placeholder="생존자 이름" />
          <button type="submit" className="btn primary big">매치 시작</button>
          <span className="start-note">PC는 키보드·마우스, 모바일은 화면 터치 조작(가로 화면)</span>
          {p.fps > 0 && p.fps < 26 && p.quality !== 'low' && (
            <span className="start-note warn">현재 {p.fps} FPS — 설정 탭에서 그래픽 품질을 낮추면 더 부드럽게 플레이할 수 있습니다.</span>
          )}
        </form>
      </div>
      <div className="menu-right">
        <nav className="tabs">
          <button className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}>랭킹</button>
          <button className={tab === 'keys' ? 'on' : ''} onClick={() => setTab('keys')}>조작법</button>
          <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>설정</button>
        </nav>
        {tab === 'board' && <Leaderboard limit={10} highlight={p.name} />}
        {tab === 'keys' && (
          <div className="keys">
            {CONTROLS.map(([k, v]) => (
              <div key={k}><kbd>{k}</kbd><span>{v}</span></div>
            ))}
          </div>
        )}
        {tab === 'settings' && (
          <div className="settings">
            <div className="setting">
              <span>그래픽 품질</span>
              <div className="seg">
                {(Object.keys(QUALITY) as Quality[]).map((q) => (
                  <button key={q} className={p.quality === q ? 'on' : ''} onClick={() => p.onQuality(q)}>{QUALITY[q].label}</button>
                ))}
              </div>
              <small>품질을 바꾸면 월드를 다시 생성합니다.</small>
            </div>
            <div className="setting">
              <span>마우스 감도 <b>{p.sensitivity.toFixed(2)}</b></span>
              <input type="range" min={0.3} max={2.5} step={0.05} value={p.sensitivity} onChange={(e) => p.onSensitivity(Number(e.target.value))} />
            </div>
            <div className="setting">
              <span>음량 <b>{Math.round(p.volume * 100)}%</b></span>
              <input type="range" min={0} max={1} step={0.05} value={p.volume} onChange={(e) => p.onVolume(Number(e.target.value))} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
