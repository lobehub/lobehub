'use client';

import { Button, copyToClipboard, Flexbox, Icon, toast, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { SquareArrowOutUpRight } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import ConnectorActionErrorText from '@/features/Connectors/ConnectorActionErrorText';
import { type ConnectorActionError } from '@/utils/connectorActionError';

const styles = stylex.create({
  tooltipAnchor: {
    display: 'inline-flex',
  },
});

interface ConnectorRowDescriptionProps {
  /**
   * The workspace restricted connectors to owners and admins: offer "Ask an
   * admin", so the member knows the integration exists and whom to ask.
   */
  askAdmin?: boolean;
  error?: ConnectorActionError;
  name: string;
}

/**
 * Second line of a connector row: the "Ask an admin" entry and the last failure
 * kept in place. Returns `undefined` when there is nothing to show, so the row
 * keeps its single-line layout.
 */
export const renderConnectorRowDescription = ({
  askAdmin,
  error,
  name,
}: ConnectorRowDescriptionProps): ReactNode => {
  if (!askAdmin && !error) return undefined;

  return (
    <Flexbox gap={2}>
      {askAdmin && <AskAdminButton name={name} />}
      {error && <ConnectorActionErrorText error={error} name={name} />}
    </Flexbox>
  );
};

interface AskAdminButtonProps {
  name: string;
  /** `link` fits the row's second line; `primary` stands next to a full-size Connect. */
  variant?: 'link' | 'primary';
}

/** Copies a ready-to-send request for a workspace owner or admin to connect `name`. */
export const AskAdminButton = memo<AskAdminButtonProps>(({ name, variant = 'link' }) => {
  const { t } = useTranslation('setting');

  const handleAskAdmin = async () => {
    await copyToClipboard(
      t('tools.connectorFeedback.askAdminMessage', { name, url: window.location.href }),
    );
    toast.success(t('tools.connectorFeedback.askAdminCopied'));
  };

  return (
    <Button
      size={'small'}
      style={variant === 'link' ? { flex: 'none', height: 'auto', padding: 0 } : undefined}
      type={variant}
      onClick={handleAskAdmin}
    >
      {t('tools.connectorFeedback.askAdmin')}
    </Button>
  );
});

AskAdminButton.displayName = 'AskAdminButton';

interface DisabledConnectProps {
  size?: 'small' | 'middle';
}

/**
 * The Connect button a member restricted by the workspace policy sees: still
 * visible (so the integration reads as supported) but disabled, with a tooltip
 * saying who can change it.
 */
export const DisabledConnect = memo<DisabledConnectProps>(({ size = 'small' }) => {
  const { t } = useTranslation('setting');

  return (
    <Tooltip title={t('tools.connectorFeedback.manageOnly')}>
      {/* Disabled buttons swallow hover events; the wrapper anchors the tooltip. */}
      <span {...stylex.props(styles.tooltipAnchor)}>
        <Button
          disabled
          icon={<Icon icon={SquareArrowOutUpRight} />}
          size={size}
          type={size === 'small' ? 'text' : 'default'}
        >
          {t('tools.composio.connect')}
        </Button>
      </span>
    </Tooltip>
  );
});

DisabledConnect.displayName = 'DisabledConnect';
