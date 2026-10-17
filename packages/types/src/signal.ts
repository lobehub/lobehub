/**
 * Signals — facts the outside world produced, as an Oracle delivered them.
 *
 * An Oracle is whatever brings outside information into LobeHub: a mail
 * provider's webhook today, other feeds later. A signal records only that
 * something happened out there; what it means (a mail, an inbox item, a wake)
 * is decided by whoever processes it.
 */

/** Processing lifecycle of one signal. */
export const SIGNAL_STATUSES = ['pending', 'processed', 'ignored', 'failed'] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];
