import { createContext, useContext } from "react";

export type Page = "home" | "study" | "life" | "vocab" | "data" | "settings";
export type StudySub = "dashboard" | "session" | "grammar" | "kanji" | "listening" | "stats" | "reader";
export type LifeSub = "map" | "quest";

export interface SessionLaunch {
  mode: "quick" | "standard" | "deep" | "custom" | "grammar" | "kanji" | "placement" | "weak";
  minutes: number;
  only?: "vocab" | "grammar" | "kanji";
  /** Fixed card ids (placement check, weak-item drills). */
  cardIds?: string[];
}

export interface Route {
  page: Page;
  sub?: StudySub | LifeSub;
  launch?: SessionLaunch;
  questId?: string;
  focusId?: string;
}

export interface Nav {
  route: Route;
  go: (r: Route) => void;
}

export const NavContext = createContext<Nav>({ route: { page: "home" }, go: () => {} });
export const useNav = () => useContext(NavContext);
