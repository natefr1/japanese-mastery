// Original vector art for the phone: character portraits, group icons, the app
// mark and the three sticker packs (もちもち / とらねこ / けろけろ). No third-party artwork.
import type { CSSProperties } from "react";

type Look = { skin: string; hair: string; style: "spiky" | "bob" | "long" | "side" | "messy" | "neat" | "pony" | "bun"; glasses?: boolean; acc?: "headphones" | "pin" | "earring" | "flower" };
const LOOKS: Record<string, Look> = {
  haruto: { skin: "#f4d6bd", hair: "#23262f", style: "spiky", acc: "headphones" },
  mika: { skin: "#f7dcc6", hair: "#7a4630", style: "long", acc: "pin" },
  ren: { skin: "#efd2b6", hair: "#1c2a24", style: "neat", glasses: true },
  yui: { skin: "#f6ddc9", hair: "#2f2433", style: "bob" },
  sota: { skin: "#eac7a6", hair: "#8a5a1e", style: "messy" },
  aoi: { skin: "#f3d8c0", hair: "#1f2b3a", style: "bun", glasses: true },
  natsuki: { skin: "#f0cfb0", hair: "#b23a26", style: "pony", acc: "earring" },
  chihiro: { skin: "#f2d4b8", hair: "#5a3b2a", style: "side", acc: "flower" },
};

function hairPath(style: Look["style"]): string {
  switch (style) {
    case "spiky": return "M15 29c-1-15 34-17 34-2l-4-5-3 5-4-6-4 6-5-6-4 6-4-5-3 4z";
    case "bob": return "M14 34c-3-20 39-20 36 0l-2 8c-1-8-2-13-4-15-7 3-17 3-24-1-1 5-2 10-4 16z";
    case "long": return "M14 33c-3-20 39-20 36 0l-2 18c-1-12-2-20-4-23-8 4-18 3-24-2-1 7-2 15-4 25z";
    case "side": return "M15 30c0-16 34-17 34 0-9-6-20-7-27 2-2 3-4 6-7 9z";
    case "messy": return "M15 29c-2-14 33-17 34-1l-5-3-2 4-5-5-3 4-5-4-3 4-5-3-2 4z";
    case "neat": return "M16 27c1-13 31-14 32 0-8-3-13-5-16-3-4-2-9 0-16 3z";
    case "pony": return "M15 30c-1-16 35-17 34 0-8-4-18-5-26-1-3 1-6 3-8 6zM46 22c8 2 10 12 6 20-1-6-3-10-7-13z";
    case "bun": return "M16 28c1-14 31-15 32 0-9-4-22-4-32 0zM32 6a7 7 0 1 1 0 14 7 7 0 1 1 0-14z";
  }
}

export function NpcAvatar({ id, color, size = 44, ring }: { id: string; color?: string; size?: number; ring?: boolean }) {
  const look = LOOKS[id];
  if (!look) return <GroupIcon kind={id} size={size} />;
  const bg = color ?? "#8892a6";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={ring ? "av ring" : "av"} style={{ "--av": bg } as CSSProperties}>
      <defs>
        <linearGradient id={`g-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={bg} />
          <stop offset="1" stopColor={bg} stopOpacity="0.65" />
        </linearGradient>
        <clipPath id={`c-${id}`}><circle cx="32" cy="32" r="32" /></clipPath>
      </defs>
      <g clipPath={`url(#c-${id})`}>
        <rect width="64" height="64" fill={`url(#g-${id})`} />
        <path d="M10 64c2-12 11-18 22-18s20 6 22 18z" fill="#fff" opacity="0.92" />
        <path d="M10 64c2-12 11-18 22-18s20 6 22 18z" fill={bg} opacity="0.35" />
        <rect x="27" y="40" width="10" height="8" rx="3" fill={look.skin} />
        <ellipse cx="32" cy="30" rx="14.5" ry="15.5" fill={look.skin} />
        <path d={hairPath(look.style)} fill={look.hair} />
        <ellipse cx="26.5" cy="32" rx="1.7" ry="2.1" fill="#24242c" />
        <ellipse cx="37.5" cy="32" rx="1.7" ry="2.1" fill="#24242c" />
        <ellipse cx="23.5" cy="36.5" rx="2.4" ry="1.3" fill="#ff8f8f" opacity="0.35" />
        <ellipse cx="40.5" cy="36.5" rx="2.4" ry="1.3" fill="#ff8f8f" opacity="0.35" />
        <path d="M28.5 38.5q3.5 2.6 7 0" stroke="#a85a48" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        {look.glasses && <g stroke="#2b2b33" strokeWidth="1.3" fill="none"><circle cx="26.5" cy="32" r="4.2" /><circle cx="37.5" cy="32" r="4.2" /><path d="M30.7 32h2.6" /></g>}
        {look.acc === "headphones" && <g fill="none" stroke="#1b1d24" strokeWidth="3"><path d="M15 30c0-12 34-12 34 0" /></g>}
        {look.acc === "headphones" && <g fill="#1b1d24"><rect x="12" y="28" width="6" height="10" rx="3" /><rect x="46" y="28" width="6" height="10" rx="3" /></g>}
        {look.acc === "pin" && <circle cx="44" cy="22" r="2.6" fill="#ffd166" />}
        {look.acc === "earring" && <circle cx="46.5" cy="38" r="1.6" fill="#ffd166" />}
        {look.acc === "flower" && <g transform="translate(43 20)"><circle r="3.2" fill="#ff9fb2" /><circle r="1.3" fill="#ffd166" /></g>}
      </g>
    </svg>
  );
}

export function GroupIcon({ kind, size = 44 }: { kind: string; size?: number }) {
  const cafe = kind === "cafe" || kind === "g-cafe";
  const memo = kind === "memo";
  const bg = memo ? "#8a94a8" : cafe ? "#c08457" : "#5b6cff";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="av">
      <rect width="64" height="64" rx="32" fill={bg} />
      {memo ? (
        <g fill="#fff"><rect x="20" y="16" width="24" height="32" rx="4" /><rect x="25" y="24" width="14" height="2.5" rx="1" fill={bg} /><rect x="25" y="30" width="14" height="2.5" rx="1" fill={bg} /><rect x="25" y="36" width="9" height="2.5" rx="1" fill={bg} /></g>
      ) : cafe ? (
        <g fill="#fff"><path d="M18 26h24v10a10 10 0 0 1-10 10h-4a10 10 0 0 1-10-10z" /><path d="M42 29h3a5 5 0 0 1 0 10h-3v-3h3a2 2 0 0 0 0-4h-3z" /><path d="M24 16c-2 3 2 4 0 7M31 15c-2 3 2 4 0 7" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" /></g>
      ) : (
        <g><rect x="14" y="22" width="36" height="22" rx="11" fill="#fff" /><path d="M23 29v8M19 33h8" stroke={bg} strokeWidth="3" strokeLinecap="round" /><circle cx="40" cy="30" r="2.4" fill={bg} /><circle cx="44" cy="35" r="2.4" fill={bg} /></g>
      )}
    </svg>
  );
}

/** App mark for ハナシ: an original folded-corner speech bubble with two dots. */
export function HanashiMark({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="url(#hm)" />
      <defs>
        <linearGradient id="hm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2fd8a6" /><stop offset="1" stopColor="#0b8f86" /></linearGradient>
      </defs>
      <path d="M14 28c0-8.8 8-15 18-15s18 6.2 18 15-8 15-18 15c-2.2 0-4.3-.3-6.2-.9L17 47l2.3-7.6C16 36.7 14 32.6 14 28z" fill="#fff" />
      <circle cx="26" cy="28" r="3" fill="#0e9a8b" />
      <circle cx="38" cy="28" r="3" fill="#0e9a8b" />
    </svg>
  );
}

// ---------------- stickers ----------------

function Face({ face, ink = "#2a2430" }: { face: string; ink?: string }) {
  const eyes = (() => {
    switch (face) {
      case "wink": return <g><circle cx="-9" cy="-3" r="3" fill={ink} /><path d="M5-3q4-4 8 0" stroke={ink} strokeWidth="2.6" fill="none" strokeLinecap="round" /></g>;
      case "laugh": case "joy": return <g stroke={ink} strokeWidth="2.6" fill="none" strokeLinecap="round"><path d="M-13-2q4-5 8 0" /><path d="M5-2q4-5 8 0" /></g>;
      case "sleep": case "tired": return <g stroke={ink} strokeWidth="2.6" fill="none" strokeLinecap="round"><path d="M-13-3q4 3 8 0" /><path d="M5-3q4 3 8 0" /></g>;
      case "shock": return <g fill={ink}><circle cx="-9" cy="-3" r="4" /><circle cx="9" cy="-3" r="4" /><circle cx="-8" cy="-4.5" r="1.3" fill="#fff" /><circle cx="10" cy="-4.5" r="1.3" fill="#fff" /></g>;
      case "cry": case "sad": return <g fill={ink}><ellipse cx="-9" cy="-2" rx="3" ry="3.5" /><ellipse cx="9" cy="-2" rx="3" ry="3.5" /><path d="M-15-9l6 2M15-9l-6 2" stroke={ink} strokeWidth="2" strokeLinecap="round" /></g>;
      case "love": return <g fill="#ff4f7a"><path d="M-9 1l-5-5a3 3 0 0 1 5-3 3 3 0 0 1 5 3z" /><path d="M9 1l-5-5a3 3 0 0 1 5-3 3 3 0 0 1 5 3z" /></g>;
      case "panic": return <g stroke={ink} strokeWidth="2.4" fill="none" strokeLinecap="round"><path d="M-13-6l7 4-7 4" /><path d="M13-6l-7 4 7 4" /></g>;
      case "determined": return <g><circle cx="-9" cy="-2" r="3" fill={ink} /><circle cx="9" cy="-2" r="3" fill={ink} /><path d="M-15-10l9 4M15-10l-9 4" stroke={ink} strokeWidth="2.6" strokeLinecap="round" /></g>;
      case "smug": return <g stroke={ink} strokeWidth="2.6" fill="none" strokeLinecap="round"><path d="M-13-2h8" /><path d="M5-2h8" /></g>;
      case "blank": return <g fill={ink}><circle cx="-9" cy="-2" r="2" /><circle cx="9" cy="-2" r="2" /></g>;
      case "angry": return <g><circle cx="-9" cy="-1" r="3" fill={ink} /><circle cx="9" cy="-1" r="3" fill={ink} /><path d="M-15-7l9 3M15-7l-9 3" stroke={ink} strokeWidth="2.6" strokeLinecap="round" /></g>;
      default: return <g fill={ink}><circle cx="-9" cy="-2" r="3" /><circle cx="9" cy="-2" r="3" /></g>;
    }
  })();
  const mouth = (() => {
    switch (face) {
      case "laugh": case "joy": return <path d="M-7 6q7 9 14 0z" fill="#d9475f" />;
      case "sad": case "cry": case "tired": return <path d="M-5 9q5-5 10 0" stroke={ink} strokeWidth="2.4" fill="none" strokeLinecap="round" />;
      case "shock": return <ellipse cx="0" cy="8" rx="3.5" ry="4.5" fill="#d9475f" />;
      case "sleep": return <ellipse cx="0" cy="7" rx="2" ry="1.6" fill={ink} />;
      case "smug": return <path d="M-6 6q8 4 12-2" stroke={ink} strokeWidth="2.4" fill="none" strokeLinecap="round" />;
      case "blank": return <path d="M-4 7h8" stroke={ink} strokeWidth="2.4" strokeLinecap="round" />;
      case "angry": return <path d="M-6 9q6-4 12 0" stroke={ink} strokeWidth="2.6" fill="none" strokeLinecap="round" />;
      case "panic": return <path d="M-7 8q2-3 4 0t4 0 4 0" stroke={ink} strokeWidth="2.2" fill="none" strokeLinecap="round" />;
      default: return <path d="M-6 5q6 6 12 0" stroke={ink} strokeWidth="2.6" fill="none" strokeLinecap="round" />;
    }
  })();
  return <g>{eyes}{mouth}{(face === "smile" || face === "joy" || face === "love" || face === "wink") && <g fill="#ff8fa3" opacity="0.55"><ellipse cx="-16" cy="4" rx="4" ry="2.4" /><ellipse cx="16" cy="4" rx="4" ry="2.4" /></g>}</g>;
}

function Prop({ prop }: { prop: string }) {
  switch (prop) {
    case "check": return <g transform="translate(36 -34)"><circle r="11" fill="#2fbf71" /><path d="M-5 0l3.5 4 7-8" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>;
    case "heart": return <path transform="translate(36 -36)" d="M0 9l-9-9a5.5 5.5 0 0 1 9-6 5.5 5.5 0 0 1 9 6z" fill="#ff4f7a" />;
    case "sweat": return <path transform="translate(30 -24)" d="M0-9c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12z" fill="#7cc8ff" />;
    case "moon": return <path transform="translate(34 -36)" d="M4-10a11 11 0 1 0 6 18 9 9 0 0 1-6-18z" fill="#ffd166" />;
    case "spark": return <g fill="#ffd166" transform="translate(36 -34)"><path d="M0-11l2.5 8.5L11 0l-8.5 2.5L0 11l-2.5-8.5L-11 0l8.5-2.5z" /><circle cx="-16" cy="12" r="2.5" /></g>;
    case "tear": return <path transform="translate(-24 8)" d="M0-6c3 5 4 7 4 9a4 4 0 0 1-8 0c0-2 1-4 4-9z" fill="#7cc8ff" />;
    case "fist": return <g transform="translate(36 -26)"><rect x="-9" y="-9" width="18" height="16" rx="6" fill="#ffe0c2" stroke="#2a2430" strokeWidth="2" /><path d="M-9-2h18M-3-9v7M3-9v7" stroke="#2a2430" strokeWidth="1.6" /></g>;
    case "question": return <text x="34" y="-24" fontSize="30" fontWeight="900" fill="#ff7a59" textAnchor="middle">?</text>;
    case "zzz": return <text x="32" y="-26" fontSize="16" fontWeight="900" fill="#8a7dff" textAnchor="middle">Zz</text>;
    case "thumb": return <g transform="translate(36 -28)"><rect x="-8" y="-2" width="16" height="13" rx="4" fill="#ffe0c2" stroke="#2a2430" strokeWidth="2" /><path d="M-3-2v-9a3 3 0 0 1 6 0v9" fill="#ffe0c2" stroke="#2a2430" strokeWidth="2" /></g>;
    case "vein": return <g transform="translate(30 -32)" stroke="#ff3d5a" strokeWidth="3" strokeLinecap="round"><path d="M-6-2l4 2-4 2M6-2l-4 2 4 2M-2-6l2 4 2-4M-2 6l2-4 2 4" /></g>;
    case "wave": return <g transform="translate(-38 -18) rotate(-18)"><rect x="-6" y="-12" width="12" height="20" rx="6" fill="#ffe0c2" stroke="#2a2430" strokeWidth="2" /><path d="M-12-14q-4 6 0 12M12-14q4 6 0 12" stroke="#2a2430" strokeWidth="1.6" fill="none" /></g>;
    case "note": return <g transform="translate(34 -32)" fill="#5b6cff"><ellipse cx="-4" cy="8" rx="5" ry="4" /><rect x="0" y="-12" width="3" height="20" /><path d="M3-12q8 2 7 10-2-5-7-5z" /></g>;
    case "pray": return <g transform="translate(0 30)"><path d="M-3-14l-6 16h18l-6-16a3 3 0 0 0-6 0z" fill="#ffe0c2" stroke="#2a2430" strokeWidth="2" /></g>;
    default: return null;
  }
}

function Body({ pack }: { pack: string }) {
  if (pack === "tora") {
    return (
      <g>
        <path d="M-34-20l6-26 18 16zM34-20l-6-26-18 16z" fill="#ffad5c" stroke="#2a2430" strokeWidth="2.5" strokeLinejoin="round" />
        <ellipse rx="38" ry="34" cy="2" fill="#ffad5c" stroke="#2a2430" strokeWidth="2.5" />
        <path d="M-10-30l4 8M0-32v9M10-30l-4 8" stroke="#c66a1e" strokeWidth="3" strokeLinecap="round" />
        <ellipse rx="16" ry="10" cy="12" fill="#fff4e6" />
        <path d="M-38 4h-10M-38 10h-9M38 4h10M38 10h9" stroke="#2a2430" strokeWidth="1.6" strokeLinecap="round" />
      </g>
    );
  }
  if (pack === "kaeru") {
    return (
      <g>
        <circle cx="-17" cy="-28" r="13" fill="#7bd66b" stroke="#2a2430" strokeWidth="2.5" />
        <circle cx="17" cy="-28" r="13" fill="#7bd66b" stroke="#2a2430" strokeWidth="2.5" />
        <ellipse rx="40" ry="30" cy="4" fill="#7bd66b" stroke="#2a2430" strokeWidth="2.5" />
        <ellipse rx="22" ry="12" cy="18" fill="#dff7c9" />
      </g>
    );
  }
  return (
    <g>
      <path d="M-40 18c-4-30 14-50 40-50s44 20 40 50c-2 14-18 20-40 20s-38-6-40-20z" fill="#fffaf3" stroke="#2a2430" strokeWidth="2.5" />
      <ellipse cx="-14" cy="-24" rx="8" ry="3" fill="#fff" opacity="0.9" />
    </g>
  );
}

export function StickerArt({ id, face, prop, caption, size = 120 }: { id: string; face: string; prop: string; caption: string; size?: number }) {
  const pack = id.split(".")[0] ?? "mochi";
  const faceY = pack === "kaeru" ? -26 : pack === "tora" ? -2 : 2;
  return (
    <svg width={size} height={size} viewBox="-60 -60 120 120" role="img" aria-label={caption} className="sticker-art">
      <ellipse cy="46" rx="34" ry="5" fill="#000" opacity="0.12" />
      <Body pack={pack} />
      {pack === "kaeru" ? (
        <g>
          <g transform="translate(-17 -28) scale(0.7)"><Face face={face} /></g>
          <g transform="translate(17 -28) scale(0.7)"><Face face={face} /></g>
          <path d="M-12 8q12 10 24 0" stroke="#2a2430" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        </g>
      ) : (
        <g transform={`translate(0 ${faceY})`}><Face face={face} /></g>
      )}
      <Prop prop={prop} />
      <text y="58" textAnchor="middle" fontSize="15" fontWeight="900" fill="#fff" stroke="#2a2430" strokeWidth="4" paintOrder="stroke" fontFamily="'Noto Sans JP', sans-serif">{caption}</text>
    </svg>
  );
}
