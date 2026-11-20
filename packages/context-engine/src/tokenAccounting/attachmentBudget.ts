import {
  FILE_PREVIEW_CHARS,
  isOversizedFileContent,
  previewLongFileContent,
} from '@lobechat/prompts';
import type { UIChatMessage } from '@lobechat/types';
import { estimateTokenCount } from 'tokenx';

import { countContextTokens, DEFAULT_DRIFT_MULTIPLIER } from './index';
import type { ContextTokenAccounting } from './types';

export interface PlanAttachmentPreviewsParams {
  /** Drift multiplier forwarded to {@link countContextTokens}. */
  driftMultiplier?: number;
  messages: UIChatMessage[];
  /**
   * Drift-adjusted token limit the request should stay under — the compression
   * threshold. Attachments only use the room the rest of the context leaves.
   */
  threshold: number;
  /** Tool definitions sent with the request. */
  tools?: unknown[];
}

export interface AttachmentPreviewPlan {
  /** Accounting of the request with {@link previewFileIds} sent as previews. */
  accounting: ContextTokenAccounting;
  /** Files whose text is sent as a preview the model can page through with `readAttachment`. */
  previewFileIds: Set<string>;
}

interface Candidate {
  id: string;
  /** Tokens saved by sending every occurrence of the file as a preview. */
  savings: number;
}

/**
 * Collect files whose text would be inlined in full, newest message first. A file
 * attached to several messages is inlined in each of them, so its cost adds up.
 */
const collectInlineCandidates = (messages: UIChatMessage[]): Candidate[] => {
  const candidates = new Map<string, Candidate>();

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user' || !msg.fileList?.length) continue;

    for (const file of msg.fileList) {
      const content = file.content || '';
      // Already a preview, or too short for a preview to save anything.
      if (content.length <= FILE_PREVIEW_CHARS) continue;
      if (isOversizedFileContent(content.length, file.originalCharCount)) continue;

      const preview = previewLongFileContent(content, { fileId: file.id, forcePreview: true });
      const savings = estimateTokenCount(content) - estimateTokenCount(preview.body);
      if (savings <= 0) continue;

      const existing = candidates.get(file.id);
      if (existing) existing.savings += savings;
      else candidates.set(file.id, { id: file.id, savings });
    }
  }

  return [...candidates.values()];
};

/**
 * Decide which attachments to send as previews so attachment text alone never
 * pushes a request over the compression threshold.
 *
 * Attachment text is re-sent on every turn, and compression only keeps a
 * summary of older messages, so letting attachments trigger compression loses
 * their content. Instead, attachments get the room the rest of the context
 * leaves under the threshold: files are inlined newest first while they fit,
 * and the rest are sent as a preview plus file id for `readAttachment`. When
 * everything fits, nothing is previewed. Compression then only fires when the
 * conversation itself (with every attachment previewed) exceeds the threshold.
 */
export const planAttachmentPreviews = ({
  driftMultiplier = DEFAULT_DRIFT_MULTIPLIER,
  messages,
  threshold,
  tools,
}: PlanAttachmentPreviewsParams): AttachmentPreviewPlan => {
  const count = (previewFileIds?: Set<string>) =>
    countContextTokens({ messages, options: { driftMultiplier, previewFileIds }, tools });

  const full = count();
  if (full.adjustedTotal <= threshold) return { accounting: full, previewFileIds: new Set() };

  const candidates = collectInlineCandidates(messages);
  if (candidates.length === 0) return { accounting: full, previewFileIds: new Set() };

  const previewFileIds = new Set(candidates.map((candidate) => candidate.id));
  const allPreviewed = count(previewFileIds);

  // Raw-token room left under the threshold with every candidate previewed.
  let room = Math.floor(threshold / driftMultiplier) - allPreviewed.rawTotal;

  for (const candidate of candidates) {
    if (candidate.savings > room) continue;
    previewFileIds.delete(candidate.id);
    room -= candidate.savings;
  }

  return { accounting: count(previewFileIds), previewFileIds };
};
