'use client';

import { useEffect, useState } from 'react';
import type { Game } from '@/game/Game';
import { QUALITY, type Quality } from '@/game/config';
import { ARMOR, AMMO_LABEL, type AmmoType } from '@/game/items/defs';
import type { HudState } from '@/game/store';
import HudCanvas from './HudCanvas';

const RARITY = ['r0', 'r1', 'r2', 'r3'];

function fmt(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ArmorPip({ label, level, dur }: { label: string; level: number; dur: number }) {
  const max = ARMOR[level]?.dur || 1;
  return (
    <div className={`armor ${level > 0 ? `lv${level}` : 'none'}`}>
      <span className="armor-name">{label}</span>
      <span className="armor-lv">{level > 0 ? `Lv.${level}` : '없음'}</span>
      <span className="armor-bar"><i style={{ width: `${level > 0 ? Math.max(4, (dur / max) * 100) : 0}%` }} /></span>
    </div>
  );
}

function Inventory({ game, s }: { game: Game; s: HudState }) {
  return (
    <div className="inv-backdrop" onClick={(e) => { if (e.target === e.currentTarget) game.setInventory(false); }}>
      <div className="inv">
        <section className="inv-col">
          <h3>주변 아이템</h3>
          {s.near.length === 0 && <p className="inv-empty">근처에 주울 수 있는 아이템이 없습니다.</p>}
          {s.near.map((n) => (
            <button key={n.id} className={`inv-row ${RARITY[n.rarity]}`} onClick={() => game.uiPickup(n.id)}>
              <span>{n.label}</span>
              <em>줍기</em>
            </button>
          ))}
        </section>
        <section className="inv-col wide">
          <h3>무기</h3>
          {[0, 1, 2].map((i) => {
            const w = s.slots[i];
            return (
              <div key={i} className={`inv-weapon ${s.active === i ? 'active' : ''} ${w ? '' : 'empty'}`}>
                <b>{i + 1}</b>
                {w ? (
                  <>
                    <button className="inv-weapon-main" onClick={() => game.uiSelect(i)}>
                      <span className="inv-weapon-name">{w.name}</span>
                      <span className="inv-weapon-ammo">{w.ammo} / {w.reserve}</span>
                    </button>
                    <button className="inv-drop" onClick={() => game.uiDrop(i)}>버리기</button>
                  </>
                ) : (
                  <span className="inv-weapon-name muted">{i === 2 ? '보조 무기 슬롯' : '주 무기 슬롯'}</span>
                )}
              </div>
            );
          })}
          <h3>탄약</h3>
          <div className="inv-ammo">
            {(Object.keys(s.ammo) as AmmoType[]).map((t) => (
              <div key={t} className={s.ammo[t] > 0 ? '' : 'muted'}>
                <span>{AMMO_LABEL[t]}</span>
                <b>{s.ammo[t]}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="inv-col">
          <h3>장비</h3>
          <ArmorPip label="헬멧" level={s.helmet} dur={s.helmetDur} />
          <ArmorPip label="방탄조끼" level={s.vest} dur={s.vestDur} />
          <h3>소모품</h3>
          <button className="inv-row" disabled={s.medkits <= 0} onClick={() => game.uiUse('medkit')}><span>구급상자 ×{s.medkits}</span><em>4</em></button>
          <button className="inv-row" disabled={s.bandages <= 0} onClick={() => game.uiUse('bandage')}><span>붕대 ×{s.bandages}</span><em>5</em></button>
          <button className="inv-row" disabled={s.drinks <= 0} onClick={() => game.uiUse('drink')}><span>에너지 드링크 ×{s.drinks}</span><em>6</em></button>
          <div className="inv-row static"><span>파편 수류탄 ×{s.grenades}</span><em>G</em></div>
        </section>
        <button className="close-x" aria-label="닫기" onClick={() => game.setInventory(false)}>✕</button>
        <p className="inv-hint">Tab 또는 Esc 로 닫기</p>
      </div>
    </div>
  );
}

function PauseSettings({ game, quality }: { game: Game; quality: Quality }) {
  const [sens, setSens] = useState(() => game.input.sensitivity);
  const save = (key: string, v: unknown) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <div className="pause-settings">
      <label>
        <span>마우스 · 터치 감도 <b>{sens.toFixed(2)}</b></span>
        <input
          type="range" min={0.3} max={2.5} step={0.05} value={sens}
          onChange={(e) => {
            const v = Number(e.target.value);
            setSens(v);
            game.setSensitivity(v);
            save('fightgrounds.sens', v);
          }}
        />
      </label>
      <span>그래픽 품질 <small>(변경 시 매치를 다시 시작합니다)</small></span>
      <div className="seg">
        {(Object.keys(QUALITY) as Quality[]).map((q) => (
          <button
            key={q}
            className={quality === q ? 'on' : ''}
            onClick={() => {
              if (q === quality) return;
              save('fightgrounds.quality', q);
              const url = new URL(window.location.href);
              url.searchParams.delete('quality');
              window.location.href = url.toString();
            }}
          >
            {QUALITY[q].label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Hud({ game, s }: { game: Game; s: HudState }) {
  const [, force] = useState(0);
  // kill feed entries age out without a store update
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const ended = s.phase === 'dead' || s.phase === 'won';
  const active = s.active >= 0 ? s.slots[s.active] : null;
  const hpClass = s.hp > 60 ? 'ok' : s.hp > 30 ? 'warn' : 'bad';
  const inAir = s.phase === 'flight' || s.phase === 'drop';
  const feed = s.feed.filter((f) => game.time - f.t < 7);

  return (
    <div className={`hud ${ended ? 'ended' : ''}`}>
      <HudCanvas game={game} showMap={s.map && !ended} onCloseMap={() => game.store.emit({ map: false })} />

      {!ended && (
        <>
          <div className="top-right">
            <div className="counter"><b>{s.alive}</b><span>생존</span></div>
            <div className="counter kills"><b>{s.kills}</b><span>킬</span></div>
          </div>

          <div className="feed">
            {feed.map((f) => (
              <div key={f.id} className={`feed-row ${f.you ? 'you' : ''}`}>
                {f.killer ? (
                  <>
                    <span className="feed-killer">{f.killer}</span>
                    <span className="feed-weapon">{f.head ? '◎ ' : ''}{f.weapon}</span>
                    <span className="feed-victim">{f.victim}</span>
                  </>
                ) : (
                  <>
                    <span className="feed-victim">{f.victim}</span>
                    <span className="feed-weapon">{f.weapon} 사망</span>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className={`zone ${s.outside ? 'outside' : ''} ${s.zoneState}`}>
            {s.zoneState === 'waiting' && <><span className="zone-label">폭풍 이동까지</span><b>{fmt(s.zoneTimer)}</b></>}
            {s.zoneState === 'shrinking' && <><span className="zone-label">폭풍 수축 중</span><b>{fmt(s.zoneTimer)}</b></>}
            {s.zoneState === 'final' && <span className="zone-label">최종 구역</span>}
            {s.outside && <span className="zone-warn">폭풍 속입니다 — 안전 구역으로 이동하세요</span>}
          </div>

          {s.banner && (
            <div className="banner" key={s.bannerT}>
              <b>{s.banner}</b>
              {s.bannerSub && <span>{s.bannerSub}</span>}
            </div>
          )}

          {s.prompt && !s.inventory && <div className="prompt">{s.prompt}</div>}

          {s.action && !s.inventory && (
            <div className={`action ${s.actionProgress < 0 ? 'toast' : ''}`}>
              <span>{s.action}</span>
              {s.actionProgress >= 0 && <i><em style={{ width: `${Math.min(100, s.actionProgress * 100)}%` }} /></i>}
            </div>
          )}

          {!inAir && (
            <>
              <div className="vitals">
                <div className="gear">
                  <ArmorPip label="헬멧" level={s.helmet} dur={s.helmetDur} />
                  <ArmorPip label="조끼" level={s.vest} dur={s.vestDur} />
                </div>
                <div className="boost"><i style={{ width: `${s.boost}%` }} /></div>
                <div className={`hp ${hpClass}`}>
                  <i style={{ width: `${Math.min(100, s.hp)}%` }} />
                  <span>{s.hp}</span>
                </div>
              </div>

              <div className="loadout">
                <div className="ammo">
                  {active ? (
                    <>
                      <b className={active.ammo === 0 ? 'empty' : active.ammo <= active.mag * 0.25 ? 'low' : ''}>{active.ammo}</b>
                      <span>/ {active.reserve}</span>
                      <em>{active.name}</em>
                    </>
                  ) : (
                    <em>맨손</em>
                  )}
                </div>
                <div className="slots">
                  {[0, 1, 2].map((i) => {
                    const w = s.slots[i];
                    return (
                      <div key={i} className={`slot ${s.active === i ? 'active' : ''} ${w ? '' : 'empty'}`}>
                        <b>{i + 1}</b>
                        <span>{w ? w.name : '—'}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="items">
                  <div className={s.medkits ? '' : 'none'}><b>4</b><span>구급상자</span><em>{s.medkits}</em></div>
                  <div className={s.bandages ? '' : 'none'}><b>5</b><span>붕대</span><em>{s.bandages}</em></div>
                  <div className={s.drinks ? '' : 'none'}><b>6</b><span>드링크</span><em>{s.drinks}</em></div>
                  <div className={s.grenades ? '' : 'none'}><b>G</b><span>수류탄</span><em>{s.grenades}</em></div>
                </div>
              </div>
            </>
          )}

          {s.inventory && <Inventory game={game} s={s} />}

          {s.paused && (
            <div className="pause" onClick={() => game.resume()}>
              <div className="pause-card" onClick={(e) => e.stopPropagation()}>
                <h2>일시 정지</h2>
                <button className="btn primary" onClick={() => game.resume()}>계속하기</button>
                <PauseSettings game={game} quality={s.quality} />
                <button className="btn" onClick={() => game.toMenu()}>로비로 나가기</button>
                <p>화면을 클릭해도 게임으로 돌아갑니다.</p>
              </div>
            </div>
          )}
          <div className="fps">{s.fps} FPS</div>
        </>
      )}
    </div>
  );
}
