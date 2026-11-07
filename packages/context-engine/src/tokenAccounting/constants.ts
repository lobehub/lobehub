/**
 * Multiplier on `tokenx` estimates. `tokenx` under-counts provider tokenizers by
 * roughly 10–15% on JSON / code / CJK-heavy agent conversations; the extra
 * headroom makes budget checks fire before the upstream tokenizer overflows.
 */
export const DEFAULT_DRIFT_MULTIPLIER = 1.25;
