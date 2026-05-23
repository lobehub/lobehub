// Type `never[]` so `x ?? EMPTY_ARRAY` doesn't widen `x`'s element type.
// Frozen to prevent accidental mutation of the shared reference.
export const EMPTY_ARRAY: never[] = Object.freeze([]) as never[];
