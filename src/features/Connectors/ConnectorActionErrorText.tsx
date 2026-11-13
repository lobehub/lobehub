'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleAlert } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { type ConnectorActionError } from '@/utils/connectorActionError';

import { formatConnectorActionError } from './formatConnectorActionError';

const styles = stylex.create({
  error: {
    alignItems: 'flex-start',
    color: cssVar.colorError,
    display: 'flex',
    fontSize: 12,
    gap: 4,
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  icon: {
    flex: 'none',
    marginBlockStart: 3,
  },
});

/**
 * Red, in-place reason of a failed action. It stays where the action was taken,
 * so the user still sees what happened after any toast is gone.
 */
export const InlineErrorText = memo<{ children: ReactNode }>(({ children }) => (
  <div role={'alert'} {...stylex.props(styles.error)}>
    <span {...stylex.props(styles.icon)}>
      <Icon icon={CircleAlert} size={12} />
    </span>
    <span>{children}</span>
  </div>
));

InlineErrorText.displayName = 'InlineErrorText';

interface ConnectorActionErrorTextProps {
  error: ConnectorActionError;
  /** Display name of the connector, used by reasons that name the app. */
  name: string;
}

/** A failed connect / remove of a whole connector, worded for the settings list. */
const ConnectorActionErrorText = memo<ConnectorActionErrorTextProps>(({ error, name }) => {
  const { t } = useTranslation('setting');

  return <InlineErrorText>{formatConnectorActionError(t, error, name)}</InlineErrorText>;
});

ConnectorActionErrorText.displayName = 'ConnectorActionErrorText';

export default ConnectorActionErrorText;
