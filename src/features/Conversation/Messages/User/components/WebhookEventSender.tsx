import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { WebhookIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { WebhookEventAttributes } from '@/features/Conversation/Markdown/plugins/WebhookEvent/parseWebhookEvent';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { useConversationStore } from '../../../store';

// The MCP and SCM senders' frame, so a wake-up message from any source sits the same way.
const styles = stylex.create({
  caption: {
    fontSize: '12px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorTextSecondary },
  },
  mark: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    inlineSize: '36px',
    blockSize: '36px',
    borderRadius: '8px',
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

/** The webhook mark standing in for the avatar of a webhook-woken message. */
export const WebhookEventAvatar = memo(() => (
  <span {...stylex.props(styles.mark)}>
    <Icon icon={WebhookIcon} size={20} />
  </span>
));

WebhookEventAvatar.displayName = 'WebhookEventAvatar';

/**
 * The webhook as the sender of the message, with a second line linking to the Agent's Webhook
 * page, where its owner sees the calls and can pause or delete the webhook.
 */
export const WebhookEventSenderTitle = memo<{ source: WebhookEventAttributes }>(({ source }) => {
  const { t } = useTranslation('integration');
  const agentId = useConversationStore((s) => s.context.agentId);
  const caption = t('webhookEvent.senderCaption');

  return (
    <Flexbox align={'flex-end'} gap={2} style={{ minWidth: 0 }}>
      <Text style={{ whiteSpace: 'nowrap' }} weight={500}>
        {source.name?.trim() || t('webhookEvent.defaultName')}
      </Text>
      {agentId ? (
        <WorkspaceLink to={`/agent/${agentId}/webhook`} {...stylex.props(styles.caption)}>
          {caption}
        </WorkspaceLink>
      ) : (
        <span {...stylex.props(styles.caption)}>{caption}</span>
      )}
    </Flexbox>
  );
});

WebhookEventSenderTitle.displayName = 'WebhookEventSenderTitle';
