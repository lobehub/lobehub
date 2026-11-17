import { agentDisplayName } from '@lobechat/types';
import { Alert, Button, Flexbox, Segmented, Text } from '@lobehub/ui';
import { ArrowLeftRightIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDetail } from '@/store/project';

import { getProjectSettingsPath } from '../Layout/navigation';
import { CoordinatorAgentBinding, CoordinatorAgentEditor } from './AgentEditorScope';
import { CoordinatorBasicSettings } from './BasicSettings';
import { CoordinatorChannelSettings } from './ChannelSettings';
import type { ProjectCoordinatorConfig } from './useCoordinatorConfig';
import { useCoordinatorConfig } from './useCoordinatorConfig';
import { COORDINATOR_SETTINGS_VIEWS, isCoordinatorSettingsView } from './views';

/** Who else a write here reaches, per the source the project resolves (design T-14322 §f.1). */
const SourceNotice = ({
  config,
  detail,
}: {
  config: ProjectCoordinatorConfig;
  detail: ProjectDetail;
}) => {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const name = agentDisplayName(
    { title: config.config.title ?? undefined },
    t('defaultAgent', { ns: 'common' }),
  );
  const replace = (
    <Button
      icon={ArrowLeftRightIcon}
      size="small"
      onClick={() => navigate(getProjectSettingsPath(detail.project.id, 'members'))}
    >
      {t('members.replaceCoordinator')}
    </Button>
  );

  switch (config.source) {
    case 'owned': {
      return null;
    }
    case 'shared': {
      return (
        <Alert
          showIcon
          action={replace}
          title={t('coordinator.source.shared', { count: config.sharedWithProjectIds.length })}
          type="warning"
        />
      );
    }
    case 'user_picked': {
      return (
        <Alert
          showIcon
          action={replace}
          title={t('coordinator.source.userPicked', { name })}
          type="info"
        />
      );
    }
    case 'builtin': {
      return (
        <Alert showIcon action={replace} title={t('coordinator.source.builtin')} type="info" />
      );
    }
  }
};

/**
 * Project settings → Main agent: the single entry for the coordinator's prompt,
 * model and parameters, identity, opening, IM channels, tools, skills,
 * knowledge and environment. Reads and writes go through the project
 * (`project.getCoordinatorConfig` / `updateCoordinatorConfig`), so what shows
 * here is the configuration the project resolves after the ownership backfill.
 */
export const ProjectCoordinatorSettings = ({
  canManage,
  detail,
}: {
  canManage: boolean;
  detail: ProjectDetail;
}) => {
  const { t } = useTranslation('project');
  const projectId = detail.project.id;
  const { data, error, isLoading, mutate } = useCoordinatorConfig(projectId);
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const view = isCoordinatorSettingsView(viewParam) ? viewParam : 'basic';
  const platform = searchParams.get('platform') ?? undefined;

  // IM connections are written on the channel page; read them back fresh on return.
  useEffect(() => {
    if (view === 'basic') mutate();
  }, [mutate, view]);

  const setView = (next: string, nextPlatform?: string) => {
    const params = new URLSearchParams();
    if (next !== 'basic') params.set('view', next);
    if (nextPlatform) params.set('platform', nextPlatform);
    setSearchParams(params);
  };

  // LobeAI is everyone's assistant: read-only from a project (design §d.3 ii).
  const disabled = !canManage || !data?.editable;

  return (
    <Flexbox gap={20}>
      <Flexbox gap={6}>
        <Text fontSize={16} weight={600}>
          {t('coordinator.title')}
        </Text>
        <Text type="secondary">{t('coordinator.description')}</Text>
      </Flexbox>
      <AsyncBoundary
        data={data}
        error={error}
        errorVariant={'block'}
        isLoading={isLoading}
        loading={<RouteLoading />}
        onRetry={() => mutate()}
      >
        {data && (
          <Flexbox gap={20} key={data.agentId}>
            <SourceNotice config={data} detail={detail} />
            {!canManage && <Alert showIcon title={t('coordinator.readOnly')} type="info" />}
            <Segmented
              value={view}
              options={COORDINATOR_SETTINGS_VIEWS.map((key) => ({
                label: t(`coordinator.view.${key}`),
                value: key,
              }))}
              onChange={(value) => setView(String(value))}
            />
            {view === 'basic' ? (
              <CoordinatorBasicSettings
                config={data}
                disabled={disabled}
                projectId={projectId}
                onOpenChannels={() => setView('channel')}
              />
            ) : view === 'channel' ? (
              <CoordinatorAgentBinding agentId={data.agentId}>
                <CoordinatorChannelSettings
                  agentId={data.agentId}
                  disabled={disabled}
                  platform={platform}
                  onSelectPlatform={(next) => setView('channel', next)}
                />
              </CoordinatorAgentBinding>
            ) : disabled ? (
              <Alert showIcon title={t('coordinator.readOnly')} type="info" />
            ) : (
              <CoordinatorAgentEditor agentId={data.agentId} view={view} />
            )}
          </Flexbox>
        )}
      </AsyncBoundary>
    </Flexbox>
  );
};
