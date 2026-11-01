/** Capacity failures are transient and use the same retry policy as CC overloads. */
export const isCodexCapacityError = (message: string): boolean =>
  /\bselected model is at capacity\b/i.test(message);
