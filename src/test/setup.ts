import "@testing-library/jest-dom/vitest";

// Node 25 ships an experimental built-in `localStorage` that wins
// over jsdom's Storage implementation and is missing methods like
// `.clear()` — every test that touches Web Storage trips on it.
// Install an in-memory shim so tests get the full Storage surface
// (getItem / setItem / removeItem / clear / length / key) regardless
// of the host runtime. Idempotent: only swaps if `.clear` is missing.
if (typeof localStorage === "undefined" || typeof (localStorage as { clear?: unknown }).clear !== "function") {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "localStorage", {
    value: shim,
    writable: true,
    configurable: true,
  });
}

// jsdom shims for xterm.js / ResizeObserver
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
