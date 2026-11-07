import { z } from 'zod';

/**
 * Upper bound on rows per `getMessages` page (the model's default). Clamped, not
 * rejected: already-shipped clients must keep loading rather than get a 400.
 */
export const MAX_GET_MESSAGES_PAGE_SIZE = 1000;

export const getMessagesPageSizeSchema = z
  .number()
  .optional()
  .transform((value) =>
    value === undefined ? undefined : Math.min(Math.max(value, 1), MAX_GET_MESSAGES_PAGE_SIZE),
  );
