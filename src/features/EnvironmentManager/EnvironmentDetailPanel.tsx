'use client';

import { Github } from '@lobehub/icons';
import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Avatar, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ContainerIcon, LockIcon, XIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import EnvironmentForm from './EnvironmentForm';
import InstanceSection from './InstanceSection';
import { repositoryPath } from './repository';
import { useCanEditEnvironment } from './useCanEditEnvironment';
import { type SandboxEnvironment, useEnvironmentActions, useInstances } from './useEnvironmentData';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    padding-block: 16px;
    padding-inline: 20px;
  `,
  header: css`
    padding-block-end: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  iconTile: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  section: css`
    padding-block-start: 20px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

/** Section label — one treatment for every field heading in the panel. */
const FieldLabel = memo<{ children: ReactNode }>(({ children }) => (
  <Text fontSize={12} type={'secondary'} weight={500}>
    {children}
  </Text>
));

FieldLabel.displayName = 'EnvironmentFieldLabel';

interface EnvironmentDetailPanelProps {
  /** Open with the instance-create form showing — the row's shortcut lands here. */
  adding: boolean;
  environment: SandboxEnvironment;
  onAddingChange: (adding: boolean) => void;
  onClose: () => void;
}

/**
 * Everything one environment is, beside the list it was picked from.
 *
 * The list answers which environment; this answers what it holds — who made it,
 * what it builds from, what runs before a conversation starts, and which
 * instances exist. Splitting it this way is what lets the row stay scannable:
 * a setup command is worth reading about one environment and worth nothing when
 * comparing six.
 *
 * Read by id from the list rather than handed a snapshot: the form writes
 * through to the same SWR entry, so a copy taken at open time would go stale
 * the moment someone saved.
 */
const EnvironmentDetailPanel = memo<EnvironmentDetailPanelProps>(
  ({ adding, environment, onAddingChange, onClose }) => {
    const { t } = useTranslation('setting');
    const actions = useEnvironmentActions();
    const { data } = useInstances();
    const canEdit = useCanEditEnvironment()(environment);

    const repository = repositoryPath(environment.configuration);
    const creator =
      environment.creator?.fullName ||
      environment.creator?.username ||
      t('environments.meta.unknownCreator');
    const instanceCount = (data?.instances ?? []).filter(
      (instance) => instance.environmentId === environment.id,
    ).length;

    return (
      <Flexbox className={styles.container} gap={20}>
        <Flexbox horizontal align={'center'} className={styles.header} gap={12}>
          <span className={styles.iconTile}>
            {repository ? <Github size={18} /> : <Icon icon={ContainerIcon} size={18} />}
          </span>
          <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
            <Text ellipsis weight={600}>
              {environment.name}
            </Text>
            <Flexbox horizontal align={'center'} gap={8}>
              <Tag size={'small'}>
                {instanceCount === 0
                  ? t('environments.instances.empty')
                  : t('environments.instances.count', { count: instanceCount })}
              </Tag>
              {environment.workspaceId && environment.visibility === 'public' && (
                <Tag size={'small'}>{t('environments.visibility.publicTag')}</Tag>
              )}
            </Flexbox>
          </Flexbox>
          <ActionIcon
            icon={XIcon}
            size={'small'}
            title={t('environments.detail.close')}
            onClick={onClose}
          />
        </Flexbox>

        <Flexbox horizontal gap={32}>
          <Flexbox gap={8}>
            <FieldLabel>{t('environments.meta.creator')}</FieldLabel>
            <Flexbox horizontal align={'center'} gap={8}>
              <Avatar avatar={environment.creator?.avatar ?? undefined} size={24} />
              <Text>{creator}</Text>
            </Flexbox>
          </Flexbox>
          <Flexbox gap={8}>
            <FieldLabel>{t('environments.meta.created')}</FieldLabel>
            {/* The absolute time here, the relative one in the row: the list is
                scanned for "is this recent", the panel is read for "when". */}
            <Text>{new Date(environment.createdAt).toLocaleString()}</Text>
          </Flexbox>
        </Flexbox>

        {/* Said plainly, rather than letting someone discover it by typing into
            a field whose save would be refused. A published environment is one
            you can run in; reshaping it stays with whoever made it. */}
        {!canEdit && (
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon icon={LockIcon} size={14} style={{ color: cssVar.colorTextTertiary }} />
            <Text fontSize={12} type={'secondary'}>
              {t('environments.visibility.readonlyHint')}
            </Text>
          </Flexbox>
        )}

        <Flexbox className={styles.section}>
          <InstanceSection
            adding={adding}
            editable={canEdit}
            environmentId={environment.id}
            onAddingChange={onAddingChange}
          />
        </Flexbox>

        {canEdit && (
          <Flexbox className={styles.section}>
            <EnvironmentForm
              environment={environment}
              onSave={({ configuration, description, name }) =>
                actions.updateEnvironment({ configuration, description, id: environment.id, name })
              }
            />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

EnvironmentDetailPanel.displayName = 'EnvironmentDetailPanel';

export default EnvironmentDetailPanel;
