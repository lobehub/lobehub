import type { EvidenceRef } from './types';

const UNSAFE_AUTOMATIC_MEMORY_PATTERNS = [
  /\bprobably\b/i,
  /\bmaybe\b/i,
  /\bmedical\b/i,
  /\bhealth\b/i,
  /\brelationship\b/i,
  /\bfinance\b/i,
];

/** Input required to write one maintenance memory candidate. */
export interface WriteMaintenanceMemoryInput {
  /** Candidate durable memory content. */
  content: string;
  /** User that owns the memory. */
  userId: string;
}

/** Request envelope for one maintenance memory write. */
export interface MemoryMaintenanceWriteRequest {
  /** Evidence supporting the memory write. */
  evidenceRefs: EvidenceRef[];
  /** Stable action idempotency key. */
  idempotencyKey: string;
  /** Domain payload for memory persistence. */
  input: WriteMaintenanceMemoryInput;
}

/** Result returned after a memory write adapter applies a candidate. */
export interface MemoryMaintenanceWriteResult {
  /** Durable memory id. */
  memoryId: string;
  /** Optional short persistence summary. */
  summary?: string;
}

/** Persistence adapter for maintenance memory writes. */
export interface MemoryMaintenanceWriter {
  /** Writes memory through the existing memory extraction/persistence stack. */
  writeMemory?: (input: {
    content: string;
    evidenceRefs: EvidenceRef[];
    idempotencyKey: string;
    userId: string;
  }) => Promise<MemoryMaintenanceWriteResult>;
}

/**
 * Error thrown when an injected same-turn adapter needs executor-style status mapping.
 */
export class MemoryMaintenanceActionError extends Error {
  /** Status that should be surfaced by the same-turn action handler. */
  status: 'failed' | 'skipped';

  /**
   * Creates a memory action status error.
   *
   * Use when:
   * - A legacy same-turn memory runner returns skipped or failed
   * - The shared memory service is used as the validation boundary
   *
   * Expects:
   * - `status` is not `applied`
   *
   * Returns:
   * - An error with a stable status for handler mapping
   */
  constructor(message: string, status: 'failed' | 'skipped') {
    super(message);
    this.name = 'MemoryMaintenanceActionError';
    this.status = status;
  }
}

const assertSafeAutomaticMemory = (content: string) => {
  if (UNSAFE_AUTOMATIC_MEMORY_PATTERNS.some((pattern) => pattern.test(content))) {
    throw new Error('Memory candidate is not safe for automatic write');
  }
};

/**
 * Creates a memory maintenance service.
 *
 * Use when:
 * - Nightly or self-reflection maintenance needs to write validated memory candidates
 * - Same-turn action handlers need a shared validation boundary before persistence
 *
 * Expects:
 * - Server callers inject an adapter backed by the existing memory stack
 * - Planner has already decided the action may be attempted
 *
 * Returns:
 * - A service that validates automatic memory candidates before delegating persistence
 */
export const createMemoryMaintenanceService = (writer: MemoryMaintenanceWriter = {}) => ({
  writeMemory: async (
    request: MemoryMaintenanceWriteRequest,
  ): Promise<MemoryMaintenanceWriteResult> => {
    assertSafeAutomaticMemory(request.input.content);

    if (!writer.writeMemory) {
      throw new Error('Memory write adapter is required');
    }

    return writer.writeMemory({
      content: request.input.content,
      evidenceRefs: request.evidenceRefs,
      idempotencyKey: request.idempotencyKey,
      userId: request.input.userId,
    });
  },
});
