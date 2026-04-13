// Web shim for react-native-mmkv — uses localStorage
export function createMMKV() {
  return {
    set(key, value) {
      try { localStorage.setItem(key, String(value)); } catch (_) {}
    },
    getString(key) {
      try { return localStorage.getItem(key); } catch (_) { return undefined; }
    },
    getNumber(key) {
      try {
        const v = localStorage.getItem(key);
        return v != null ? Number(v) : undefined;
      } catch (_) { return undefined; }
    },
    getBoolean(key) {
      try {
        const v = localStorage.getItem(key);
        return v != null ? v === 'true' : undefined;
      } catch (_) { return undefined; }
    },
    delete(key) {
      try { localStorage.removeItem(key); } catch (_) {}
    },
    contains(key) {
      try { return localStorage.getItem(key) !== null; } catch (_) { return false; }
    },
    clearAll() {
      try { localStorage.clear(); } catch (_) {}
    },
  };
}
