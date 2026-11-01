import { z } from 'zod';

import type { MessageMetadata } from './metadata';
import { MessageMetadataSchema } from './metadata';

/**
 * Metadata the composer authors for the user message it sends: content attached
 * from the conversation, a page or code, and local file snapshots.
 *
 * Both send transports persist the user message from this one shape —
 * `aiChat.sendMessageInServer` (client / in-process hetero runtimes) and
 * `aiAgent.execAgent` (gateway runtime, where the server creates the row). Add
 * a per-message field here and both transports carry it; adding it to only one
 * request is how attached content used to vanish on gateway sends.
 *
 * Run settings (`steer`, `trigger`) and server-derived provenance
 * (`agentSender`, `botSender`, `externalOrigin`, …) are deliberately absent:
 * the server decides those itself.
 */
export const ComposerUserMessageMetadataSchema = MessageMetadataSchema.pick({
  contextSelections: true,
  localSystemToolSnapshots: true,
  pageSelections: true,
});

export type ComposerUserMessageMetadata = z.infer<typeof ComposerUserMessageMetadataSchema>;

/** The user message the composer sends, beyond its text, files and ids. */
export const ComposerUserMessageSchema = z.object({
  editorData: z.record(z.string(), z.unknown()).optional(),
  metadata: ComposerUserMessageMetadataSchema.optional(),
});

export type ComposerUserMessage = z.infer<typeof ComposerUserMessageSchema>;

/** The keys of {@link ComposerUserMessageMetadataSchema}, for code that walks every field. */
export const COMPOSER_USER_MESSAGE_METADATA_KEYS = Object.keys(
  ComposerUserMessageMetadataSchema.shape,
) as Array<keyof ComposerUserMessageMetadata>;

/**
 * Pick the composer-authored part of a send's user message. Empty arrays and
 * absent fields are dropped, and `undefined` comes back when nothing is left,
 * so a plain-text send carries no extra payload.
 */
export const toComposerUserMessage = ({
  editorData,
  metadata,
}: {
  editorData?: Record<string, unknown> | null;
  metadata?: MessageMetadata | null;
}): ComposerUserMessage | undefined => {
  const picked: Record<string, unknown> = {};
  for (const key of COMPOSER_USER_MESSAGE_METADATA_KEYS) {
    const value = metadata?.[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    picked[key] = value;
  }

  const hasMetadata = Object.keys(picked).length > 0;
  const hasEditorData = !!editorData && Object.keys(editorData).length > 0;
  if (!hasMetadata && !hasEditorData) return;

  return {
    ...(hasEditorData ? { editorData: editorData! } : undefined),
    ...(hasMetadata ? { metadata: picked as ComposerUserMessageMetadata } : undefined),
  };
};
