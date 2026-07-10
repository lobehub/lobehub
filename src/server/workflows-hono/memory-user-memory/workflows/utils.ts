/**
 * Cursor shape accepted by workflow pagination serializers.
 */
export interface WorkflowCursorLike {
  /**
   * Cursor timestamp from a live database row or a JSON-restored workflow step result.
   */
  createdAt: Date | string;
  /**
   * Stable cursor id used to break ties when timestamps are equal.
   */
  id: string;
}

/**
 * Serializes a workflow cursor into the JSON-safe cursor shape.
 *
 * Use when:
 * - Scheduling a child workflow with a pagination cursor
 * - Passing cursor data across Upstash Workflow JSON boundaries
 *
 * Expects:
 * - `createdAt` is either a valid Date or an ISO-compatible date string
 *
 * Returns:
 * - A cursor with `createdAt` normalized to an ISO string
 *
 * Before:
 * - { createdAt: Date("2024-07-02T09:36:44.073Z"), id: "user_1" }
 * - { createdAt: "2024-07-02T09:36:44.073Z", id: "user_1" }
 *
 * After:
 * - { createdAt: "2024-07-02T09:36:44.073Z", id: "user_1" }
 */
export const serializeWorkflowCursor = (
  cursor: WorkflowCursorLike,
  errorMessage = 'Invalid workflow cursor date',
) => {
  // NOTICE:
  // Upstash Workflow persists step results as JSON and restores Date values as strings.
  // This cursor can come from a live DB result or a restored context.run result.
  // Keep accepting both shapes until workflow step serialization preserves Date objects.
  const createdAt = new Date(cursor.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error(errorMessage);
  }

  return { createdAt: createdAt.toISOString(), id: cursor.id };
};
