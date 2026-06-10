import debug from 'debug';
import { eq } from 'drizzle-orm';

import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { MarketService } from '@/server/services/market';

const log = debug('lobe-server:bot:feedback');

/**
 * Maximum number of characters used to derive a feedback title from the
 * leading line of the user's message. The web `FeedbackModal` caps title
 * input at 200 chars (`src/components/FeedbackModal/index.tsx`), so the bot
 * path stays in the same envelope so downstream tooling can treat the two
 * sources interchangeably.
 */
const TITLE_MAX_LENGTH = 80;

const truncateTitle = (raw: string): string => {
  const firstLine = raw.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (firstLine.length <= TITLE_MAX_LENGTH) return firstLine;
  return `${firstLine.slice(0, TITLE_MAX_LENGTH - 1).trim()}…`;
};

export interface BotFeedbackSubmitOptions {
  applicationId?: string;
  /** Raw text after the `/feedback` command (already trimmed by the caller). */
  body: string;
  platform: string;
  /** Stable platform conversation id for traceability — included in
   *  `clientInfo` so operators can correlate feedback with the originating
   *  thread without exposing it in the user-facing message. */
  threadId?: string;
  /** LobeHub user id. Required — feedback always carries identity so it can
   *  be tied back to the account / workspace. */
  userId: string;
}

export interface BotFeedbackSubmitResult {
  issueUrl?: string;
  success: boolean;
}

/**
 * Submit a `/feedback` slash-command body via the same `MarketService`
 * pipeline the web `FeedbackModal` uses. Bot webhook contexts have no
 * OAuth access token, so we authenticate via the trusted-client token by
 * looking up the user's email/name from `users` and passing it as
 * `userInfo` (Market SDK signs the request server-side).
 *
 * Returns `success: false` on any failure (DB error, Market error). The
 * caller renders the user-facing reply via `renderFeedbackSubmitted` /
 * `renderCommandReply('cmdFeedbackError')`.
 */
export async function submitBotFeedback(
  serverDB: LobeChatDatabase,
  options: BotFeedbackSubmitOptions,
): Promise<BotFeedbackSubmitResult> {
  const { applicationId, body, platform, threadId, userId } = options;

  try {
    const user = await serverDB.query.users.findFirst({
      columns: { email: true, fullName: true },
      where: eq(users.id, userId),
    });

    const marketService = new MarketService({
      userInfo: {
        email: user?.email ?? undefined,
        name: user?.fullName ?? undefined,
        userId,
      },
    });

    const title = truncateTitle(body) || `Bot feedback from ${platform}`;
    const footerParts = [`via ${platform} bot`];
    if (applicationId) footerParts.push(`app: ${applicationId}`);
    if (threadId) footerParts.push(`thread: ${threadId}`);
    const result = await marketService.submitFeedback({
      clientInfo: {
        url: applicationId ? `bot://${platform}/${applicationId}` : `bot://${platform}`,
      },
      email: user?.email ?? undefined,
      message: `${body}\n\n---\n_Submitted ${footerParts.join(' · ')}_`,
      title,
    });

    return { issueUrl: result?.issueUrl, success: true };
  } catch (error) {
    log(
      'submitBotFeedback failed: platform=%s, applicationId=%s, userId=%s, error=%O',
      platform,
      applicationId,
      userId,
      error,
    );
    return { success: false };
  }
}
