import { useEffect, useRef, useState } from "react";
import { api, isTauri } from "./lib/api";
import { SettingsProvider } from "./lib/settings";
import { AppDataProvider } from "./lib/appData";
import { NavContext, type Page, type Route } from "./lib/nav";
import type { AppStatus } from "./lib/types";
import { Icon, ToastProvider, useToast } from "./components/ui";
import { useSettings } from "./lib/settings";
import { checkForUpdate } from "./lib/updates";
import Home from "./pages/Home";
import Vocabulary from "./pages/Vocabulary";
import DataPage from "./pages/DataPage";
import SettingsPage from "./pages/SettingsPage";
import StudyCenter from "./pages/study/StudyCenter";
import Session from "./pages/study/Session";
import GrammarPage from "./pages/study/GrammarPage";
import KanjiPage from "./pages/study/KanjiPage";
import ListeningLab from "./pages/study/ListeningLab";
import StatsPage from "./pages/study/StatsPage";
import ReaderPage from "./pages/study/ReaderPage";
import Seikatsu from "./pages/life/Seikatsu";
import { ErrorBoundary } from "./components/ErrorBoundary";

const NAV: { route: Page; label: string; jp: string; icon: string; key: string }[] = [
  { route: "home", label: "Home", jp: "ホーム", icon: "home", key: "1" },
  { route: "study", label: "Study Center", jp: "学習", icon: "study", key: "2" },
  { route: "life", label: "生活", jp: "Seikatsu", icon: "life", key: "3" },
  { route: "vocab", label: "Vocabulary", jp: "単語", icon: "book", key: "4" },
  { route: "data", label: "Data & Backups", jp: "データ", icon: "database", key: "5" },
  { route: "settings", label: "Settings", jp: "設定", icon: "settings", key: "6" },
];

/** Quietly checks for an update once per launch (if enabled) and offers it in a toast. */
function UpdateNotifier({ onOpen }: { onOpen: () => void }) {
  const { settings } = useSettings();
  const { toast } = useToast();
  const auto = useRef(settings.autoUpdate);
  auto.current = settings.autoUpdate;
  useEffect(() => {
    // Wait a few seconds so stored settings are loaded and startup is never slowed.
    const t = setTimeout(() => {
      if (!auto.current) return;
      checkForUpdate().then((r) => {
        if (r.kind === "available") toast(`Version ${r.version} is available.`, { ms: 15000, action: { label: "View", run: onOpen } });
      });
    }, 5000);
    return () => clearTimeout(t);
    // Once per launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function StudyRoot({ route, go }: { route: Route; go: (r: Route) => void }) {
  switch (route.sub) {
    case "session":
      return route.launch ? <Session key={JSON.stringify(route.launch) + Date.now()} launch={route.launch} onExit={() => go({ page: "study" })} /> : <StudyCenter />;
    case "grammar":
      return <GrammarPage />;
    case "kanji":
      return <KanjiPage />;
    case "listening":
      return <ListeningLab />;
    case "stats":
      return <StatsPage />;
    case "reader":
      return <ReaderPage />;
    default:
      return <StudyCenter />;
  }
}

export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [route, setRouteState] = useState<Route>({ page: "home" });
  const [navKey, setNavKey] = useState(0);
  const setRoute = (r: Route) => {
    setRouteState(r);
    setNavKey((k) => k + 1);
  };

  const refreshStatus = () => api.status().then(setStatus).catch((e: Error) => setFatal(e.message));

  useEffect(() => {
    if (!isTauri()) {
      setFatal("This interface needs the desktop shell. Run `npm run tauri dev` instead of opening it in a browser.");
      return;
    }
    refreshStatus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const n = NAV.find((x) => x.key === e.key);
      if (n) {
        e.preventDefault();
        setRoute({ page: n.route });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (fatal || (status && !status.ok)) {
    return (
      <div className="center-screen">
        <div className="panel" style={{ maxWidth: 620 }}>
          <h2>Japanese Mastery couldn't open its data</h2>
          <p className="muted">{fatal ?? status?.error}</p>
          {status?.data_dir && (
            <p className="muted">
              Data folder: <span className="mono">{status.data_dir}</span>
              <br />
              Your database and backups are kept there. Nothing has been deleted.
            </p>
          )}
        </div>
      </div>
    );
  }
  if (!status) return <div className="center-screen faint">読み込み中…</div>;

  return (
    <SettingsProvider enabled={status.ok}>
      <ToastProvider>
      <AppDataProvider>
      <NavContext.Provider value={{ route, go: setRoute }}>
        <UpdateNotifier onOpen={() => setRoute({ page: "settings" })} />
        <div className={`shell${route.sub === "session" ? " focus-mode" : ""}`}>
          <nav className="sidebar" aria-label="Main">
            <div className="brand">
              <div className="brand-mark">学</div>
              <div className="brand-name">
                Japanese Mastery<small>日本語マスター</small>
              </div>
            </div>
            {NAV.map((n) => (
              <button
                key={n.route}
                className={`nav-item${route.page === n.route ? " active" : ""}`}
                onClick={() => setRoute({ page: n.route })}
                title={`${n.label} (Ctrl+${n.key})`}
                aria-current={route.page === n.route ? "page" : undefined}
              >
                <Icon name={n.icon} />
                <span>{n.label}</span>
                <span className="jp">{n.jp}</span>
              </button>
            ))}
            <div className="sidebar-foot">
              v{status.app_version} · schema v{status.schema_version}
              <br />
              Local-first · offline
            </div>
          </nav>
          <main className="main" key={route.page === "study" ? navKey : route.page}>
            <ErrorBoundary label={route.page} onReset={() => setRoute({ page: route.page })}>
            {route.page === "home" && <Home status={status} go={(p) => setRoute({ page: p })} />}
            {route.page === "study" && <StudyRoot route={route} go={setRoute} />}
            {route.page === "life" && <Seikatsu />}
            {route.page === "vocab" && <Vocabulary />}
            {route.page === "data" && <DataPage status={status} onRestored={refreshStatus} />}
            {route.page === "settings" && <SettingsPage status={status} />}
            </ErrorBoundary>
          </main>
        </div>
      </NavContext.Provider>
      </AppDataProvider>
      </ToastProvider>
    </SettingsProvider>
  );
}
