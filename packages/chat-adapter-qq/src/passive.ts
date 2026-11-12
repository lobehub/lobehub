/**
 * QQ's passive-reply window.
 *
 * Since 2025-04-21 QQ has no active-message channel: a bot may only send by answering an inbound
 * message through that message's `msg_id` / `event_id`, and only inside a fixed window with a
 * fixed number of replies per inbound message. Anything outside it is rejected by the server, so
 * the window has to be tracked rather than guessed at send time.
 *
 * The window is per conversation (a group or a C2C pair), not per message: opening a new inbound
 * message restarts it.
 */

export type QQPassiveThreadType = 'c2c' | 'dms' | 'group' | 'guild';

export interface QQPassiveLimits {
  /** Replies one inbound message may carry. */
  maxReplies: number;
  /** How long after the inbound message a reply is still accepted; ms. */
  windowMs: number;
}

/**
 * Limits from the QQ bot docs: a group window is 5 minutes / 5 replies, C2C 60 minutes / 5
 * replies; guild and DMS only bound the window (they carry no `msg_seq`).
 */
export const QQ_PASSIVE_LIMITS: Record<QQPassiveThreadType, QQPassiveLimits> = {
  c2c: { maxReplies: 5, windowMs: 60 * 60 * 1000 },
  dms: { maxReplies: Number.MAX_SAFE_INTEGER, windowMs: 5 * 60 * 1000 },
  group: { maxReplies: 5, windowMs: 5 * 60 * 1000 },
  guild: { maxReplies: Number.MAX_SAFE_INTEGER, windowMs: 5 * 60 * 1000 },
};

/** What the inbound message that opened the current window carried. */
export interface QQPassiveToken {
  /** Epoch ms the inbound message arrived. */
  at: number;
  eventId?: string;
  msgId?: string;
}

/** One reserved reply slot. */
export interface QQPassiveSlot extends QQPassiveToken {
  /** 1-based reply counter within this window (`msg_seq`). */
  seq: number;
}

/**
 * Where a thread's passive window lives. Implementations never throw: a bot that loses its window
 * state must degrade to "cannot send", not to a failed webhook.
 */
export interface QQPassiveStore {
  /** Start a new window for `key` from an inbound message. */
  open(key: string, token: QQPassiveToken): Promise<void>;
  /** Take the next reply slot, or null when the window is closed or out of replies. */
  reserve(key: string, limits: QQPassiveLimits, now?: number): Promise<QQPassiveSlot | null>;
  /** Claim the text that a closed window could not carry, so the next one can deliver it. */
  takePending(key: string): Promise<string | undefined>;
  /** Park text that could not be delivered. Only the newest one is kept. */
  savePending(key: string, text: string): Promise<void>;
}

interface Window {
  at: number;
  eventId?: string;
  msgId?: string;
  seq: number;
}

/** In-process store: enough for tests and for a single-instance deployment. */
export const createMemoryQQPassiveStore = (): QQPassiveStore => {
  const windows = new Map<string, Window>();
  const pending = new Map<string, string>();

  return {
    open: async (key, token) => {
      // A new inbound message restarts the window (and its reply budget).
      windows.set(key, { at: token.at, eventId: token.eventId, msgId: token.msgId, seq: 0 });
    },

    reserve: async (key, limits, now = Date.now()) => {
      const window = windows.get(key);
      if (!window) return null;
      if (now - window.at > limits.windowMs) {
        windows.delete(key);
        return null;
      }
      if (window.seq >= limits.maxReplies) return null;

      window.seq += 1;
      return { at: window.at, eventId: window.eventId, msgId: window.msgId, seq: window.seq };
    },

    savePending: async (key, text) => {
      pending.set(key, text);
    },

    takePending: async (key) => {
      const text = pending.get(key);
      pending.delete(key);
      return text;
    },
  };
};

/** The prefix a delivered-late reply carries, so the reader knows why it is out of order. */
export const QQ_DEFERRED_PREFIX = '（上一条回复没发出去，补上）\n\n';
