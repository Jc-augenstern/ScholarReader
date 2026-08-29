declare global {
  interface Map<K, V> {
    getOrInsert(key: K, defaultValue: V): V;
    getOrInsertComputed(key: K, callback: (key: K) => V): V;
  }
}

function installMapUpsertPolyfill(): void {
  if (typeof Map.prototype.getOrInsert !== "function") {
    Object.defineProperty(Map.prototype, "getOrInsert", {
      configurable: true,
      writable: true,
      value<K, V>(this: Map<K, V>, key: K, defaultValue: V): V {
        if (this.has(key)) return this.get(key) as V;
        this.set(key, defaultValue);
        return defaultValue;
      },
    });
  }

  if (typeof Map.prototype.getOrInsertComputed !== "function") {
    Object.defineProperty(Map.prototype, "getOrInsertComputed", {
      configurable: true,
      writable: true,
      value<K, V>(this: Map<K, V>, key: K, callback: (key: K) => V): V {
        if (this.has(key)) return this.get(key) as V;
        const value = callback(key);
        this.set(key, value);
        return value;
      },
    });
  }
}

installMapUpsertPolyfill();

export { installMapUpsertPolyfill };
