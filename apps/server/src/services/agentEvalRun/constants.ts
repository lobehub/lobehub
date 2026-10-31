export const EVAL_AGENT_RUNTIME_QSTASH_RETRIES = 5;
export const EVAL_AGENT_RUNTIME_QSTASH_RETRY_DELAY = '10000 * (1 + retried)';
export const EVAL_HISTORY_TAIL_METADATA_KEY = 'evalHistoryTailMessageId';
/** Caps concurrent pass@k run-thread-trajectory workflow triggers per topic. */
export const THREAD_TRIGGER_CONCURRENCY = 5;
