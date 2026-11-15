import { TRPCClientError } from '@trpc/client';

/** Only intentional validation/permission messages are safe to show verbatim. */
export const datasetImportErrorMessage = (error: unknown, fallback: string) =>
  error instanceof TRPCClientError &&
  (error.data?.code === 'BAD_REQUEST' || error.data?.code === 'FORBIDDEN')
    ? error.message
    : fallback;
