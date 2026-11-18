// Top-level phone tabs: ホーム (friends), トーク (chats), 通話 (calls), スタンプ (shop), and お知らせ.
import { useEffect, useMemo, useState } from "react";
import { social } from "../../../lib/social/api";
import type { CallLog, ConversationView, Notification, SearchHit } from "../../../lib/social/types";
import { GroupIcon, NpcAvatar, StickerArt } from "./art";
import { preview, timeLabel, useEscape, usePhone } from "./ctx";

export function ConvAvatar({ c, size = 48 }: { c: ConversationView; size?: number }) {
  const { npc } = usePhone();
  if (c.kind === "direct") {
    const id = c.members.find((m) => m !== "player") ?? "";
    return <NpcAvatar id={id} color={npc(id)?.color} size={size} />;
  }
  return <GroupIcon kind={c.kind === "memo" ? "memo" : c.avatar} size={size} />;
}

function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <header className="ph-head">
      <h2>{title}</h2>
      <span className="spacer" />
      {right}
    </header>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="ph-search">
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <button className="ph-x" onClick={() => onChange("")} aria-label="Clear">×</button>}
    </label>
  );
}

function Bell() {
  const { push } = usePhone();
  const [n, setN] = useState(0);
  useEffect(() => {
    social.notifications().then((l) => setN(l.filter((x) => !x.seen).length)).catch(() => {});
  }, []);
  return (
    <button className="ph-icon" onClick={() => push({ s: "notifications" })} aria-label="お知らせ" title="Notifications">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
      {n > 0 && <span className="dot-badge" />}
    </button>
  );
}

// ---------------- ホーム ----------------

export function HomeScreen() {
  const { npcs, chats, config, push } = usePhone();
  const [q, setQ] = useState("");
  const [openFriends, setOpenFriends] = useState(true);
  const [openGroups, setOpenGroups] = useState(true);
  const f = q.trim().toLowerCase();
  const friends = npcs.filter((n) => !f || [n.display, n.name, n.full_name].some((s) => s.toLowerCase().includes(f)));
  const groups = chats.filter((c) => c.kind === "group" && (!f || c.title.toLowerCase().includes(f)));
  return (
    <div className="ph-page">
      <Header title="ホーム" right={<Bell />} />
      <div className="ph-scroll">
        <SearchBox value={q} onChange={setQ} placeholder="検索" />
        <button className="me-card" onClick={() => push({ s: "settings" })}>
          <div className="me-avatar">{(config?.player.name ?? "?").slice(0, 1)}</div>
          <div className="me-text">
            <b>{config?.player.name ?? "…"}</b>
            <span>{config?.player.status_message || "ステータスメッセージを入力"}</span>
          </div>
        </button>
        <button className="sec-head" onClick={() => setOpenFriends((v) => !v)} aria-expanded={openFriends}>
          <span>友だち</span><span className="count">{friends.length}</span><span className="spacer" /><span className={`chev${openFriends ? " open" : ""}`}>⌄</span>
        </button>
        {openFriends && friends.map((n) => (
          <button key={n.id} className="row-item" onClick={() => push({ s: "profile", id: n.id })}>
            <span className="av-wrap"><NpcAvatar id={n.id} color={n.color} size={44} />{n.online_now && <span className="presence" title="Usually around at this time" />}</span>
            <span className="ri-text"><b>{n.display}</b><span>{n.busy_now ?? n.role}</span></span>
          </button>
        ))}
        <button className="sec-head" onClick={() => setOpenGroups((v) => !v)} aria-expanded={openGroups}>
          <span>グループ</span><span className="count">{groups.length}</span><span className="spacer" /><span className={`chev${openGroups ? " open" : ""}`}>⌄</span>
        </button>
        {openGroups && groups.map((c) => (
          <button key={c.id} className="row-item" onClick={() => push({ s: "chat", id: c.id })}>
            <ConvAvatar c={c} size={44} />
            <span className="ri-text"><b>{c.title}</b><span>{c.members.filter((m) => m !== "player").map((m) => npcs.find((n) => n.id === m)?.display ?? m).join("、")}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- トーク ----------------

export function ChatsScreen() {
  const { chats, npcs, sticker, push, ai } = usePhone();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [archived, setArchived] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const name = (id: string) => npcs.find((n) => n.id === id)?.display ?? id;

  useEffect(() => {
    if (q.trim().length < 1) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => social.search(q).then(setHits).catch(() => setHits([])), 220);
    return () => clearTimeout(t);
  }, [q]);

  const list = useMemo(() => chats.filter((c) => c.archived === archived), [chats, archived]);
  const archivedCount = chats.filter((c) => c.archived).length;

  return (
    <div className="ph-page">
      <Header title={archived ? "非表示のトーク" : "トーク"} right={archived ? <button className="ph-link" onClick={() => setArchived(false)}>戻る</button> : undefined} />
      <div className="ph-scroll">
        <SearchBox value={q} onChange={setQ} placeholder="トーク・メッセージを検索" />
        {ai && !ai.ready && !archived && (
          <button className="setup-banner" onClick={() => push({ s: "settings" })}>
            <b>Friends can't reply yet</b>
            <span>Replies are written by an AI you connect. Set it up in 設定 → AI.</span>
          </button>
        )}
        {hits ? (
          <div className="hits">
            {hits.length === 0 && <p className="ph-empty">見つかりませんでした</p>}
            {hits.map((h) => (
              <button key={h.message.id} className="row-item" onClick={() => push({ s: "chat", id: h.message.conversation_id })}>
                <span className="ri-text"><b>{h.conversation_title}</b><span>{h.message.body}</span></span>
                <time>{timeLabel(h.message.deliver_at)}</time>
              </button>
            ))}
          </div>
        ) : (
          <>
            {list.map((c) => (
              <div key={c.id} className="chat-row-wrap">
                <button className={`chat-row${c.unread ? " unread" : ""}`} onClick={() => push({ s: "chat", id: c.id })}
                  onContextMenu={(e) => { e.preventDefault(); setMenu(menu === c.id ? null : c.id); }}>
                  <ConvAvatar c={c} />
                  <span className="cr-text">
                    <span className="cr-top">
                      <b>{c.title}</b>
                      {c.kind === "group" && <span className="cr-n">({c.members.length})</span>}
                      {c.muted && <span className="cr-ico" title="Muted">🔕</span>}
                      {c.pinned && <span className="cr-ico" title="Pinned">📌</span>}
                    </span>
                    <span className={`cr-prev${c.typing.length ? " typing" : ""}`}>{preview(c, name, (id) => sticker(id)?.caption)}</span>
                  </span>
                  <span className="cr-side">
                    <time>{c.last_message ? timeLabel(c.last_message.deliver_at) : ""}</time>
                    {c.unread > 0 && <span className={`ph-badge${c.muted ? " muted" : ""}`}>{c.unread > 99 ? "99+" : c.unread}</span>}
                  </span>
                </button>
                <button className="cr-more" aria-label={`Options for ${c.title}`} onClick={() => setMenu(menu === c.id ? null : c.id)}>⋯</button>
                {menu === c.id && <ChatMenu c={c} onDone={() => setMenu(null)} />}
              </div>
            ))}
            {list.length === 0 && <p className="ph-empty">{archived ? "非表示のトークはありません" : "トークはまだありません"}</p>}
            {!archived && archivedCount > 0 && <button className="ph-link center" onClick={() => setArchived(true)}>非表示のトーク ({archivedCount})</button>}
          </>
        )}
      </div>
    </div>
  );
}

function ChatMenu({ c, onDone }: { c: ConversationView; onDone: () => void }) {
  const act = (flag: "pinned" | "muted" | "archived", on: boolean) => social.flag(c.id, flag, on).finally(onDone);
  useEscape(onDone);
  return (
    <div className="pop-menu" role="menu">
      <button role="menuitem" onClick={() => act("pinned", !c.pinned)}>{c.pinned ? "ピン留めを解除" : "ピン留め"}</button>
      <button role="menuitem" onClick={() => act("muted", !c.muted)}>{c.muted ? "通知をオン" : "通知をオフ"}</button>
      <button role="menuitem" onClick={() => act("archived", !c.archived)}>{c.archived ? "表示する" : "非表示"}</button>
      {c.unread > 0 && <button role="menuitem" onClick={() => social.markRead(c.id).finally(onDone)}>既読にする</button>}
      <button role="menuitem" className="muted-item" onClick={onDone}>キャンセル</button>
    </div>
  );
}

// ---------------- 通話 ----------------

export function CallsScreen() {
  const { npcs } = usePhone();
  const [log, setLog] = useState<CallLog[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const load = () => social.calls().then(setLog).catch(() => {});
  useEffect(() => { load(); }, []);
  const attempt = (id: string, kind: "voice" | "video") => social.callAttempt(id, kind).then((m) => { setNotice(m); load(); });
  const statusLabel = (s: string) => ({ unavailable: "利用不可", missed: "不在着信", completed: "通話" }[s] ?? s);
  return (
    <div className="ph-page">
      <Header title="通話" />
      <div className="ph-scroll">
        <div className="calls-note">
          <b>Calls aren't available in this version.</b>
          <span>Voice calls need a speech-to-text and voice provider. Until one is added, tapping call logs an honest "unavailable" attempt — no call is ever faked.</span>
        </div>
        {notice && <div className="inline-note" role="status">{notice}</div>}
        <div className="sec-head static"><span>友だち</span></div>
        {npcs.map((n) => (
          <div key={n.id} className="row-item static">
            <NpcAvatar id={n.id} color={n.color} size={40} />
            <span className="ri-text"><b>{n.display}</b></span>
            <button className="ph-icon" onClick={() => attempt(n.id, "voice")} aria-label={`Voice call ${n.display}`} title="Voice call (unavailable)">📞</button>
            <button className="ph-icon" onClick={() => attempt(n.id, "video")} aria-label={`Video call ${n.display}`} title="Video call (unavailable)">🎥</button>
          </div>
        ))}
        <div className="sec-head static"><span>履歴</span></div>
        {log.length === 0 && <p className="ph-empty">通話履歴はありません</p>}
        {log.map((c) => (
          <div key={c.id} className="row-item static">
            <NpcAvatar id={c.character_id} color={npcs.find((n) => n.id === c.character_id)?.color} size={36} />
            <span className="ri-text"><b>{npcs.find((n) => n.id === c.character_id)?.display ?? c.character_id}</b><span>{c.kind === "video" ? "ビデオ" : "音声"} · {statusLabel(c.status)}</span></span>
            <time>{timeLabel(c.created_at)}</time>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- スタンプ ----------------

export function StickerShop() {
  const { stickers, refresh } = usePhone();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!stickers) return <div className="ph-page"><Header title="スタンプ" /></div>;
  const buy = (id: string) => {
    setBusy(id);
    setErr(null);
    social.stickerBuy(id).then(refresh).catch((e: Error) => setErr(e.message)).finally(() => setBusy(null));
  };
  return (
    <div className="ph-page">
      <Header title="スタンプ" />
      <div className="ph-scroll">
        <p className="ph-hint">Original sticker packs. Paid packs use the ¥ you earn in 生活 — never real money.</p>
        {err && <div className="inline-note bad" role="alert">{err}</div>}
        {stickers.packs.map((p) => {
          const owned = stickers.state.owned.includes(p.id);
          return (
            <section key={p.id} className="pack">
              <div className="pack-head">
                <b>{p.name}</b>
                <span className="spacer" />
                {owned ? <span className="owned">所持済み</span> : (
                  <button className="pill-btn" disabled={busy === p.id} onClick={() => buy(p.id)}>{p.price_yen === 0 ? "無料" : `¥${p.price_yen}`}で入手</button>
                )}
              </div>
              <div className="pack-grid">
                {p.stickers.slice(0, owned ? 12 : 8).map((s) => <StickerArt key={s.id} {...s} size={64} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- お知らせ ----------------

export function NotificationsScreen() {
  const { back, push } = usePhone();
  const [list, setList] = useState<Notification[] | null>(null);
  useEffect(() => {
    social.notifications().then((l) => { setList(l); social.notificationsSeen().catch(() => {}); }).catch(() => setList([]));
  }, []);
  return (
    <div className="ph-page">
      <header className="ph-head"><button className="ph-back" onClick={back} aria-label="Back">‹</button><h2>お知らせ</h2></header>
      <div className="ph-scroll">
        {list?.length === 0 && <p className="ph-empty">お知らせはありません</p>}
        {list?.map((n) => (
          <button key={n.id} className={`row-item${n.seen ? "" : " fresh"}`} onClick={() => n.conversation_id && push({ s: "chat", id: n.conversation_id })}>
            <span className="ri-text"><b>{n.title}</b><span>{n.body}</span></span>
            <time>{timeLabel(n.created_at)}</time>
          </button>
        ))}
      </div>
    </div>
  );
}
