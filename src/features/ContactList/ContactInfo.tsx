'use client';

import { ActionIcon, CopyButton, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MailIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentAccounts } from '@/features/AgentMail/useAgentIdentity';

const styles = stylex.create({
  list: {
    overflow: 'hidden',
    marginBlockStart: '24px',
    borderRadius: '12px',
    width: '100%',
    textAlign: 'start',
    backgroundColor: cssVar.colorFillQuaternary,
  },
  row: {
    paddingBlock: '10px',
    paddingInline: '16px',
  },
  divided: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  label: {
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  value: {
    overflow: 'hidden',
    fontSize: '14px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

/**
 * How to reach an agent outside LobeHub, like the numbers and addresses on a
 * phone contact: today the mail addresses it owns. Absent while loading, on a
 * failed read, and for agents without one, so the card never shows an empty box.
 */
export const ContactInfo = memo<{ agentId: string }>(({ agentId }) => {
  const { t } = useTranslation('common');
  const { data } = useAgentAccounts(agentId);
  const mails = (data ?? []).filter(
    (account) => account.kind === 'mail' && account.status !== 'revoked',
  );

  if (mails.length === 0) return null;

  return (
    <div {...stylex.props(styles.list)}>
      {mails.map((account, index) => (
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          key={account.id}
          {...stylex.props(styles.row, index > 0 && styles.divided)}
        >
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <span {...stylex.props(styles.label)}>{t('contacts.info.mail')}</span>
            <span title={account.identifier} {...stylex.props(styles.value)}>
              {account.identifier}
            </span>
          </Flexbox>
          <CopyButton content={account.identifier} size={'small'} />
          <a aria-label={t('contacts.info.sendMail')} href={`mailto:${account.identifier}`}>
            <ActionIcon icon={MailIcon} size={'small'} title={t('contacts.info.sendMail')} />
          </a>
        </Flexbox>
      ))}
    </div>
  );
});

ContactInfo.displayName = 'ContactInfo';
