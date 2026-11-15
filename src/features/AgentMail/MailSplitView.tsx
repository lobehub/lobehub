'use client';

import { Center, Empty, Flexbox, Text } from '@lobehub/ui';
import { Mail } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';

import { identityStyles } from './styles';

interface MailSplitViewProps {
  /** The open conversation, shown while `messageId` is set. */
  detail: ReactNode;
  inbox: ReactNode;
  mailbox: ReactNode;
  /** The open message; nothing is opened on arrival, because opening clears its unread mark. */
  messageId?: string;
}

/** The page title a wide screen shows above the mail, or above the offer to open a mailbox. */
export const MailNavHeader = () => {
  const { t } = useTranslation('setting');

  return (
    <NavHeader
      styles={{ left: { minWidth: 0, paddingInlineStart: 8 } }}
      left={
        <Text fontSize={14} weight={500}>
          {t('identity.mail.title')}
        </Text>
      }
    />
  );
};

/** The mail page on a wide screen: mailbox and list on the left, the open message on the right. */
const MailSplitView = ({ detail, inbox, mailbox, messageId }: MailSplitViewProps) => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox horizontal flex={1} style={{ minHeight: 0 }} width={'100%'}>
      {/* The header belongs to the list column, so the message runs to the top of the page. */}
      <div className={identityStyles.listPane}>
        <MailNavHeader />
        <Flexbox
          flex={1}
          gap={16}
          paddingBlock={'0 12px'}
          paddingInline={12}
          style={{ minHeight: 0 }}
        >
          <div className={identityStyles.accounts}>{mailbox}</div>
          {inbox}
        </Flexbox>
      </div>
      {/* Keyed so the next message starts at its top, not at the last scroll offset. */}
      <Flexbox className={identityStyles.detailPane} flex={1} key={messageId}>
        {messageId ? (
          // The sticky toolbar sits at the top, so the pane needs no header clearance.
          <Flexbox
            paddingBlock={'12px 16px'}
            paddingInline={16}
            style={{ marginInline: 'auto', maxWidth: 800 }}
            width={'100%'}
          >
            {detail}
          </Flexbox>
        ) : (
          <Center height={'100%'}>
            <Empty description={t('identity.inbox.detail.placeholder')} icon={Mail} />
          </Center>
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default MailSplitView;
