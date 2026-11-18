// 2D exploration slice: walk the neighbourhood (WASD / arrows), bump into walls,
// and enter doors with E / Enter. Drawn on a canvas with original vector-style tiles.
// Position is saved to settings so you come back where you left off.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";

export type DoorId = "apartment" | "konbini" | "cafe" | "station" | "shops" | "park";
export interface Door { id: DoorId; x: number; y: number; label: string; jp: string; open: boolean }

// Legend: # wall/building, . ground, = road, ~ water, T tree, D door (see DOORS), b bench
const MAP = [
  "###########################",
  "#AAAAAAA..T....KKKKKKKK..T#",
  "#AAAAAAA.......KKKKKKKK...#",
  "#AAAAAAA..b....KKKKKKKK...#",
  "#AAAAAAA.......KKKKKKKK.T.#",
  "#...D..............D......#",
  "#=========================#",
  "#=========================#",
  "#..T.......T.......T......#",
  "#CCCCCC..SSSSSS..HHHHHHH..#",
  "#CCCCCC..SSSSSS..HHHHHHH.T#",
  "#CCCCCC..SSSSSS..HHHHHHH..#",
  "#..D.......D........D.....#",
  "#....T........~~~~....T...#",
  "#.......b.....~~~~...b....#",
  "###########################",
];
export const TILE = 32;
const W = MAP[0]!.length;
const H = MAP.length;

export const DOORS: Door[] = [
  { id: "apartment", x: 4, y: 5, label: "My apartment", jp: "アパート", open: true },
  { id: "konbini", x: 19, y: 5, label: "Konbini", jp: "コンビニ", open: true },
  { id: "cafe", x: 3, y: 12, label: "Café", jp: "カフェ", open: false },
  { id: "station", x: 11, y: 12, label: "Station", jp: "駅", open: false },
  { id: "shops", x: 20, y: 12, label: "Shopping street", jp: "商店街", open: false },
];

const BUILDING: Record<string, { fill: string; roof: string; name: string }> = {
  A: { fill: "#7b6cf0", roof: "#5141c9", name: "アパート" },
  K: { fill: "#2f8f6a", roof: "#1f6a4c", name: "コンビニ" },
  C: { fill: "#c08a7a", roof: "#9a6152", name: "カフェ" },
  S: { fill: "#4f86b0", roof: "#336389", name: "駅" },
  H: { fill: "#e0794f", roof: "#b9552f", name: "商店街" },
};

const tileAt = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? "#" : MAP[y]![x]!);
export const solid = (t: string) => t === "#" || t === "T" || t === "~" || t === "b" || t in BUILDING;
export function blocked(px: number, py: number): boolean {
  // Player hitbox: 18×14 at the feet.
  const pts = [[px - 9, py - 4], [px + 9, py - 4], [px - 9, py + 10], [px + 9, py + 10]] as const;
  return pts.some(([x, y]) => solid(tileAt(Math.floor(x / TILE), Math.floor(y / TILE))));
}
export function nearDoor(px: number, py: number): Door | undefined {
  return DOORS.find((d) => Math.hypot(px - (d.x * TILE + TILE / 2), py - (d.y * TILE + TILE / 2)) < TILE * 0.95);
}

const START = { x: 4 * TILE + 16, y: 5 * TILE + 26 };
const POS_KEY = "world.position";

export default function Explore({ onEnter, paused }: { onEnter: (d: Door) => void; paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pos = useRef({ ...START, dir: 0, step: 0 });
  const keys = useRef(new Set<string>());
  const [door, setDoor] = useState<Door | undefined>();
  const [msg, setMsg] = useState<string | null>(null);
  const saveT = useRef<number>();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    api.settingsGet().then((s) => {
      const p = s[POS_KEY] as { x: number; y: number } | undefined;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && !blocked(p.x, p.y)) Object.assign(pos.current, p);
    }).catch(() => {});
  }, []);

  const persist = () => {
    window.clearTimeout(saveT.current);
    saveT.current = window.setTimeout(() => api.settingsSet(POS_KEY, { x: Math.round(pos.current.x), y: Math.round(pos.current.y) }).catch(() => {}), 1200);
  };

  const enter = useCallback((d: Door | undefined) => {
    if (!d) return;
    if (!d.open) {
      setMsg(`${d.jp} — opens in a later update`);
      window.setTimeout(() => setMsg(null), 2200);
      return;
    }
    onEnter(d);
  }, [onEnter]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (pausedRef.current || (e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        e.preventDefault();
        keys.current.add(k);
      }
      if ((k === "e" || k === "enter") && !e.repeat) enter(nearDoor(pos.current.x, pos.current.y));
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [enter]);

  useEffect(() => {
    if (paused) keys.current.clear();
  }, [paused]);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * TILE * dpr;
    c.height = H * TILE * dpr;
    ctx.scale(dpr, dpr);
    const bg = prerender(dpr);
    let raf = 0;
    let last = performance.now();
    let lastDoor: Door | undefined;
    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const k = keys.current;
      let dx = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
      let dy = (k.has("s") || k.has("arrowdown") ? 1 : 0) - (k.has("w") || k.has("arrowup") ? 1 : 0);
      const p = pos.current;
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        dx /= len;
        dy /= len;
        const sp = 130 * dt;
        // Axis-separated movement lets you slide along walls.
        if (!blocked(p.x + dx * sp, p.y)) p.x += dx * sp;
        if (!blocked(p.x, p.y + dy * sp)) p.y += dy * sp;
        p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 0 : 2;
        p.step += dt * 9;
        persist();
      } else p.step = 0;
      const d = nearDoor(p.x, p.y);
      if (d !== lastDoor) {
        lastDoor = d;
        setDoor(d);
      }
      ctx.clearRect(0, 0, W * TILE, H * TILE);
      ctx.drawImage(bg, 0, 0, W * TILE, H * TILE);
      DOORS.forEach((dd) => drawDoorGlow(ctx, dd, dd === d, t));
      drawPlayer(ctx, p.x, p.y, p.dir, p.step);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="explore">
      <canvas ref={canvas} className="explore-canvas" style={{ aspectRatio: `${W} / ${H}` }} aria-label="Neighbourhood. Move with WASD or arrow keys, E to enter." role="img" />
      <div className="explore-hud" aria-live="polite">
        {msg ? <span className="explore-prompt locked">{msg}</span> : door ? (
          <button className={`explore-prompt${door.open ? "" : " locked"}`} onClick={() => enter(door)}>
            <kbd>E</kbd> {door.open ? `Enter ${door.jp}` : `${door.jp} (closed for now)`}
          </button>
        ) : <span className="explore-help"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>E</kbd> enter · <kbd>P</kbd> phone</span>}
      </div>
    </div>
  );
}

function prerender(dpr: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W * TILE * dpr;
  c.height = H * TILE * dpr;
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = tileAt(x, y);
    const px = x * TILE, py = y * TILE;
    g.fillStyle = (x + y) % 2 ? "#cfe3b5" : "#c8dead";
    g.fillRect(px, py, TILE, TILE);
    if (t === "=") {
      g.fillStyle = "#5f6673";
      g.fillRect(px, py, TILE, TILE);
      if (y === 6 && x % 3 === 0) { g.fillStyle = "#f2f2f2"; g.fillRect(px + 4, py + TILE - 3, 18, 3); }
    } else if (t === "#") {
      g.fillStyle = "#8a9a7a";
      g.fillRect(px, py, TILE, TILE);
      g.fillStyle = "#7a8a6b";
      g.fillRect(px, py + TILE - 6, TILE, 6);
    } else if (t === "~") {
      g.fillStyle = "#6fb8e0";
      g.fillRect(px, py, TILE, TILE);
      g.fillStyle = "rgba(255,255,255,.35)";
      g.fillRect(px + 6, py + 10, 12, 2);
    } else if (t === "T") {
      g.fillStyle = "rgba(0,0,0,.12)";
      g.beginPath(); g.ellipse(px + 16, py + 28, 12, 4, 0, 0, 7); g.fill();
      g.fillStyle = "#7a5233"; g.fillRect(px + 13, py + 18, 6, 10);
      g.fillStyle = "#3f8f4e"; g.beginPath(); g.arc(px + 16, py + 14, 12, 0, 7); g.fill();
      g.fillStyle = "#5bb06a"; g.beginPath(); g.arc(px + 12, py + 10, 5, 0, 7); g.fill();
    } else if (t === "b") {
      g.fillStyle = "#9c6b43"; g.fillRect(px + 4, py + 12, 24, 6); g.fillRect(px + 6, py + 18, 3, 8); g.fillRect(px + 23, py + 18, 3, 8);
    } else if (t === ".") {
      if ((x * 7 + y * 13) % 11 === 0) { g.fillStyle = "#b5d39a"; g.fillRect(px + 10, py + 12, 3, 3); }
    }
  }
  // Buildings: draw each block once with roof, windows and sign.
  const seen = new Set<string>();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = tileAt(x, y);
    if (!(t in BUILDING) || seen.has(t)) continue;
    seen.add(t);
    let x2 = x, y2 = y;
    while (tileAt(x2 + 1, y) === t) x2++;
    while (tileAt(x, y2 + 1) === t) y2++;
    const b = BUILDING[t]!;
    const bx = x * TILE, by = y * TILE, bw = (x2 - x + 1) * TILE, bh = (y2 - y + 1) * TILE;
    g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(bx + 5, by + 8, bw, bh);
    g.fillStyle = b.fill; roundRect(g, bx, by, bw, bh, 8); g.fill();
    g.fillStyle = b.roof; roundRect(g, bx, by, bw, 18, 8); g.fill();
    g.fillStyle = "rgba(255,255,255,.75)";
    for (let wx = bx + 14; wx < bx + bw - 24; wx += 34) for (let wy = by + 30; wy < by + bh - 26; wy += 30) { roundRect(g, wx, wy, 20, 14, 3); g.fill(); }
    g.fillStyle = "#fff"; g.font = "700 13px 'Noto Sans JP', sans-serif"; g.textAlign = "center";
    g.fillText(b.name, bx + bw / 2, by + 14);
  }
  return c;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawDoorGlow(g: CanvasRenderingContext2D, d: Door, near: boolean, t: number) {
  const cx = d.x * TILE + TILE / 2, cy = d.y * TILE + 6;
  g.fillStyle = d.open ? "#3b2a1e" : "#6b6b6b";
  roundRect(g, cx - 10, cy - 30, 20, 26, 4);
  g.fill();
  if (near) {
    const a = 0.35 + 0.25 * Math.sin(t / 220);
    g.strokeStyle = d.open ? `rgba(255,220,90,${a + 0.3})` : `rgba(200,200,200,${a})`;
    g.lineWidth = 3;
    roundRect(g, cx - 13, cy - 33, 26, 32, 6);
    g.stroke();
  }
}

function drawPlayer(g: CanvasRenderingContext2D, x: number, y: number, dir: number, step: number) {
  const bob = Math.sin(step) * 1.6;
  g.fillStyle = "rgba(0,0,0,.2)";
  g.beginPath(); g.ellipse(x, y + 11, 10, 4, 0, 0, 7); g.fill();
  const leg = Math.sin(step) * 3;
  g.fillStyle = "#2b2f3a";
  g.fillRect(x - 6, y + 2 + bob, 4, 8 + (dir % 2 === 0 ? leg : 0));
  g.fillRect(x + 2, y + 2 + bob, 4, 8 - (dir % 2 === 0 ? leg : 0));
  g.fillStyle = "#ff3d5a";
  roundRect(g, x - 9, y - 12 + bob, 18, 16, 6); g.fill();
  g.fillStyle = "#f4d6bd";
  g.beginPath(); g.arc(x, y - 18 + bob, 8, 0, 7); g.fill();
  g.fillStyle = "#23262f";
  g.beginPath(); g.arc(x, y - 21 + bob, 8.4, Math.PI, 0); g.fill();
  if (dir !== 2) {
    g.fillStyle = "#24242c";
    const ox = dir === 1 ? 2.5 : dir === 3 ? -2.5 : 0;
    g.fillRect(x - 3.5 + ox, y - 18 + bob, 2, 2.5);
    g.fillRect(x + 1.5 + ox, y - 18 + bob, 2, 2.5);
  }
}
