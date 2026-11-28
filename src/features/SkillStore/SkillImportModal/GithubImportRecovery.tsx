import type { TaskTemplateConnectorReference } from '@lobechat/const';
import { Alert, Button, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { ArrowUpRight, LockKeyhole } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineErrorText from '@/components/InlineErrorText';
import { type InlineErrorState, toInlineError } from '@/components/InlineErrorText/errorDetail';
import {
  ConnectorConnectionMarketAuthRequiredError,
  ConnectorConnectionPopupBlockedError,
  useConnectorConnection,
} from '@/features/RecommendTaskTemplates/useConnectorConnection';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { usePermission } from '@/hooks/usePermission';

const github: TaskTemplateConnectorReference[] = [{ identifier: 'github', source: 'lobehub' }];

interface GithubImportRecoveryProps {
  onConnected: () => void;
  recovery: 'access' | 'connect';
}

export const GithubImportRecovery = ({ recovery, onConnected }: GithubImportRecoveryProps) => {
  const { t } = useTranslation(['setting', 'common', 'error']);
  const create = usePermission('create_content');
  const edit = usePermission('edit_own_content');
  const { connect, isConnecting, isAllConnected } = useConnectorConnection(github);
  const startedHere = useRef(false);
  const [connectError, setConnectError] = useState<InlineErrorState | null>(null);

  useEffect(() => {
    if (startedHere.current && isAllConnected) {
      startedHere.current = false;
      onConnected();
    }
  }, [isAllConnected, onConnected]);

  const authorize = async () => {
    startedHere.current = true;
    setConnectError(null);
    try {
      await connect();
    } catch (error) {
      startedHere.current = false;
      if (error instanceof ConnectorConnectionMarketAuthRequiredError) return;
      console.error('[GithubImportRecovery] Failed to connect GitHub:', error);
      setConnectError(
        toInlineError(
          t(
            error instanceof ConnectorConnectionPopupBlockedError
              ? 'common:taskTemplate.action.connect.popupBlocked'
              : 'agentSkillModal.github.connectFailedRetry',
          ),
          error,
        ),
      );
    }
  };

  const showSettings = recovery === 'access' || isAllConnected;
  return (
    <Flexbox gap={8}>
      <Alert
        icon={LockKeyhole}
        title={t(showSettings ? 'error:import.github.access' : 'error:import.github.connect')}
        type="warning"
        action={
          showSettings ? (
            <WorkspaceLink
              rel="noopener noreferrer"
              target="_blank"
              to="/settings/connector?open=lobehub-connector%3Agithub"
            >
              <Flexbox horizontal align="center" as="span" gap={4}>
                {t('agentSkillModal.github.connectionSettings')}
                <Icon icon={ArrowUpRight} size={14} />
              </Flexbox>
            </WorkspaceLink>
          ) : (
            <Tooltip title={create.reason ?? edit.reason}>
              <Button
                disabled={!create.allowed || !edit.allowed}
                loading={isConnecting}
                onClick={authorize}
              >
                {t('environments.github.connect')}
              </Button>
            </Tooltip>
          )
        }
      />
      {connectError && (
        <InlineErrorText detail={connectError.detail}>{connectError.summary}</InlineErrorText>
      )}
    </Flexbox>
  );
};
