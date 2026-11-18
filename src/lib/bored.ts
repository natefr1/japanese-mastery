// "I'm bored" picker: offers something genuinely different from what you were just doing.
import type { Route } from "./nav";

export interface BoredContext {
  dueNow: number;
  hasVoice: boolean;
  questsAvailable: string[];
  current?: string;
}

export interface Activity {
  key: string;
  label: string;
  route: Route;
}

export function activities(c: BoredContext): Activity[] {
  const list: Activity[] = [
    { key: "grammar", label: "3-minute grammar sprint", route: { page: "study", sub: "session", launch: { mode: "grammar", minutes: 3, only: "grammar" } } },
    { key: "kanji", label: "3-minute kanji sprint", route: { page: "study", sub: "session", launch: { mode: "kanji", minutes: 3, only: "kanji" } } },
    { key: "reader", label: "Check a manga page's coverage", route: { page: "study", sub: "reader" } },
  ];
  if (c.dueNow > 0) list.push({ key: "quick", label: "5-minute review burst", route: { page: "study", sub: "session", launch: { mode: "quick", minutes: 5 } } });
  if (c.hasVoice) list.push({ key: "listening", label: "Listening & shadowing", route: { page: "study", sub: "listening" } });
  for (const q of c.questsAvailable) list.push({ key: `quest:${q}`, label: "Play a 生活 scene", route: { page: "life", sub: "quest", questId: q } });
  return list.filter((a) => a.key !== c.current);
}

export function pickActivity(c: BoredContext, rand = Math.random): Activity {
  const list = activities(c);
  return list[Math.floor(rand() * list.length)]!;
}
