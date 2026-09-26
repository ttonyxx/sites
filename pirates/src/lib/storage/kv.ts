/**
 * Tiny key-value abstraction over localStorage. Everything persistent goes
 * through here, so swapping in a backend (Supabase etc.) later means writing
 * one new implementation instead of hunting for localStorage calls.
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
}

/** localStorage when available (private mode / SSR fall back to memory). */
export function browserStore(): KeyValueStore {
  try {
    const ls = globalThis.localStorage;
    const probe = "__pirates_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return {
      get: (k) => {
        try {
          return ls.getItem(k);
        } catch {
          return null;
        }
      },
      set: (k, v) => {
        try {
          ls.setItem(k, v);
        } catch {
          // Quota exceeded or storage disabled mid-session: keep playing.
        }
      },
      remove: (k) => {
        try {
          ls.removeItem(k);
        } catch {
          // ignore
        }
      },
    };
  } catch {
    return memoryStore();
  }
}
