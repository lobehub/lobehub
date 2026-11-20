'use client';

import type { EnvironmentVisibility } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { Button, Empty, Flexbox, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { ArrowLeftIcon, ContainerIcon, LockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import UserAvatar from '@/components/UserAvatar';

import EnvironmentForm from './EnvironmentForm';
import EnvironmentSummary from './EnvironmentSummary';
import { EnvironmentDefinitionSkeleton } from './Skeleton';
import { useCanEditEnvironment } from './useCanEditEnvironment';
import { useEnvironmentActions, useEnvironments } from './useEnvironmentData';

const styles = stylex.create({
  header: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    paddingBlockEnd: 20,
  },
  /** The same dot the row uses between its facts. */
  metaDivider: {
    backgroundColor: cssVar.colorTextQuaternary,
    borderRadius: '50%',
    flex: 'none',
    height: 3,
    width: 3,
  },
  iconTile: {
    alignItems: 'center',
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextSecondary,
    display: 'flex',
    flex: 'none',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
});

interface EnvironmentDetailPageProps {
  environmentId: string;
  /** Back to the list this environment was opened from. */
  onBack: () => void;
  /** Workspace pages: the pool the environment is in. */
  visibility?: EnvironmentVisibility;
}

/**
 * One environment, on a page of its own (`environments/:id`): who made it,
 * then its whole definition laid out flat — no tabs, no card around it. Its
 * editor edits in place; everyone else reads what it will do. The same form a
 * project's environment page shows.
 *
 * Read by id from the list rather than handed a snapshot: the form writes
 * through to the same replica entry, so a copy taken at open time would go
 * stale the moment someone saved.
 */
const EnvironmentDetailPage = memo<EnvironmentDetailPageProps>(
  ({ environmentId, onBack, visibility }) => {
    const { t } = useTranslation('setting');
    const actions = useEnvironmentActions();
    const { environments, error, revalidate, settled } = useEnvironments(visibility);
    const environment = environments?.find((item) => item.id === environmentId);
    const canEditEnvironment = useCanEditEnvironment();
    const canEdit = environment ? canEditEnvironment(environment) : false;

    const back = (
      <Flexbox horizontal>
        <Button icon={<Icon icon={ArrowLeftIcon} />} size={'small'} type={'text'} onClick={onBack}>
          {t('environments.detail.back')}
        </Button>
      </Flexbox>
    );

    if (!environment) {
      if (error && !settled)
        return (
          <Flexbox gap={16}>
            {back}
            <AsyncError error={error} onRetry={() => revalidate()} />
          </Flexbox>
        );
      return (
        <Flexbox gap={16}>
          {back}
          {settled ? (
            <Empty icon={ContainerIcon} title={t('environments.detail.notFound')} />
          ) : (
            <EnvironmentDefinitionSkeleton />
          )}
        </Flexbox>
      );
    }

    // A row restored from storage has no configuration until the server
    // answers: it carries `env`, so it is never stored. The definition waits
    // for it rather than reading as empty — an editor saving over `{}` would
    // erase it.
    const configurationPending = environment.configuration === undefined;
    const creator =
      environment.creator?.fullName ||
      environment.creator?.username ||
      t('environments.meta.unknownCreator');

    return (
      <Flexbox gap={24}>
        {back}
        <Flexbox horizontal align={'center'} gap={12} {...stylex.props(styles.header)}>
          <span {...stylex.props(styles.iconTile)}>
            <Github size={20} />
          </span>
          <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
            <Text ellipsis fontSize={18} weight={600}>
              {environment.name}
            </Text>
            <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
              {environment.workspaceId && environment.visibility === 'public' && (
                <Tag size={'small'}>{t('environments.visibility.publicTag')}</Tag>
              )}
              <Flexbox horizontal align={'center'} gap={6}>
                <UserAvatar avatar={environment.creator?.avatar} name={creator} size={16} />
                <Text fontSize={12} type={'secondary'}>
                  {creator}
                </Text>
              </Flexbox>
              <span {...stylex.props(styles.metaDivider)} />
              <Tooltip title={new Date(environment.createdAt).toLocaleString()}>
                <Text fontSize={12} type={'secondary'}>
                  {t('environments.meta.createdAt', {
                    time: dayjs(environment.createdAt).fromNow(),
                  })}
                </Text>
              </Tooltip>
            </Flexbox>
          </Flexbox>
        </Flexbox>

        {/* Said plainly, rather than letting someone discover it by typing
            into a field whose save would be refused. */}
        {!canEdit && (
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon icon={LockIcon} size={14} style={{ color: cssVar.colorTextTertiary }} />
            <Text fontSize={12} type={'secondary'}>
              {t('environments.visibility.readonlyHint')}
            </Text>
          </Flexbox>
        )}

        {configurationPending ? (
          <EnvironmentDefinitionSkeleton />
        ) : canEdit ? (
          <EnvironmentForm
            environment={environment}
            onSave={(changes) => actions.updateEnvironment({ ...changes, id: environment.id })}
          />
        ) : (
          <EnvironmentSummary environment={environment} />
        )}
      </Flexbox>
    );
  },
);

EnvironmentDetailPage.displayName = 'EnvironmentDetailPage';

export default EnvironmentDetailPage;
