class LRUMap<K, V> {
  private map = new Map<K, V>();
  private limit: number;

  constructor(limit = 0) {
    this.limit = limit;
  }

  get size() {
    return this.map.size;
  }

  get(key: K) {
    return this.map.get(key);
  }

  set(key: K, value: V) {
    if (!this.map.has(key) && this.limit > 0 && this.map.size >= this.limit) {
      const oldest = this.map.keys().next().value as K | undefined;

      if (oldest !== undefined) this.map.delete(oldest);
    }

    this.map.set(key, value);
    return this;
  }

  delete(key: K) {
    const value = this.map.get(key);
    this.map.delete(key);
    return value;
  }

  clear() {
    this.map.clear();
  }
}

export { LRUMap };
export default { LRUMap };
