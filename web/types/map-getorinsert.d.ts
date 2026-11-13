// Node 26 Map.getOrInsert — used by social.ts dedupe. Declared here because TS 5.8 lib
// does not include it yet; remove this block when the project's lib carries it.
declare global {
  interface Map<K, V> {
    getOrInsert(key: K, value: V): V;
  }
}

export {};
