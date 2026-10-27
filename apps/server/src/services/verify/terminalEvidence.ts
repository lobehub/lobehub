import { normalizeEvidenceMetadata } from '@lobechat/const/verify';
import type { VerifyEvidenceType } from '@lobechat/types';
import {
  parseTerminalEvidenceMetadata,
  TERMINAL_ARTIFACT_KEYS,
} from '@lobechat/utils/verify/terminalEvidence';
import { TRPCError } from '@trpc/server';

interface ArtifactFile {
  fileHash?: string | null;
  size: number;
}

/**
 * The metadata an evidence row is stored with. A `terminal` evidence must carry
 * a valid execution record whose artifacts are files this caller can read, each
 * matching the size and SHA-256 its bundle declared — so a record cannot point
 * at someone else's file, or at a different file than the one that was hashed.
 * Matching hashes prove the file did not change in transit; they say nothing
 * about whether the command ran, which stays the record's declared provenance.
 */
export const resolveEvidenceMetadata = async (
  findFile: (fileId: string) => Promise<ArtifactFile | null | undefined>,
  type: VerifyEvidenceType,
  metadata: unknown,
): Promise<unknown> => {
  const normalized = normalizeEvidenceMetadata(metadata, type);
  if (type !== 'terminal') return normalized;

  const bag =
    normalized && typeof normalized === 'object' && !Array.isArray(normalized)
      ? (normalized as Record<string, unknown>)
      : {};
  const parsed = parseTerminalEvidenceMetadata(bag.terminal);
  if (!parsed.ok)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Invalid terminal evidence metadata: ${parsed.error}. Publish terminal evidence from a captured or imported command execution bundle, not an authored example.`,
    });

  for (const key of TERMINAL_ARTIFACT_KEYS) {
    const artifact = parsed.metadata.artifacts[key];
    if (!artifact) continue;
    if (!artifact.fileId)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Terminal artifact "${key}" has no fileId — upload the file before attaching the evidence.`,
      });
    const file = await findFile(artifact.fileId);
    if (!file)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Terminal artifact "${key}" references file ${artifact.fileId}, which does not exist or is not yours.`,
      });
    if (file.size !== artifact.size || (file.fileHash && file.fileHash !== artifact.sha256))
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Terminal artifact "${key}" does not match file ${artifact.fileId} (size or SHA-256 differs).`,
      });
  }

  return { ...bag, terminal: parsed.metadata };
};
