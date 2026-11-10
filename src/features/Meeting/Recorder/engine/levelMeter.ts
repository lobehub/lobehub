/** How many recent frame levels the waveform keeps (200 ms each → ~9.6 s). */
export const LEVEL_HISTORY_SIZE = 48;

type Listener = (levels: readonly number[]) => void;

/**
 * Recent input levels for the waveform. Kept outside the store: they change
 * five times a second and only the waveform paints them.
 */
export class LevelMeter {
  #levels: number[] = Array.from({ length: LEVEL_HISTORY_SIZE }, () => 0);
  readonly #listeners = new Set<Listener>();

  push(level: number) {
    this.#levels = [...this.#levels.slice(1), level];
    for (const listener of this.#listeners) listener(this.#levels);
  }

  reset() {
    this.#levels = Array.from({ length: LEVEL_HISTORY_SIZE }, () => 0);
    for (const listener of this.#listeners) listener(this.#levels);
  }

  get levels(): readonly number[] {
    return this.#levels;
  }

  subscribe(listener: Listener) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
