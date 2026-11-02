import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import type { Tab } from "../store/sessions";
import { useSessions } from "../store/sessions";
import { cycleTheme, useSettings } from "../store/settings";
import { getTheme, xtermThemeOf } from "../themes";
import { decodeUtf8Base64, encodeUtf8Base64 } from "../lib/base64";
import { ipc } from "../lib/ipc";
import { CloseIcon, SearchIcon } from "./icons";

interface SshDataPayload {
  sessionId: string;
  data: string;
}

/** Live session ids of every connected terminal tab. */
function connectedTerminalSessions(): string[] {
  const targets: string[] = [];
  for (const item of useSessions.getState().tabs) {
    if (item.kind === "terminal" && !item.disconnected && item.sessionId) {
      targets.push(item.sessionId);
    }
  }
  return targets;
}

export function TerminalPane({ tab }: { tab: Tab }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const termRef = useRef<any>(null);
  const fitRef = useRef<{ fit: () => void } | null>(null);
  const searchRef = useRef<{ findNext: (s: string, o?: object) => boolean; findPrevious: (s: string, o?: object) => boolean } | null>(null);
  const cleanupRef = useRef<Array<() => void>>([]);
  const [ready, setReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const fontFamily = useSettings((s) => s.fontFamily);
  const fontSize = useSettings((s) => s.fontSize);
  const themeId = useSettings((s) => s.themeId);
  const reconnectTab = useSessions((s) => s.reconnectTab);

  // Create the terminal once (xterm is code-split and loaded on demand).
  useEffect(() => {
    let disposed = false;
    let unlistenData: (() => void) | undefined;

    void (async () => {
      const [{ Terminal }, { FitAddon }, { SearchAddon }, { WebglAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-search"),
        import("@xterm/addon-webgl"),
      ]);
      if (disposed || !containerRef.current) return;

      // Load xterm's stylesheet before constructing the instance.
      await import("@xterm/xterm/css/xterm.css");

      const term = new Terminal({
        fontFamily,
        fontSize,
        theme: xtermThemeOf(getTheme(themeId)),
        scrollback: 5000,
        cursorBlink: true,
        allowProposedApi: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      const search = new SearchAddon();
      term.loadAddon(search);
      term.open(containerRef.current);
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // WebGL unavailable — canvas renderer is the fallback.
      }

      termRef.current = term;
      fitRef.current = fit;
      searchRef.current = search;
      setReady(true);

      // Output from the session.
      unlistenData = await listen<SshDataPayload>("ssh:data", (e) => {
        if (e.payload.sessionId === tab.sessionId) {
          term.write(decodeUtf8Base64(e.payload.data));
        }
      });

      // Input to the session; in broadcast mode every keystroke is mirrored
      // to all connected terminals (own session included). Only input is
      // broadcast — each session's output stays in its own pane.
      term.onData((data) => {
        const payload = encodeUtf8Base64(data);
        if (useSessions.getState().broadcastMode) {
          const targets = connectedTerminalSessions();
          if (targets.length > 1) {
            for (const sessionId of targets) void ipc.sshWrite(sessionId, payload);
            return;
          }
        }
        if (tab.sessionId) void ipc.sshWrite(tab.sessionId, payload);
      });

      // Keyboard shortcuts inside the terminal.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === "keydown") {
          if (e.ctrlKey && e.shiftKey && (e.key === "C" || e.key === "c")) {
            const sel = term.getSelection();
            if (sel) void navigator.clipboard.writeText(sel);
            return false;
          }
          if (e.ctrlKey && e.shiftKey && (e.key === "V" || e.key === "v")) {
            void navigator.clipboard.readText().then((text) => {
              if (tab.sessionId && text) void ipc.sshWrite(tab.sessionId, encodeUtf8Base64(text));
            });
            return false;
          }
          if (e.ctrlKey && !e.shiftKey && (e.key === "f" || e.key === "F")) {
            setSearchOpen(true);
            return false;
          }
          // preventDefault marks the event as consumed for the
          // document-level shortcut handler.
          if (e.ctrlKey && e.shiftKey && !e.altKey) {
            const key = e.key.toLowerCase();
            if (key === "m") {
              e.preventDefault();
              useSessions.getState().toggleSplitView();
              return false;
            }
            if (key === "b") {
              e.preventDefault();
              void useSessions.getState().toggleBroadcastMode();
              return false;
            }
            if (key === "t") {
              e.preventDefault();
              cycleTheme();
              return false;
            }
            if (key === "s") {
              e.preventDefault();
              const sessions = useSessions.getState();
              const active = sessions.tabs.find((item) => item.id === sessions.activeTabId);
              const profile = active?.profileId
                ? sessions.profiles.find((p) => p.id === active.profileId)
                : undefined;
              if (profile) void sessions.openSftpForProfile(profile);
              return false;
            }
          }
          if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "w" || e.key === "W")) {
            e.preventDefault();
            void useSessions.getState().closeTab(tab.id);
            return false;
          }
        }
        return true;
      });

      // Resize handling.
      const resizeObserver = new ResizeObserver(() => {
        try {
          fit.fit();
          if (tab.sessionId) void ipc.sshResize(tab.sessionId, term.cols, term.rows);
        } catch {
          // container not measurable yet
        }
      });
      resizeObserver.observe(containerRef.current);
      requestAnimationFrame(() => {
        try {
          fit.fit();
          if (tab.sessionId) void ipc.sshResize(tab.sessionId, term.cols, term.rows);
        } catch {
          // ignore
        }
      });

      cleanupRef.current.push(() => {
        unlistenData?.();
        resizeObserver.disconnect();
        term.dispose();
      });
    })();

    return () => {
      disposed = true;
      for (const fn of cleanupRef.current.splice(0)) fn();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.sessionId]);

  // Live theme updates.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermThemeOf(getTheme(themeId));
  }, [themeId]);

  // Live font updates.
  useEffect(() => {
    if (!termRef.current || !fitRef.current) return;
    termRef.current.options.fontFamily = fontFamily;
    termRef.current.options.fontSize = fontSize;
    try {
      fitRef.current.fit();
    } catch {
      // ignore
    }
  }, [fontFamily, fontSize]);

  // Close the search overlay with Escape.
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchOpen(false);
        searchRef.current?.findNext("");
        termRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchOpen]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const doSearch = (dir: "next" | "prev") => {
    if (!query) return;
    dir === "next"
      ? searchRef.current?.findNext(query)
      : searchRef.current?.findPrevious(query);
  };

  if (tab.disconnected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="text-sm text-[var(--q-muted)]">{t("terminal.disconnected")}</div>
        <button className="q-btn q-btn-primary" onClick={() => void reconnectTab(tab.id)}>
          {t("terminal.reconnect")}
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full px-2 py-1" onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }} />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--q-muted)]">
          {t("terminal.connecting", { host: tab.host ?? "" })}
        </div>
      )}

      {searchOpen && (
        <div className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-md border border-[var(--q-border)] bg-[var(--q-panel)] px-2 py-1 shadow-lg">
          <SearchIcon size={13} className="text-[var(--q-muted)]" />
          <input
            autoFocus
            className="w-40 bg-transparent px-1 text-xs outline-none"
            placeholder={t("terminal.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch(e.shiftKey ? "prev" : "next");
            }}
          />
          <label className="flex items-center gap-1 text-[10px] text-[var(--q-muted)]">
            <input
              type="checkbox"
              onChange={(e) => {
                // Re-run with/without case sensitivity.
                if (query) searchRef.current?.findNext(query, { caseSensitive: e.target.checked });
              }}
            />
            {t("terminal.matchCase")}
          </label>
          <button className="q-icon-btn" aria-label={t("terminal.prev")} onClick={() => doSearch("prev")}>↑</button>
          <button className="q-icon-btn" aria-label={t("terminal.next")} onClick={() => doSearch("next")}>↓</button>
          <button className="q-icon-btn" aria-label={t("terminal.close")} onClick={() => setSearchOpen(false)}>
            <CloseIcon size={12} />
          </button>
        </div>
      )}

      {menu && (
        <div className="q-menu" style={{ left: menu.x, top: menu.y }}>
          <button
            className="q-menu-item"
            onClick={() => {
              const sel: string = termRef.current?.getSelection?.() ?? "";
              if (sel) void navigator.clipboard.writeText(sel);
              setMenu(null);
            }}
          >
            {t("terminal.copy")}
          </button>
          <button
            className="q-menu-item"
            onClick={() => {
              void navigator.clipboard.readText().then((text) => {
                if (tab.sessionId && text) void ipc.sshWrite(tab.sessionId, encodeUtf8Base64(text));
              });
              setMenu(null);
            }}
          >
            {t("terminal.paste")}
          </button>
          <button
            className="q-menu-item"
            onClick={() => {
              termRef.current?.selectAll?.();
              setMenu(null);
            }}
          >
            {t("terminal.selectAll")}
          </button>
          <button
            className="q-menu-item"
            onClick={() => {
              termRef.current?.clear?.();
              setMenu(null);
            }}
          >
            {t("terminal.clear")}
          </button>
        </div>
      )}
    </div>
  );
}
