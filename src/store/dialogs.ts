import { create } from "zustand";
import type { HostKeyDecision, HostKeyPrompt } from "../types";
import { ipc } from "../lib/ipc";

export interface PasswordPromptRequest {
  kind: "password" | "keyPassphrase";
  host: string;
  resolve: (value: string | null) => void;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  danger?: boolean;
  resolve: (accepted: boolean) => void;
}

export interface UpdateState {
  version: string;
  notes?: string;
  downloading: boolean;
  progress?: number;
}

interface DialogsStore {
  hostKey: HostKeyPrompt | null;
  passwordPrompt: PasswordPromptRequest | null;
  confirm: ConfirmRequest | null;
  update: UpdateState | null;
  updateStatus: string | null;

  showHostKey: (prompt: HostKeyPrompt) => void;
  answerHostKey: (decision: HostKeyDecision) => void;
  dismissHostKey: () => void;

  requestPassword: (kind: "password" | "keyPassphrase", host: string) => Promise<string | null>;
  requestConfirm: (title: string, message: string, danger?: boolean) => Promise<boolean>;
  closePasswordPrompt: (value: string | null) => void;
  closeConfirm: (accepted: boolean) => void;

  showUpdate: (version: string, notes?: string) => void;
  hideUpdate: () => void;
  setUpdating: (downloading: boolean) => void;
  setUpdateStatus: (status: string | null) => void;
}

export const useDialogs = create<DialogsStore>((set, get) => ({
  hostKey: null,
  passwordPrompt: null,
  confirm: null,
  update: null,
  updateStatus: null,

  showHostKey: (prompt) => set({ hostKey: prompt }),

  answerHostKey: (decision) => {
    const prompt = get().hostKey;
    set({ hostKey: null });
    if (prompt) void ipc.hostKeyRespond(prompt.ticket, decision);
  },

  dismissHostKey: () => {
    const prompt = get().hostKey;
    set({ hostKey: null });
    if (prompt) void ipc.hostKeyRespond(prompt.ticket, "reject");
  },

  requestPassword: (kind, host) =>
    new Promise((resolve) => {
      set({ passwordPrompt: { kind, host, resolve } });
    }),

  requestConfirm: (title, message, danger = false) =>
    new Promise((resolve) => {
      set({ confirm: { title, message, danger, resolve } });
    }),

  closePasswordPrompt: (value) => {
    const prompt = get().passwordPrompt;
    set({ passwordPrompt: null });
    prompt?.resolve(value);
  },

  closeConfirm: (accepted) => {
    const confirm = get().confirm;
    set({ confirm: null });
    confirm?.resolve(accepted);
  },

  showUpdate: (version, notes) => set({ update: { version, notes, downloading: false } }),
  hideUpdate: () => set({ update: null }),
  setUpdating: (downloading) =>
    set((s) => ({ update: s.update ? { ...s.update, downloading } : s.update })),
  setUpdateStatus: (status) => set({ updateStatus: status }),
}));
