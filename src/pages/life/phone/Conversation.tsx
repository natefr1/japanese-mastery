// A single chat: bubbles, presence (typing / 既読), reactions, stickers, plans,
// an IME-safe free-form composer, on-demand hints and word inspection.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as RKE } from "react";
import { social, useChatChanged } from "../../../lib/social/api";
import type { ConversationView, Message } from "../../../lib/social/types";
import { tokenize } from "../../../lib/reading/tokenizer";
import { NpcAvatar, StickerArt } from "./art";
import { dayLabel, useEscape, usePhone } from "./ctx";
import { EMOJI, KAOMOJI, QUICK_REACTIONS } from "./emoji";

const PAGE = 60;

export function Conversation({ id }: { id: string }) {
  const { npc, back, push, ai, sticker } = usePhone();
  const [conv, setConv] = useState<ConversationView | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [more, setMore] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [inspect, setInspect] = useState<Message | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [newBelow, setNewBelow] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  useEscape(closeMenu, menu);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([social.chat(id), social.messages(id, undefined, PAGE)]);
      setConv(c);
      setMsgs((old) => {
        // Keep older pages already loaded; replace the recent window.
        const first = m[0]?.deliver_at ?? Infinity;
        return [...old.filter((x) => x.deliver_at < first), ...m];
      });
      if (m.length < PAGE && msgs.length === 0) setMore(false);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    load();
    social.open(id).catch(() => {});
    return () => {
      social.open(null).catch(() => {});
    };
  }, [id, load]);

  useChatChanged((ids) => {
    if (ids.includes(id)) {
      load();
      social.markRead(id).catch(() => {});
    }
  });

  // Auto-scroll only when already at the bottom; otherwise offer a pill.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const grew = msgs.length > lastCount.current;
    lastCount.current = msgs.length;
    if (stick.current) el.scrollTop = el.scrollHeight;
    else if (grew) setNewBelow(true);
  }, [msgs, conv?.typing.length]);

  const onScroll = () => {
    const el = scroller.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (stick.current) setNewBelow(false);
    if (el.scrollTop < 40 && more && msgs.length) loadOlder();
  };

  const loading = useRef(false);
  const loadOlder = async () => {
    if (loading.current) return;
    loading.current = true;
    const el = scroller.current!;
    const h = el.scrollHeight;
    const older = await social.messages(id, msgs[0]!.deliver_at, PAGE).catch(() => []);
    if (older.length < PAGE) setMore(false);
    setMsgs((m) => [...older, ...m]);
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight - h;
      loading.current = false;
    });
  };

  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    stick.current = true;
    setNewBelow(false);
  };

  if (err && !conv) return <div className="ph-page"><header className="ph-head"><button className="ph-back" onClick={back}>‹</button><h2>トーク</h2></header><p className="ph-empty">{err}</p></div>;
  if (!conv) return <div className="ph-page"><header className="ph-head"><button className="ph-back" onClick={back}>‹</button></header></div>;

  const direct = conv.kind === "direct" ? npc(conv.members.find((m) => m !== "player") ?? "") : undefined;
  const typingNames = conv.typing.map((t) => npc(t.member_id)?.display ?? "");
  const subtitle = conv.typing.length
    ? conv.kind === "group" ? `${typingNames.join("、")}が入力中…` : "入力中…"
    : conv.kind === "group" ? `${conv.members.length}人` : conv.kind === "memo" ? "自分だけのメモ" : direct?.busy_now ? `${direct.busy_now}中かも` : direct?.online_now ? "この時間はよくオンライン" : "";
  const failed = msgs.some((m) => m.reply_state === "failed");

  return (
    <div className="ph-page ph-chat">
      <header className="ph-head chat-head">
        <button className="ph-back" onClick={back} aria-label="Back">‹</button>
        <button className="chat-title" onClick={() => direct && push({ s: "profile", id: direct.id })} disabled={!direct}>
          <b>{conv.title}{conv.kind === "group" && <span className="cr-n"> ({conv.members.length})</span>}</b>
          <span className={conv.typing.length ? "typing" : ""}>{subtitle}</span>
        </button>
        <span className="spacer" />
        <button className="ph-icon" onClick={() => setMenu((v) => !v)} aria-label="Chat menu" aria-expanded={menu}>☰</button>
        {menu && (
          <div className="pop-menu right" role="menu" data-esc-layer>
            {direct && <button role="menuitem" onClick={() => { setMenu(false); push({ s: "profile", id: direct.id }); }}>プロフィール</button>}
            {conv.kind !== "memo" && <button role="menuitem" onClick={() => { setMenu(false); push({ s: "review", id }); }}>日本語をふりかえる (review)</button>}
            <button role="menuitem" onClick={() => social.flag(id, "pinned", !conv.pinned).then(load).finally(() => setMenu(false))}>{conv.pinned ? "ピン留めを解除" : "ピン留め"}</button>
            <button role="menuitem" onClick={() => social.flag(id, "muted", !conv.muted).then(load).finally(() => setMenu(false))}>{conv.muted ? "通知をオン" : "通知をオフ"}</button>
            <button role="menuitem" className="danger" onClick={() => {
              if (window.confirm("Delete this chat's history? Characters keep their memories unless you delete those in their profile.")) {
                social.clear(id).then(() => { setMsgs([]); load(); });
              }
              setMenu(false);
            }}>トーク履歴を削除</button>
            <button role="menuitem" className="muted-item" onClick={() => setMenu(false)}>閉じる</button>
          </div>
        )}
      </header>

      {ai && !ai.ready && conv.kind !== "memo" && (
        <button className="setup-banner slim" onClick={() => push({ s: "settings" })}>
          Replies need an AI connection — <u>set up</u>
        </button>
      )}

      <div className="msgs" ref={scroller} onScroll={onScroll} onClick={() => setActive(null)}>
        {!more && msgs.length > 0 && <div className="msgs-start">{conv.kind === "memo" ? "メモの始まり" : "トークの始まり"}</div>}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const next = msgs[i + 1];
          const newDay = !prev || new Date(prev.deliver_at).toDateString() !== new Date(m.deliver_at).toDateString();
          const runStart = newDay || !prev || prev.sender_id !== m.sender_id || m.deliver_at - prev.deliver_at > 5 * 60_000 || prev.kind === "plan";
          const runEnd = !next || next.sender_id !== m.sender_id || next.deliver_at - m.deliver_at > 5 * 60_000 || new Date(next.deliver_at).toDateString() !== new Date(m.deliver_at).toDateString();
          return (
            <Fragment key={m.id}>
              {newDay && <div className="day-sep"><span>{dayLabel(m.deliver_at)}</span></div>}
              <Bubble m={m} conv={conv} runStart={runStart} runEnd={runEnd} active={active === m.id}
                onActivate={(e) => { e.stopPropagation(); setActive(active === m.id ? null : m.id); }}
                onInspect={() => { setInspect(m); setActive(null); }}
                stickerOf={sticker} />
            </Fragment>
          );
        })}
        {conv.typing.map((t) => (
          <div key={t.member_id} className="msg in run-start typing-row" aria-live="polite">
            <NpcAvatar id={t.member_id} color={npc(t.member_id)?.color} size={32} />
            <div className="ph-bubble typing-bubble" aria-label={`${npc(t.member_id)?.display ?? ""} is typing`}><i /><i /><i /></div>
          </div>
        ))}
        {failed && <FailedNote id={id} msgs={msgs} onRetry={load} />}
      </div>
      {newBelow && <button className="new-below" onClick={toBottom}>新しいメッセージ ↓</button>}

      <Composer conv={conv} onSent={(m) => { stick.current = true; setMsgs((x) => [...x, m]); }} />
      {inspect && <Inspect m={inspect} onClose={() => setInspect(null)} />}
    </div>
  );
}

function FailedNote({ id, msgs, onRetry }: { id: string; msgs: Message[]; onRetry: () => void }) {
  const { push } = usePhone();
  const last = [...msgs].reverse().find((m) => m.reply_state === "failed");
  const setup = last?.reply_error && /set up|agreed|key|budget/i.test(last.reply_error);
  return (
    <div className="failed-note" role="alert">
      <span>{last?.reply_error ?? "Couldn't get a reply."}</span>
      <span className="row-gap">
        {setup && <button className="pill-btn" onClick={() => push({ s: "settings" })}>Open settings</button>}
        <button className="pill-btn" onClick={() => social.retry(id).then(onRetry)}>Retry</button>
      </span>
    </div>
  );
}

function Bubble({ m, conv, runStart, runEnd, active, onActivate, onInspect, stickerOf }: {
  m: Message; conv: ConversationView; runStart: boolean; runEnd: boolean; active: boolean;
  onActivate: (e: React.MouseEvent) => void; onInspect: () => void; stickerOf: (id: string) => { caption: string; face: string; prop: string } | undefined;
}) {
  const { npc, nav } = usePhone();
  const mine = m.sender_id === "player";
  const t = new Date(m.deliver_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

  if (m.kind === "plan") {
    const meta = (m.meta ?? {}) as { when?: string; place?: string };
    return (
      <div className="plan-card">
        <div className="plan-ico">📅</div>
        <div className="plan-body">
          <span className="faint">予定が追加されました</span>
          <b>{m.body}</b>
          <span>{[meta.when, meta.place].filter(Boolean).join(" · ")}</span>
        </div>
        <button className="pill-btn" onClick={() => { nav({ t: "phone.close" }); nav({ t: "panel.open", panel: "calendar" }); }}>カレンダー</button>
      </div>
    );
  }
  if (m.kind === "system") return <div className="sys-line">{m.body}</div>;

  const who = npc(m.sender_id);
  const st = m.sticker_id ? stickerOf(m.sticker_id) : undefined;
  const myReaction = m.reactions.find(([w]) => w === "player")?.[1];
  const react = (e: string) => social.react(m.id, myReaction === e ? null : e).catch(() => {});

  return (
    <div className={`msg ${mine ? "out" : "in"}${runStart ? " run-start" : ""}${runEnd ? " run-end" : ""}${active ? " active" : ""}`}>
      {!mine && (runStart ? <NpcAvatar id={m.sender_id} color={who?.color} size={32} /> : <span className="av-gap" />)}
      <div className="msg-col">
        {!mine && runStart && conv.kind === "group" && <span className="sender">{who?.display ?? m.sender_id}</span>}
        <div className="msg-line">
          {mine && <Meta m={m} t={t} conv={conv} mine />}
          {m.kind === "sticker" && st ? (
            <button className="sticker-msg" onClick={onActivate} aria-label={`Sticker: ${st.caption}`}><StickerArt id={m.sticker_id!} {...st} size={124} /></button>
          ) : (
            <button className={`ph-bubble${runStart ? " tail" : ""}`} onClick={onActivate} lang="ja">{m.body}</button>
          )}
          {!mine && <Meta m={m} t={t} conv={conv} />}
        </div>
        {m.reactions.length > 0 && (
          <div className="reactions">
            {Object.entries(m.reactions.reduce<Record<string, number>>((a, [, e]) => ({ ...a, [e]: (a[e] ?? 0) + 1 }), {})).map(([e, n]) => (
              <button key={e} className={`react-chip${myReaction === e ? " mine" : ""}`} onClick={() => react(e)}>{e}{n > 1 && <small>{n}</small>}</button>
            ))}
          </div>
        )}
        {active && (
          <div className="msg-tools" onClick={(e) => e.stopPropagation()}>
            {QUICK_REACTIONS.map((e) => <button key={e} className={myReaction === e ? "on" : ""} onClick={() => react(e)} aria-label={`React ${e}`}>{e}</button>)}
            {!mine && m.kind === "text" && <button className="tool-txt" onClick={onInspect} title="Look up words in this message">調べる</button>}
            {m.kind === "text" && <button className="tool-txt" onClick={() => navigator.clipboard?.writeText(m.body)}>コピー</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({ m, t, conv, mine }: { m: Message; t: string; conv: ConversationView; mine?: boolean }) {
  if (!mine) return <span className="meta"><time>{t}</time></span>;
  const read = m.read_by_npc_at != null && m.read_by_npc_at <= Date.now();
  const offline = m.reply_state === "pending" && m.reply_error?.startsWith("offline");
  return (
    <span className="meta">
      {m.reply_state === "failed" && <span className="m-fail" title={m.reply_error ?? ""}>!</span>}
      {offline && <span className="m-wait">接続待ち</span>}
      {read && conv.kind !== "memo" && <span className="m-read">既読{conv.kind === "group" ? "" : ""}</span>}
      <time>{t}</time>
    </span>
  );
}

// ---------------- composer ----------------

function Composer({ conv, onSent }: { conv: ConversationView; onSent: (m: Message) => void }) {
  const { stickers, sticker, refresh } = usePhone();
  const [text, setText] = useState(conv.draft ?? "");
  const [panel, setPanel] = useState<null | "stickers" | "emoji">(null);
  const [hint, setHint] = useState<{ loading: boolean; text?: string; error?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const composing = useRef(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const draftTimer = useRef<number>();

  // Persist drafts (debounced) so nothing is lost when leaving the chat.
  const saveDraft = (v: string) => {
    window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => social.draft(conv.id, v).catch(() => {}), 400);
  };
  useEffect(() => () => window.clearTimeout(draftTimer.current), []);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(120, el.scrollHeight) + "px";
  }, [text]);

  const send = async (kind: "text" | "sticker", body: string, stickerId: string | null = null) => {
    setErr(null);
    try {
      const m = await social.send({ conversation_id: conv.id, kind, body, sticker_id: stickerId });
      onSent(m);
      if (kind === "text") {
        setText("");
        window.clearTimeout(draftTimer.current);
        setHint(null);
      } else refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const onKey = (e: RKE<HTMLTextAreaElement>) => {
    // Never send while the IME is composing (Enter confirms kana→kanji conversion).
    if (e.key === "Enter" && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (text.trim()) send("text", text.trim());
    }
    if (e.key === "Escape" && panel) {
      e.preventDefault();
      setPanel(null);
    }
  };

  const insert = (s: string) => {
    const el = ta.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const v = text.slice(0, start) + s + text.slice(end);
    setText(v);
    saveDraft(v);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + s.length, start + s.length);
    });
  };

  const askHint = () => {
    setHint({ loading: true });
    social.hint(conv.id).then((t) => setHint({ loading: false, text: t })).catch((e: Error) => setHint({ loading: false, error: e.message }));
  };

  return (
    <div className="composer-wrap">
      {hint && (
        <div className="hint-card" role="status">
          <span className="hint-label">💡 ヒント</span>
          <span>{hint.loading ? "考え中…" : hint.error ?? hint.text}</span>
          <button className="ph-x" onClick={() => setHint(null)} aria-label="Dismiss hint">×</button>
        </div>
      )}
      {err && <div className="inline-note bad">{err}</div>}
      <div className="composer">
        <button className={`ph-icon${panel ? " on" : ""}`} onClick={() => setPanel(panel ? null : "stickers")} aria-label="Stickers and emoji" aria-expanded={!!panel}>☺</button>
        <textarea
          ref={ta}
          value={text}
          rows={1}
          lang="ja"
          placeholder="メッセージを入力"
          aria-label="Message"
          onChange={(e) => { setText(e.target.value); saveDraft(e.target.value); }}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onKeyDown={onKey}
          onFocus={() => setPanel(null)}
          maxLength={2000}
        />
        {conv.kind !== "memo" && !text && <button className="ph-icon" onClick={askHint} aria-label="Hint" title="Stuck? Get a hint (uses AI, doesn't write the message for you)">💡</button>}
        <button className="send-btn" disabled={!text.trim()} onClick={() => send("text", text.trim())} aria-label="Send">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8z" fill="currentColor" /></svg>
        </button>
      </div>
      {panel && stickers && (
        <Picker panel={panel} setPanel={setPanel} onSticker={(id) => { send("sticker", sticker(id)?.caption ?? "", id); }} onText={insert} />
      )}
    </div>
  );
}

function Picker({ panel, setPanel, onSticker, onText }: { panel: "stickers" | "emoji"; setPanel: (p: null | "stickers" | "emoji") => void; onSticker: (id: string) => void; onText: (s: string) => void }) {
  const { stickers, sticker } = usePhone();
  const owned = stickers!.packs.filter((p) => stickers!.state.owned.includes(p.id));
  const [tab, setTab] = useState<string>(stickers!.state.recent.length ? "recent" : owned[0]?.id ?? "emoji");
  const [favs, setFavs] = useState(stickers!.state.favorites);
  const close = useCallback(() => setPanel(null), [setPanel]);
  useEscape(close);
  const ids = tab === "recent" ? stickers!.state.recent : tab === "fav" ? favs : owned.find((p) => p.id === tab)?.stickers.map((s) => s.id) ?? [];
  const toggleFav = (id: string) => {
    const on = !favs.includes(id);
    setFavs(on ? [...favs, id] : favs.filter((x) => x !== id));
    social.stickerFavorite(id, on).catch(() => {});
  };
  return (
    <div className="picker" data-esc-layer>
      <div className="picker-tabs" role="tablist">
        <button role="tab" className={panel === "stickers" && tab === "recent" ? "on" : ""} onClick={() => { setPanel("stickers"); setTab("recent"); }} title="Recent">🕘</button>
        <button role="tab" className={panel === "stickers" && tab === "fav" ? "on" : ""} onClick={() => { setPanel("stickers"); setTab("fav"); }} title="Favorites">★</button>
        {owned.map((p) => (
          <button key={p.id} role="tab" className={panel === "stickers" && tab === p.id ? "on" : ""} onClick={() => { setPanel("stickers"); setTab(p.id); }} title={p.name}>
            <StickerArt {...p.stickers[0]!} size={26} />
          </button>
        ))}
        <button role="tab" className={panel === "emoji" && tab === "emoji" ? "on" : ""} onClick={() => { setPanel("emoji"); setTab("emoji"); }} title="Emoji">😀</button>
        <button role="tab" className={panel === "emoji" && tab === "kao" ? "on" : ""} onClick={() => { setPanel("emoji"); setTab("kao"); }} title="Kaomoji">(^^)</button>
      </div>
      <div className="picker-body">
        {panel === "stickers" && (
          <div className="sticker-grid">
            {ids.length === 0 && <p className="ph-empty">{tab === "fav" ? "Right-click a sticker to favorite it." : "No recent stickers yet."}</p>}
            {ids.map((id) => {
              const s = sticker(id);
              if (!s) return null;
              return (
                <button key={id} className="sticker-pick" onClick={() => onSticker(id)} onContextMenu={(e) => { e.preventDefault(); toggleFav(id); }} title={`${s.caption} — ${s.meaning}${favs.includes(id) ? " ★" : ""}`}>
                  <StickerArt {...s} size={76} />
                  {favs.includes(id) && <span className="fav-star">★</span>}
                </button>
              );
            })}
          </div>
        )}
        {panel === "emoji" && tab === "emoji" && EMOJI.map((g) => (
          <div key={g.label} className="emoji-group">
            <span className="faint">{g.label}</span>
            <div className="emoji-grid">{g.items.map((e) => <button key={e} onClick={() => onText(e)}>{e}</button>)}</div>
          </div>
        ))}
        {panel === "emoji" && tab === "kao" && (
          <div className="kao-grid">{KAOMOJI.map((k) => <button key={k} onClick={() => onText(k)}>{k}</button>)}</div>
        )}
      </div>
    </div>
  );
}

// ---------------- word inspection (on demand) ----------------

const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

function Inspect({ m, onClose }: { m: Message; onClose: () => void }) {
  const [tokens, setTokens] = useState<{ surface: string; basic: string; reading: string; pos: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gloss, setGloss] = useState<Record<string, string>>({});
  useEffect(() => {
    tokenize(m.body)
      .then((t) => setTokens(t.filter((x) => !/^(記号|補助記号)$/.test(x.pos) && x.surface.trim()).map((x) => ({ surface: x.surface, basic: x.basic === "*" ? x.surface : x.basic, reading: x.reading ? toHira(x.reading) : "", pos: x.pos }))))
      .catch((e: Error) => setErr(e.message));
  }, [m.body]);
  useEscape(onClose);
  const explain = (w: string) => {
    setGloss((g) => ({ ...g, [w]: "…" }));
    social.gloss(w, m.body).then((t) => setGloss((g) => ({ ...g, [w]: t }))).catch((e: Error) => setGloss((g) => ({ ...g, [w]: e.message })));
  };
  const posJa: Record<string, string> = { 名詞: "noun", 動詞: "verb", 形容詞: "adj", 副詞: "adv", 助詞: "particle", 助動詞: "aux", 感動詞: "interj", 接続詞: "conj", 連体詞: "adnominal" };
  const uniq = useMemo(() => tokens?.filter((t, i, a) => a.findIndex((x) => x.basic === t.basic) === i) ?? [], [tokens]);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-esc-layer>
      <div className="sheet" role="dialog" aria-label="Words in this message">
        <div className="sheet-grip" />
        <p className="inspect-src" lang="ja">{m.body}</p>
        {err && <p className="inline-note bad">{err}</p>}
        {!tokens && !err && <p className="ph-empty">辞書を読み込み中…</p>}
        <div className="word-list">
          {uniq.map((t) => (
            <div key={t.basic + t.surface} className="ph-word">
              <div className="word-main">
                <b lang="ja">{t.basic}</b>
                {t.reading && t.reading !== t.basic && <span lang="ja">{t.reading}</span>}
                <em>{posJa[t.pos] ?? t.pos}</em>
                <span className="spacer" />
                {!gloss[t.basic] && t.pos !== "助詞" && <button className="pill-btn small" onClick={() => explain(t.basic)}>意味</button>}
              </div>
              {gloss[t.basic] && <p className="ph-gloss">{gloss[t.basic]}</p>}
            </div>
          ))}
        </div>
        <p className="ph-hint">Readings come from the offline dictionary. "意味" asks the AI to explain the word in this sentence.</p>
        <button className="btn small" onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}
