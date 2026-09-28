import { buildAcceptanceRepairPrompt } from '@lobechat/prompts';

interface RejectCopyOnlyParams {
  acceptanceId: string;
  comment: string;
  copy: (text: string) => Promise<unknown>;
  reject: (options: { comment: string; dispatch: false }) => Promise<unknown>;
}

/**
 * The reject dialog's no-agent path: hand the repair prompt to the reviewer and
 * record the reject WITHOUT the server's send-back. The viewer only sees
 * `origin` as the record owner, so a reviewer in this path may still have a
 * dispatchable origin server-side — dispatching there would start that agent
 * while the reviewer pastes the prompt elsewhere, running the repair twice.
 *
 * The copy runs first: the clipboard write needs the click's user activation,
 * which awaiting the reject request would lose.
 */
export const rejectCopyOnly = async ({
  acceptanceId,
  comment,
  copy,
  reject,
}: RejectCopyOnlyParams) => {
  await copy(buildAcceptanceRepairPrompt(acceptanceId, comment));
  return reject({ comment, dispatch: false });
};
