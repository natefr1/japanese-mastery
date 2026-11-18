// Original, simple character portraits drawn in SVG (no external artwork).
import { characterById } from "../../lib/game/characters";

export function Avatar({ id, size = 44 }: { id: string; size?: number }) {
  if (id === "cashier") {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="32" fill="#2d6a4f" />
        <circle cx="32" cy="30" r="15" fill="#f2d3b3" />
        <path d="M15 27c2-12 32-12 34 0-6-5-28-5-34 0z" fill="#1d1d1d" />
        <rect x="16" y="46" width="32" height="18" rx="6" fill="#40916c" />
        <circle cx="26" cy="31" r="1.8" fill="#222" />
        <circle cx="38" cy="31" r="1.8" fill="#222" />
        <path d="M27 37q5 4 10 0" stroke="#a0522d" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  const c = characterById(id);
  const color = c?.color ?? "#888";
  const hair = c?.hair ?? "#333";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill={color} opacity="0.9" />
      <rect x="14" y="46" width="36" height="20" rx="10" fill={color} style={{ filter: "brightness(0.75)" }} />
      <circle cx="32" cy="30" r="15" fill="#f6dcc2" />
      {id === "mika" ? (
        <path d="M15 32c-2-18 36-18 34 0l-3 14c-1-10-2-16-3-18-8 4-18 3-24-2-1 6-2 12-4 20z" fill={hair} />
      ) : id === "ren" ? (
        <path d="M16 27c1-13 31-14 32 0-8-3-12-6-14-3-4-2-10 0-18 3z" fill={hair} />
      ) : (
        <path d="M15 28c0-14 34-16 34-1l-4-4-3 4-4-5-4 5-5-5-4 5-3-4z" fill={hair} />
      )}
      <circle cx="26" cy="31" r="2" fill="#222" />
      <circle cx="38" cy="31" r="2" fill="#222" />
      {id === "ren" && <path d="M21 31h10M33 31h10M31 31h2" stroke="#222" strokeWidth="1.5" fill="none" />}
      <path d={id === "haruto" ? "M26 38q6 5 12 0" : "M28 38q4 3 8 0"} stroke="#b0573f" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
