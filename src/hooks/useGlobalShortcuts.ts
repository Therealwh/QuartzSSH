import { useEffect } from "react";
import { useSessions } from "../store/sessions";
import { cycleTheme } from "../store/settings";

/**
 * Document-level shortcuts (section 25 of the spec): new tab, theme, split
 * view, broadcast input and SFTP for the active tab. Key presses consumed by
 * the focused terminal are marked with preventDefault there, so this handler
 * skips them via `defaultPrevented` and never acts twice.
 */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const sessions = useSessions.getState();
      // Ctrl+T (no Shift): duplicate the active terminal session in a new
      // tab. Inside a terminal the xterm handler consumes the key first.
      if (!e.shiftKey) {
        if (e.key.toLowerCase() === "t") {
          sessions.duplicateActiveSessionTab();
          e.preventDefault();
        }
        return;
      }
      switch (e.key.toLowerCase()) {
        case "t":
          cycleTheme();
          e.preventDefault();
          break;
        case "m":
          sessions.toggleSplitView();
          e.preventDefault();
          break;
        case "b":
          void sessions.toggleBroadcastMode();
          e.preventDefault();
          break;
        case "s": {
          const tab = sessions.tabs.find((item) => item.id === sessions.activeTabId);
          const profile = tab?.profileId
            ? sessions.profiles.find((p) => p.id === tab.profileId)
            : undefined;
          if (profile) {
            void sessions.openSftpForProfile(profile);
            e.preventDefault();
          }
          break;
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
