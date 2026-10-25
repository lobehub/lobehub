import type {
  WakeDecision,
  WakePolicy,
  WakePolicyRecord,
  WakePolicyResult,
  WakeSignal,
  WakeStateKey,
  WakeStateSnapshot,
} from './types';

const pickState = (snapshot: WakeStateSnapshot, keys: readonly WakeStateKey[]) => {
  const picked: Partial<WakeStateSnapshot> = {};
  for (const key of keys) Object.assign(picked, { [key]: snapshot[key] });

  return picked;
};

/**
 * Explicit @bot or reply-to-bot. These wake the bot unconditionally, so the aggregator answers
 * without running any policy.
 */
export const isExplicitWake = (state: Pick<WakeStateSnapshot, 'explicitMention' | 'replyToBot'>) =>
  state.explicitMention || state.replyToBot;

// A broken policy must not wake or silence the bot; it abstains and leaves a record.
const failedResult = (error: unknown): WakePolicyResult => ({
  confidence: 0,
  reason: `policy-error: ${error instanceof Error ? error.message : String(error)}`,
  tags: ['policy-error'],
  verdict: 'abstain',
});

const policyInput = (policy: WakePolicy, signal: WakeSignal, snapshot: WakeStateSnapshot) => ({
  signal,
  state: pickState(snapshot, policy.requires) as Pick<WakeStateSnapshot, WakeStateKey>,
});

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | undefined)?.then === 'function';

const fastPathDecision = (snapshot: WakeStateSnapshot): WakeDecision => ({
  fastPath: true,
  reason: snapshot.explicitMention ? 'explicit-mention' : 'reply-to-bot',
  records: [],
  verdict: 'allow',
});

/**
 * The order-dependent fold shared by the sync and async aggregators, so the two cannot drift.
 */
const createFold = () => {
  const records: WakePolicyRecord[] = [];
  let allowedBy: string | undefined;
  let denied = false;

  return {
    /** A costly policy is not worth running once something has already denied the message. */
    shouldSkip: (policy: WakePolicy) => policy.costly === true && denied,
    /** Returns the decision when this policy's enforcing deny ends the evaluation. */
    push: (policy: WakePolicy, result: WakePolicyResult, latencyMs: number) => {
      const effective = policy.mode === 'enforce';

      records.push({
        ...result,
        effective,
        latencyMs,
        mode: policy.mode as WakePolicyRecord['mode'],
        policyId: policy.id,
        policyVersion: policy.version,
      });

      if (result.verdict === 'deny') denied = true;
      if (!effective) return;

      if (result.verdict === 'deny') {
        return {
          decidedBy: policy.id,
          fastPath: false,
          reason: result.reason,
          records,
          verdict: 'deny',
        } satisfies WakeDecision;
      }

      if (result.verdict === 'allow') allowedBy ??= policy.id;
    },
    finish: (): WakeDecision => {
      if (allowedBy) {
        const winner = records.find((record) => record.policyId === allowedBy);

        return {
          decidedBy: allowedBy,
          fastPath: false,
          reason: winner?.reason ?? 'allow',
          records,
          verdict: 'allow',
        };
      }

      return { fastPath: false, reason: 'no-enforcing-opinion', records, verdict: 'abstain' };
    },
  };
};

/**
 * Folds synchronous wake policies into one decision.
 *
 * Use when:
 * - Every policy is synchronous (the rule policies). Use {@link aggregateWakeVerdictsAsync}
 *   when a policy may await a model.
 *
 * Expects:
 * - Policies are pure; `snapshot` is the state resolved once for this evaluation
 *
 * Returns:
 * - `fastPath` allow for explicit wakes, without evaluating any policy
 * - Otherwise policies run in order: `off` is skipped, `shadow` is recorded but never affects the
 *   verdict, an `enforce` deny short-circuits (later policies are not evaluated), and any other
 *   `enforce` allow wins over abstain. No enforcing opinion yields `abstain`. A policy that
 *   returns a promise here abstains with a `policy-error`.
 */
export const aggregateWakeVerdicts = (
  policies: readonly WakePolicy[],
  signal: WakeSignal,
  snapshot: WakeStateSnapshot,
): WakeDecision => {
  if (isExplicitWake(snapshot)) return fastPathDecision(snapshot);

  const fold = createFold();

  for (const policy of policies) {
    if (policy.mode === 'off' || fold.shouldSkip(policy)) continue;

    const startedAt = performance.now();
    let result: WakePolicyResult;
    try {
      const evaluated = policy.evaluate(policyInput(policy, signal, snapshot));
      result = isThenable(evaluated)
        ? failedResult(new Error('async policy evaluated by the sync aggregator'))
        : evaluated;
    } catch (error) {
      result = failedResult(error);
    }

    const decided = fold.push(policy, result, Math.round(performance.now() - startedAt));
    if (decided) return decided;
  }

  return fold.finish();
};

/**
 * Same contract as {@link aggregateWakeVerdicts}, awaiting each policy in order.
 *
 * Policies run one after another, not in parallel: a cheap rule that denies spares the costly
 * policy after it (`WakePolicy.costly`).
 */
export const aggregateWakeVerdictsAsync = async (
  policies: readonly WakePolicy[],
  signal: WakeSignal,
  snapshot: WakeStateSnapshot,
): Promise<WakeDecision> => {
  if (isExplicitWake(snapshot)) return fastPathDecision(snapshot);

  const fold = createFold();

  for (const policy of policies) {
    if (policy.mode === 'off' || fold.shouldSkip(policy)) continue;

    const startedAt = performance.now();
    let result: WakePolicyResult;
    try {
      result = await policy.evaluate(policyInput(policy, signal, snapshot));
    } catch (error) {
      result = failedResult(error);
    }

    const decided = fold.push(policy, result, Math.round(performance.now() - startedAt));
    if (decided) return decided;
  }

  return fold.finish();
};
