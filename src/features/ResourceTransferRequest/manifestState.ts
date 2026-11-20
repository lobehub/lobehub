import type { TransferManifest } from '@/services/resourceTransferRequest';

/**
 * A transfer can proceed only after its impact manifest loaded successfully
 * and contains no server-declared blocker.
 */
export const isTransferManifestActionable = (
  manifest: TransferManifest | undefined,
  error: unknown,
): boolean => !!manifest && !error && !manifest.hiddenReferencedMember;

/**
 * Whether Accept may be pressed. A restored manifest only paints the summary:
 * it must have been answered by the server in this session, and the LATEST
 * fetch error still blocks — a failed refresh after an earlier success leaves
 * the impact unknown again.
 */
export const isTransferManifestAcceptable = ({
  confirmed,
  error,
  manifest,
}: {
  confirmed: boolean;
  error: unknown;
  manifest: TransferManifest | undefined;
}): boolean => confirmed && isTransferManifestActionable(manifest, error);
