import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { DEFAULT_SETTINGS, type Settings } from "./types";

interface Ctx {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
}

const SettingsCtx = createContext<Ctx | null>(null);

function apply(s: Settings) {
  const root = document.documentElement;
  const dark = s.theme === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : s.theme === "dark";
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.motion = s.motion ? "on" : "off";
  root.style.fontSize = `${s.textScale}%`;
}

export function SettingsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    apply(settings);
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply(settings);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [settings]);

  useEffect(() => {
    if (!enabled) return;
    api.settingsGet()
      .then((raw) => setSettings((s) => ({ ...s, ...(raw as Partial<Settings>) })))
      .catch(() => { /* defaults stay */ });
  }, [enabled]);

  const update = useCallback(async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    await api.settingsSet(key, value);
  }, []);

  return <SettingsCtx.Provider value={{ settings, update }}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): Ctx {
  const c = useContext(SettingsCtx);
  if (!c) throw new Error("useSettings outside provider");
  return c;
}
