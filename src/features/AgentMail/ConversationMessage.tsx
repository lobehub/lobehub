'use client';

import { ActionIcon, DropdownMenu, Flexbox, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { ChevronDown, ChevronRight, MoreHorizontal, Star } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentMailRow } from '@/services/agentAccount';

import MailAttachments from './MailAttachments';
import MailHtmlBody from './MailHtmlBody';
import { identityStyles } from './styles';

const formatAddress = ({ address, name }: { address: string; name?: string }) => name || address;

export interface ConversationMessageProps {
  expanded: boolean;
  mail: AgentMailRow;
  /** Forward this one mail, with its own attachments. */
  onForward?: () => void;
  onToggle: () => void;
  onToggleStar?: () => void;
  onTrash?: () => void;
}

/** One mail of a conversation: a summary line, and the mail itself once expanded. */
const ConversationMessage = memo<ConversationMessageProps>(
  ({ expanded, mail, onForward, onToggle, onToggleStar, onTrash }) => {
    const { t } = useTranslation('setting');
    const outbound = mail.direction === 'outbound';
    const sender = mail.fromName || mail.fromAddress;
    const starred = Boolean(mail.starredAt);
    const recipients = [...(mail.to ?? []), ...(mail.cc ?? [])].map(formatAddress).join(', ');
    const when = dayjs(mail.deliveredAt).format('YYYY-MM-DD HH:mm');
    // A display name alone hides the real sender, so the expanded mail keeps the address readable.
    const senderAddress =
      expanded && mail.fromName && mail.fromName !== mail.fromAddress
        ? mail.fromAddress
        : undefined;

    const menuItems = [
      ...(onForward
        ? [{ key: 'forward', label: t('identity.compose.action.forwardOne'), onClick: onForward }]
        : []),
      ...(onTrash
        ? [{ key: 'trash', label: t('identity.inbox.action.trashOne'), onClick: onTrash }]
        : []),
    ];

    return (
      <Flexbox
        className={identityStyles.mailBlock}
        data-mail-id={mail.id}
        data-testid={'mail-item'}
      >
        <Flexbox
          horizontal
          align={'center'}
          aria-expanded={expanded}
          aria-label={`${sender} — ${when}`}
          className={identityStyles.mailSummary}
          data-testid={'mail-summary'}
          gap={8}
          role={'button'}
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onToggle();
          }}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {mail.isUnread && <span className={identityStyles.unreadDot} />}
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Text ellipsis fontSize={13} weight={mail.isUnread ? 500 : 400}>
                {sender}
              </Text>
              {outbound && (
                <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'}>
                  {t('identity.inbox.sent')}
                </Text>
              )}
            </Flexbox>
            {expanded ? (
              <Text ellipsis fontSize={12} type={'secondary'}>
                {t('identity.inbox.detail.toLine', { recipients })}
              </Text>
            ) : (
              <Text ellipsis fontSize={12} type={'secondary'}>
                {mail.text}
              </Text>
            )}
          </Flexbox>
          <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'}>
            {when}
          </Text>
          {/* Inside the summary, so a click here must not toggle the mail. */}
          <Flexbox horizontal gap={2} onClick={(event) => event.stopPropagation()}>
            {onToggleStar && (
              <ActionIcon
                active={starred}
                data-testid={'mail-item-star'}
                icon={Star}
                size={'small'}
                aria-label={t(
                  starred ? 'identity.mailbox.action.unstar' : 'identity.mailbox.action.star',
                )}
                title={t(
                  starred ? 'identity.mailbox.action.unstar' : 'identity.mailbox.action.star',
                )}
                onClick={onToggleStar}
              />
            )}
            {menuItems.length > 0 && (
              <DropdownMenu items={menuItems}>
                <ActionIcon
                  aria-label={t('identity.more')}
                  icon={MoreHorizontal}
                  size={'small'}
                  title={t('identity.more')}
                />
              </DropdownMenu>
            )}
          </Flexbox>
        </Flexbox>
        {expanded && (
          <Flexbox gap={12} paddingBlock={'4px 12px'} paddingInline={12}>
            {senderAddress && (
              <Text data-testid={'mail-sender-address'} fontSize={12} type={'secondary'}>
                {t('identity.inbox.detail.from')}: {senderAddress}
              </Text>
            )}
            <MailHtmlBody id={mail.id} text={mail.text ?? ''} />
            {(mail.attachments?.length ?? 0) > 0 && (
              <MailAttachments attachments={mail.attachments} mailId={mail.id} />
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

ConversationMessage.displayName = 'AgentConversationMessage';

export default ConversationMessage;
