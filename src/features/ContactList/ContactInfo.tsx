'use client';

import { ActionIcon, CopyButton, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MailIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentAccounts } from '@/features/AgentMail/useAgentIdentity';

import { contactInfoRows } from './contactInfoRows';

const styles = stylex.create({
  list: {
    overflow: 'hidden',
    marginBlockStart: '8px',
    borderRadius: '12px',
    width: '100%',
    textAlign: 'start',
    backgroundColor: cssVar.colorFillQuaternary,
  },
  row: {
    paddingBlock: '12px',
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
  bio: {
    lineHeight: '22px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
});

const LABELS = {
  bio: 'contacts.info.bio',
  handle: 'contacts.info.handle',
  mail: 'contacts.info.mail',
} as const;

/**
 * The contact's info list, like the username, numbers and bio on a phone contact: its handle,
 * the mail addresses it owns and its bio. Groups pass no `agentId`, since they own no addresses.
 * Rows it has nothing for are left out, so the card never shows an empty box.
 */
export const ContactInfo = memo<{
  agentId?: string;
  description?: string | null;
  slug?: string | null;
}>(({ agentId, description, slug }) => {
  const { t } = useTranslation('common');
  const { data } = useAgentAccounts(agentId ?? '');
  const rows = contactInfoRows({ accounts: data, description, slug });

  if (rows.length === 0) return null;

  return (
    <div {...stylex.props(styles.list)}>
      {rows.map((row, index) => (
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          key={row.key}
          {...stylex.props(styles.row, index > 0 && styles.divided)}
        >
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <span {...stylex.props(styles.label)}>{t(LABELS[row.kind])}</span>
            {row.kind === 'bio' ? (
              <span {...stylex.props(styles.value, styles.bio)}>{row.value}</span>
            ) : (
              <span title={row.value} {...stylex.props(styles.value)}>
                {row.value}
              </span>
            )}
          </Flexbox>
          {row.kind !== 'bio' && <CopyButton content={row.value} size={'small'} />}
          {row.kind === 'mail' && (
            <a aria-label={t('contacts.info.sendMail')} href={`mailto:${row.value}`}>
              <ActionIcon icon={MailIcon} size={'small'} title={t('contacts.info.sendMail')} />
            </a>
          )}
        </Flexbox>
      ))}
    </div>
  );
});

ContactInfo.displayName = 'ContactInfo';
