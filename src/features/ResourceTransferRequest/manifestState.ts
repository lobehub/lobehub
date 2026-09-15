import type { TransferManifest } from '@/services/resourceTransferRequest';

/**
 * A transfer can proceed only after its impact manifest loaded successfully
 * and contains no server-declared blocker.
 */
export const isTransferManifestActionable = (
  manifest: TransferManifest | undefined,
  error: unknown,
): boolean => !!manifest && !error && !manifest.hiddenReferencedMember;
