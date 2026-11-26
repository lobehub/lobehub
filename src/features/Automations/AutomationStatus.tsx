'use client';

import type { InboundWebhookItem } from '@lobechat/types';
import { Flexbox, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { type ConnectorRef, connectorSettingsPath } from './connectorSettingsPath';
import { type AutomationTone, resolveAutomationStatus } from './status';

const styles = stylex.create({
  // In LiteTable's narrow card layout the value sits at the row's end, across
  // from its label; the tag and the reason follow it there.
  cell: {
    alignItems: { 'default': 'flex-start', '@container (max-width: 800px)': 'flex-end' },
    minInlineSize: 0,
    textAlign: { 'default': 'start', '@container (max-width: 800px)': 'end' },
  },
  link: {
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    textDecorationLine: 'underline',
    textUnderlineOffset: '2px',
  },
  // Wraps, never clamps: the second half of a reason is usually what to do
  // next, and touch screens have no hover to reveal a cut-off line.
  reason: {
    fontSize: '12px',
    lineHeight: 1.5,
    overflowWrap: 'anywhere',
  },
  reasonError: { color: cssVar.colorError },
  reasonWarning: { color: cssVar.colorWarning },
});

const TAG_COLOR: Record<AutomationTone, string | undefined> = {
  default: undefined,
  error: 'error',
  success: 'success',
  warning: 'warning',
};

type StatusItem = Pick<InboundWebhookItem, 'lastError' | 'status'>;

/** The state of a subscription as one tag. */
export const AutomationStatusTag = memo<{ item: StatusItem }>(({ item }) => {
  const { t } = useTranslation('setting');
  const status = resolveAutomationStatus(item);

  return <Tag color={TAG_COLOR[status.tone]}>{t(status.labelKey as any)}</Tag>;
});

AutomationStatusTag.displayName = 'AutomationStatusTag';

interface AutomationStatusReasonProps {
  /** The connector to open when the fix is reconnecting it. */
  connector?: ConnectorRef | null;
  item: StatusItem;
}

/**
 * Why a subscription is in its state and the way out, when something is off;
 * nothing when it is healthy. A credential problem links to that connector's
 * detail, since nothing on the subscription itself fixes it.
 */
export const AutomationStatusReason = memo<AutomationStatusReasonProps>(({ connector, item }) => {
  const { t } = useTranslation('setting');
  const status = resolveAutomationStatus(item);
  if (!status.reasonKey) return null;

  const reason = t(status.reasonKey as any);

  return (
    <span
      {...stylex.props(
        styles.reason,
        status.reasonTone === 'warning' ? styles.reasonWarning : styles.reasonError,
      )}
    >
      {reason}
      {status.remedy === 'reconnect' && (
        <>
          {' '}
          <WorkspaceLink to={connectorSettingsPath(connector)} {...stylex.props(styles.link)}>
            {t('automations.remedy.reconnect')}
          </WorkspaceLink>
        </>
      )}
    </span>
  );
});

AutomationStatusReason.displayName = 'AutomationStatusReason';

/**
 * A subscription's state as a tag, with the reason and the way out beneath it
 * when something is off. The settings list and the conversation's
 * subscription card read the same, both from {@link resolveAutomationStatus}.
 */
const AutomationStatus = memo<{ item: InboundWebhookItem }>(({ item }) => (
  <Flexbox gap={4} {...stylex.props(styles.cell)}>
    <AutomationStatusTag item={item} />
    <AutomationStatusReason connector={item.connector} item={item} />
  </Flexbox>
));

AutomationStatus.displayName = 'AutomationStatus';

export default AutomationStatus;
