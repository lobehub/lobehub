import { create } from 'zustand';

/**
 * Pre-topic "arm the goal" intent, keyed by agentId and stamped with the arm
 * time.
 *
 * Before a conversation has a topic there is nothing to persist a goal onto, so
 * the composer "+" menu instead *arms* the goal: the next message the user sends
 * (the one that creates the topic) becomes that topic's goal.
 *
 * The stamp scopes the intent to the topic it was armed in: the tray only adopts
 * a first message that post-dates the arm (so switching into a pre-existing topic
 * can't hijack the intent), and it spends the arm the moment any topic becomes
 * active — so a goal only ever applies to the current topic and a stray arm never
 * leaks to the next one.
 *
 * A tiny standalone store so the "+" menu (a different store scope than the tray)
 * and the tray share the intent without threading it through the big stores.
 */
interface GoalArmState {
  arm: (agentId: string) => void;
  /** agentId → arm timestamp (ms). Absent means not armed. */
  armedAt: Record<string, number>;
  disarm: (agentId: string) => void;
}

export const useGoalArmStore = create<GoalArmState>((set) => ({
  arm: (agentId) => set((s) => ({ armedAt: { ...s.armedAt, [agentId]: Date.now() } })),
  armedAt: {},
  disarm: (agentId) =>
    set((s) => {
      if (s.armedAt[agentId] === undefined) return s;
      const next = { ...s.armedAt };
      delete next[agentId];
      return { armedAt: next };
    }),
}));
