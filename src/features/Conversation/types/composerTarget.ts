export type ComposerTarget =
  | {
      contextKey: string;
      writable: true;
    }
  | {
      reason: 'no-composer' | 'read-only' | 'unresolved';
      writable: false;
    };

export const createComposerTarget = (contextKey: string): ComposerTarget => ({
  contextKey,
  writable: true,
});

export const resolveThreadComposerTarget = ({
  contextKey,
  metadataResolved,
  sourceToolCallId,
}: {
  contextKey: string;
  metadataResolved: boolean;
  sourceToolCallId?: string;
}): ComposerTarget => {
  if (!metadataResolved) return { reason: 'unresolved', writable: false };
  if (sourceToolCallId) return { reason: 'read-only', writable: false };

  return createComposerTarget(contextKey);
};
