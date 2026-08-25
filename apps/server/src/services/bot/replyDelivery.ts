import type { BotMessageAttachment } from './platforms';

interface DeliverEditedReplyOptions {
  attachments?: BotMessageAttachment[];
  currentText?: string;
  editText?: (text: string) => Promise<void>;
  postAttachments: (attachments: BotMessageAttachment[]) => Promise<void>;
  postText: (text: string) => Promise<void>;
  text: string;
}

export async function deliverEditedReply({
  attachments,
  currentText,
  editText,
  postAttachments,
  postText,
  text,
}: DeliverEditedReplyOptions): Promise<{ text: string; usedFallback: boolean }> {
  const completionText = text || (attachments?.length ? '📎' : '');
  const editPromise =
    editText && completionText !== currentText ? editText(completionText) : Promise.resolve();
  const attachmentResultPromise = (
    attachments?.length ? postAttachments(attachments) : Promise.resolve()
  ).then(
    () => ({ ok: true }) as const,
    (error: unknown) => ({ error, ok: false }) as const,
  );

  let usedFallback = false;
  try {
    await editPromise;
  } catch {
    usedFallback = true;
    await postText(completionText);
  }

  const attachmentResult = await attachmentResultPromise;
  if (!attachmentResult.ok) throw attachmentResult.error;
  return { text: completionText, usedFallback };
}
