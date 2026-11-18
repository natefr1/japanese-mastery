import { describe, expect, it } from "vitest";
import { initialNav, navReducer, phoneTop, visibleLayers, type NavAction, type WorldNav } from "./worldNav";

const run = (acts: NavAction[], s: WorldNav = initialNav) => acts.reduce(navReducer, s);

describe("生活 navigation", () => {
  it("closing the phone returns to the exact world underneath", () => {
    const s = run([{ t: "phone.open" }, { t: "phone.push", screen: { s: "chat", id: "dm-mika" } }, { t: "phone.close" }]);
    expect(s.scene).toEqual({ kind: "town" });
    expect(visibleLayers(s)).toEqual(["town"]);
  });

  it("reopening the phone restores where you were", () => {
    const s = run([{ t: "phone.open" }, { t: "phone.push", screen: { s: "chat", id: "dm-ren" } }, { t: "phone.close" }, { t: "phone.open" }]);
    expect(phoneTop(s)).toEqual({ s: "chat", id: "dm-ren" });
  });

  it("closing the phone during a quest keeps the quest", () => {
    const s = run([{ t: "quest.start", questId: "konbini-first-purchase" }, { t: "phone.open" }, { t: "phone.close" }]);
    expect(visibleLayers(s)).toEqual(["quest:konbini-first-purchase"]);
  });

  it("back walks the stack, then closes the phone; never leaves an empty stack", () => {
    let s = run([{ t: "phone.open" }, { t: "phone.push", screen: { s: "chat", id: "dm-a" } }, { t: "phone.push", screen: { s: "profile", id: "a" } }]);
    s = run([{ t: "phone.back" }, { t: "phone.back" }], s);
    expect(s.phone.open).toBe(true);
    expect(phoneTop(s)).toEqual({ s: "chats" });
    s = navReducer(s, { t: "phone.back" });
    expect(s.phone.open).toBe(false);
    expect(s.phone.stack.length).toBeGreaterThan(0);
  });

  it("escape closes the topmost layer only, never the scene", () => {
    let s = run([{ t: "panel.open", panel: "journal" }]);
    s = navReducer(s, { t: "escape" });
    expect(s.panel).toBeNull();
    s = run([{ t: "escape" }, { t: "escape" }], s);
    expect(visibleLayers(s)).toEqual(["town"]);
  });

  it("opening a chat from a notification lands on it with a sensible back target", () => {
    const s = run([{ t: "phone.open", screen: { s: "chat", id: "g-game" } }]);
    expect(phoneTop(s)).toEqual({ s: "chat", id: "g-game" });
    expect(phoneTop(navReducer(s, { t: "phone.back" }))).toEqual({ s: "chats" });
  });

  it("tabs reset the stack; duplicate pushes are ignored", () => {
    let s = run([{ t: "phone.open" }, { t: "phone.push", screen: { s: "chat", id: "x" } }, { t: "phone.push", screen: { s: "chat", id: "x" } }]);
    expect(s.phone.stack).toHaveLength(2);
    s = navReducer(s, { t: "phone.tab", tab: "calls" });
    expect(s.phone.stack).toEqual([{ s: "calls" }]);
  });

  it("random action sequences always leave something visible", () => {
    const acts: NavAction[] = [
      { t: "phone.open" }, { t: "phone.close" }, { t: "phone.back" }, { t: "escape" }, { t: "panel.open", panel: "calendar" },
      { t: "panel.close" }, { t: "quest.start", questId: "q" }, { t: "quest.end" }, { t: "phone.push", screen: { s: "chat", id: "c" } },
      { t: "phone.tab", tab: "home" },
    ];
    let seed = 7;
    let s = initialNav;
    for (let i = 0; i < 2000; i++) {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      s = navReducer(s, acts[seed % acts.length]!);
      expect(visibleLayers(s).length).toBeGreaterThan(0);
      expect(s.phone.stack.length).toBeGreaterThan(0);
    }
  });
});
