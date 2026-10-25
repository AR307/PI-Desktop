import { create } from "zustand";
import { api } from "../../lib/api";

const KEY = "pi.desktop.codexImportHint";
let revision = 0;
type ImportUi = {
  enabled: boolean; ready: boolean; hiddenThisRun: boolean; open: boolean; dismissOpen: boolean; error: string | null;
  initialize: () => Promise<void>;
  show: () => void; close: () => void; dismiss: (permanent: boolean) => void;
  setEnabled: (enabled: boolean) => void;
};
function enabled(): boolean {
  try { return localStorage.getItem(KEY) !== "hidden"; } catch { return true; }
}
export const useCodexImport = create<ImportUi>((set) => ({
  enabled: enabled(), ready: false, hiddenThisRun: false, open: false, dismissOpen: false, error: null,
  initialize: async () => {
    const start = revision;
    try { const state = await api.codexImportHint(); if (revision === start) set({ hiddenThisRun: state.hidden, ready: true }); }
    catch (error) { set({ error: String(error), ready: true }); }
  },
  show: () => set({ open: true }), close: () => set({ open: false }),
  dismiss: (permanent) => {
    revision++;
    if (permanent) {
      try { localStorage.setItem(KEY, "hidden"); }
      catch (error) { set({ error: String(error) }); return; }
    }
    set({ ...(permanent ? { enabled: false } : { hiddenThisRun: true }), ready: true, dismissOpen: false, error: null });
    if (!permanent) void api.codexImportHint(true).catch((error: unknown) => set({ error: String(error), hiddenThisRun: false }));
  },
  setEnabled: (value) => {
    revision++;
    try { localStorage.setItem(KEY, value ? "visible" : "hidden"); }
    catch (error) { set({ error: String(error) }); return; }
    set({ enabled: value, hiddenThisRun: false, ready: true, error: null });
    void api.codexImportHint(false).catch((error: unknown) => set({ error: String(error) }));
  },
}));
