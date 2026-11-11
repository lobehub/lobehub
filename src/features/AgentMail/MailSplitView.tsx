'use client';

import { ActionIcon, Center, Empty, Flexbox, Text } from '@lobehub/ui';
import { ArrowLeft, Mail } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';

import { identityStyles } from './styles';

interface MailSplitViewProps {
  /** The page's main action, beside the title. */
  action?: ReactNode;
  /** A mail being written takes the reading pane. */
  composing?: boolean;
  /** The open conversation, or the composer, shown while either is open. */
  detail: ReactNode;
  inbox: ReactNode;
  mailbox: ReactNode;
  /** The open message; nothing is opened on arrival, because opening clears its unread mark. */
  messageId?: string;
  /** Too narrow for two columns: the list fills the page and the open mail covers it. */
  narrow?: boolean;
  /** Back to the list from what covers it on a narrow page. */
  onBack?: () => void;
}

/** The open mail or composer laid over the list, so back returns to the same scroll. */
const NarrowDetail = ({
  children,
  focusBack,
  onBack,
}: {
  children: ReactNode;
  /** Keyboard focus follows the page that covered the list; a composer focuses its own field. */
  focusBack: boolean;
  onBack?: () => void;
}) => {
  const { t } = useTranslation('setting');
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusBack) backRef.current?.focus({ preventScroll: true });
  }, [focusBack]);

  return (
    <Flexbox className={identityStyles.mobileDetail} data-mail-narrow-detail={''}>
      <Flexbox horizontal align={'center'} flex={'none'} gap={4} height={44} padding={8}>
        <ActionIcon
          aria-label={t('identity.inbox.detail.backToList')}
          data-testid={'mail-narrow-back'}
          icon={ArrowLeft}
          ref={backRef}
          // No tooltip: it would open on the focus given here and swallow the first Esc.
          onClick={onBack}
        />
      </Flexbox>
      <Flexbox flex={1} style={{ minHeight: 0, overflowY: 'auto' }}>
        <Flexbox
          paddingBlock={'0 16px'}
          paddingInline={16}
          style={{ marginInline: 'auto', maxWidth: 800 }}
          width={'100%'}
        >
          {children}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

/** The page title a wide screen shows above the mail, or above the offer to open a mailbox. */
export const MailNavHeader = ({ action }: { action?: ReactNode }) => {
  const { t } = useTranslation('setting');

  return (
    <NavHeader
      right={action}
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
const MailSplitView = ({
  action,
  composing,
  detail,
  inbox,
  mailbox,
  messageId,
  narrow,
  onBack,
}: MailSplitViewProps) => {
  const { t } = useTranslation('setting');

  if (narrow) {
    return (
      <Flexbox flex={1} style={{ minHeight: 0, position: 'relative' }} width={'100%'}>
        <MailNavHeader action={action} />
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
        {(messageId || composing) && (
          <NarrowDetail focusBack={Boolean(messageId)} key={messageId ?? 'compose'} onBack={onBack}>
            {detail}
          </NarrowDetail>
        )}
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal flex={1} style={{ minHeight: 0 }} width={'100%'}>
      {/* The header belongs to the list column, so the message runs to the top of the page. */}
      <div className={identityStyles.listPane}>
        <MailNavHeader action={action} />
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
      <Flexbox
        className={identityStyles.detailPane}
        flex={1}
        key={messageId ?? (composing ? 'compose' : undefined)}
      >
        {messageId || composing ? (
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
