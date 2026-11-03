import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SettingsView } from "../src/components/panels/SettingsView";
import en from "../src/i18n/en.json";
import ru from "../src/i18n/ru.json";
import type { AppSettings } from "../src/types";

// Components under test must not touch the real IPC bridge.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);

const backend: AppSettings = {
  hostKeyMode: "strict",
  preferPqKex: true,
  autoReconnect: true,
  reconnectDelaySeconds: 5,
  checkUpdatesOnStart: true,
  updateCheckIntervalMinutes: 240,
  closeToTray: false,
  mcp: {
    enabled: false,
    port: 47215,
    allowlistProfileIds: [],
    confirmationMode: "destructive",
  },
};

const CATEGORY_IDS = [
  "appearance",
  "connections",
  "security",
  "mcp",
  "updates",
  "background",
  "about",
] as const;

function mockIpc() {
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "settings_get":
        return Promise.resolve(backend);
      case "known_hosts_list":
        return Promise.resolve([]);
      case "app_version":
        return Promise.resolve("0.0.0-test");
      case "mcp_status":
        return Promise.resolve({ running: false, port: 47215, hasToken: false });
      case "mcp_audit_list":
        return Promise.resolve([]);
      case "profile_list":
        return Promise.resolve([]);
      default:
        return Promise.resolve(null);
    }
  });
}

beforeEach(() => {
  cleanup();
  mockIpc();
});

describe("SettingsView categories", () => {
  it("defines label and description for every category in ru and en", () => {
    for (const resources of [ru, en]) {
      const categories = resources.settingsCategories as Record<
        string,
        { label?: string; description?: string }
      >;
      expect(Object.keys(categories).sort()).toEqual([...CATEGORY_IDS].sort());
      for (const id of CATEGORY_IDS) {
        expect(categories[id]?.label, `${id}.label`).toBeTruthy();
        expect(categories[id]?.description, `${id}.description`).toBeTruthy();
      }
    }
  });

  it("renders the category rail and shows only the active category", async () => {
    render(<SettingsView />);
    const label = (id: string) =>
      (ru.settingsCategories as Record<string, { label: string }>)[id].label;

    // The view loads backend settings asynchronously; wait for the rail.
    const rail = await screen.findByRole("navigation", { name: ru.settings.title });
    for (const id of CATEGORY_IDS) {
      expect(within(rail).getByText(label(id))).toBeTruthy();
    }
    const active = within(rail).getByText(label("appearance")).closest("button");
    expect(active?.getAttribute("aria-current")).toBe("true");

    // Appearance content is visible, other categories are not mounted.
    expect(await screen.findByText(ru.settings.theme)).toBeTruthy();
    expect(screen.queryByText(ru.settings.checkOnStart)).toBeNull();

    // Switching categories swaps the pane content.
    fireEvent.click(within(rail).getByText(label("updates")));
    expect(await screen.findByText(ru.settings.checkOnStart)).toBeTruthy();
    expect(screen.queryByText(ru.settings.theme)).toBeNull();
  });
});
