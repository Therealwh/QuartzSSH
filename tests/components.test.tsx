import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TransfersBar } from "../src/components/TransfersBar";
import { useTransfers } from "../src/store/transfers";
import { useDialogs } from "../src/store/dialogs";
import { PasswordDialog } from "../src/components/dialogs/PasswordDialog";
import type { TransferEvent } from "../src/types";

// Components under test must not touch the real IPC bridge.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  cleanup();
  useTransfers.setState({ transfers: {} });
  useDialogs.setState({ passwordPrompt: null, confirm: null, hostKey: null, update: null, updateStatus: null });
});

describe("TransfersBar", () => {
  it("renders nothing without transfers", () => {
    const { container } = render(<TransfersBar />);
    expect(container.firstChild).toBeNull();
  });

  it("shows progress and kind for an active transfer", () => {
    const event: TransferEvent = {
      id: "t1",
      kind: "upload",
      fileName: "notes.txt",
      transferred: 500,
      total: 1000,
      status: "active",
    };
    useTransfers.getState().apply(event);
    render(<TransfersBar />);
    expect(screen.getByText("notes.txt")).toBeTruthy();
    expect(screen.getByText("500 B / 1000 B")).toBeTruthy();
  });

  it("marks finished transfers with a checkmark and offers cleanup", () => {
    useTransfers.getState().apply({
      id: "t2",
      kind: "download",
      fileName: "dump.sql",
      transferred: 1000,
      total: 1000,
      status: "done",
    });
    render(<TransfersBar />);
    expect(screen.getByText("dump.sql")).toBeTruthy();
    expect(screen.getByText("✓")).toBeTruthy();
    expect(screen.getByText(/Очистить завершённые|Clear finished/i)).toBeTruthy();
  });
});

describe("PasswordDialog", () => {
  it("renders password prompt for the host and resolves on submit", async () => {
    const promise = useDialogs.getState().requestPassword("password", "example.com");
    render(<PasswordDialog />);
    expect(screen.getByText(/example.com/)).toBeTruthy();
    const input = screen.getByPlaceholderText(/Пароль/) as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: "hunter2" } });
    fireEvent.click(screen.getByText("Продолжить"));
    await expect(promise).resolves.toBe("hunter2");
  });

  it("does not render when no prompt is active", () => {
    const { container } = render(<PasswordDialog />);
    expect(container.firstChild).toBeNull();
  });
});
