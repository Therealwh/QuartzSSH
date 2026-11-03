import { create } from "zustand";

export type ToastKind = "error" | "info" | "success";

export interface Toast {
  id: string;
  kind: ToastKind;
  text: string;
}

interface NotificationsStore {
  toasts: Toast[];
  push: (kind: ToastKind, text: string) => void;
  dismiss: (id: string) => void;
}

let counter = 0;

export const useNotifications = create<NotificationsStore>((set, get) => ({
  toasts: [],
  push: (kind, text) => {
    const id = `toast-${++counter}`;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismiss(id), 7000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
