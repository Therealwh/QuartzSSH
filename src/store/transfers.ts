import { create } from "zustand";
import type { TransferEvent } from "../types";
import { ipc } from "../lib/ipc";

interface TransfersStore {
  transfers: Record<string, TransferEvent>;
  apply: (event: TransferEvent) => void;
  cancel: (id: string) => Promise<void>;
  clearFinished: () => void;
}

export const useTransfers = create<TransfersStore>((set, get) => ({
  transfers: {},
  apply: (event) =>
    set((s) => ({ transfers: { ...s.transfers, [event.id]: event } })),
  cancel: async (id) => {
    try {
      await ipc.transferCancel(id);
    } catch {
      // transfer may have finished already
    }
    const current = get().transfers[id];
    if (current) {
      set((s) => ({
        transfers: { ...s.transfers, [id]: { ...current, status: "cancelled" } },
      }));
    }
  },
  clearFinished: () =>
    set((s) => {
      const transfers = Object.fromEntries(
        Object.entries(s.transfers).filter(([, t]) => t.status === "active"),
      );
      return { transfers };
    }),
}));
