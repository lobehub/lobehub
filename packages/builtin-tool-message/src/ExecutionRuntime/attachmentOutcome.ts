import type { SendAttachmentsOutcome, SendMessageAttachment } from '../types';

/**
 * Turn a send state's attachment outcome into what the model must read.
 *
 * Attachment failures are swallowed per item on purpose so the text leg still
 * ships — but a `success: true` that says nothing about them is how the model
 * ends up telling the user "see attached" about a file that never arrived.
 * The failed attachments are named, with the reason, and the model is told
 * to fall back to a download link instead of claiming delivery.
 *
 * `success` stays true while SOMETHING reached the user (text, an embed, or
 * at least one attachment). When there was no text and every attachment failed, nothing was
 * delivered and the call is reported as failed.
 */
export const describeAttachmentOutcome = (
  params: { attachments?: SendMessageAttachment[]; content?: string; embeds?: unknown[] },
  state: SendAttachmentsOutcome,
  /** The success line, used verbatim while something reached the user. */
  sentLine: string,
): { content: string; success: boolean } => {
  const failures = state.attachmentFailures ?? [];
  if (failures.length === 0) return { content: sentLine, success: true };

  const requested = params.attachments?.length ?? failures.length;
  const lines = failures.map(
    (f) =>
      `- "${f.name ?? '(unnamed)'}" (${f.type}): ${f.reason}${f.detail ? ` — ${f.detail}` : ''}`,
  );
  // Embeds ride the text leg (Discord posts them even with empty content), so
  // a delivered embed counts as something reaching the user.
  const nothingDelivered =
    (state.attachmentsDelivered ?? 0) === 0 && !params.content?.trim() && !params.embeds?.length;
  const content = [
    // Never open with "Message sent" when nothing was: the lead line is what a
    // skimming model reads first.
    nothingDelivered ? 'Nothing was delivered.' : sentLine,
    `WARNING: ${failures.length} of ${requested} attachment(s) were NOT delivered:`,
    ...lines,
    nothingDelivered
      ? 'No text or embed was given and every attachment failed, so the user received nothing. Do not tell them a file was sent.'
      : 'Only the text (and any attachments not listed above) reached the user. Do NOT claim these files were attached — tell the user which files could not be delivered and share a download link for each instead.',
  ].join('\n');
  return { content, success: !nothingDelivered };
};
