import type { BotNoReplyClaimedReason } from '@lobechat/types';
import { parseBotNoReplyToken } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MessageCircleOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  root: {
    color: cssVar.colorTextTertiary,
    fontSize: cssVar.fontSizeSM,
    lineHeight: 1.6,
  },
});

interface ResolveNoReplyReasonParams {
  content?: string | null;
  /** Anything else the message shows (tool calls, images) means it is not a bare decision. */
  hasOtherOutput?: boolean;
  /** A streaming `NO_REPLY…` may still turn into a real answer, so only a finished one counts. */
  isGenerating?: boolean;
}

/**
 * The reason a bot gave for staying silent, when an assistant message is nothing but its
 * `NO_REPLY[:reason]` token. `undefined` for any other message.
 */
export const resolveNoReplyReason = ({
  content,
  hasOtherOutput,
  isGenerating,
}: ResolveNoReplyReasonParams): BotNoReplyClaimedReason | undefined => {
  if (isGenerating || hasOtherOutput) return undefined;

  return parseBotNoReplyToken(content);
};

/** Stands in for the raw `NO_REPLY` token: the bot read the message and chose not to reply. */
export const NoReplyNotice = ({ reason }: { reason: BotNoReplyClaimedReason }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox
      horizontal
      align={'center'}
      data-testid="no-reply-notice"
      gap={6}
      {...stylex.props(styles.root)}
    >
      <Icon icon={MessageCircleOffIcon} size={14} />
      <span>
        {t('noReply.title')}
        {reason !== 'unspecified' && ` · ${t(`noReply.reason.${reason}`)}`}
      </span>
    </Flexbox>
  );
};
