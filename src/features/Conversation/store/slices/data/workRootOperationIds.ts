/**
 * Reads the operation-final work root id stamped on message/block metadata by
 * the server work registry (`metadata.work.rootOperationId`). Consumed by the
 * in-message Works chip resolution (`AssistantGroup`) and the work-summary index
 * (`workSummaries`).
 */
export const getOperationFinalRootId = (
  metadata?: { work?: { rootOperationId?: unknown } } | null,
) =>
  typeof metadata?.work?.rootOperationId === 'string' ? metadata.work.rootOperationId : undefined;
