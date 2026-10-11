'use client';

import { environmentKind } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { ActionIcon, Avatar, Tabs, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import {
  ContainerIcon,
  FolderIcon,
  HistoryIcon,
  KeyRoundIcon,
  LayersIcon,
  LayoutDashboardIcon,
  LockIcon,
  SettingsIcon,
  XIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type CopyTab, copyTabs, resolveDetailTab } from './detailTabs';
import EnvironmentForm, { type EnvironmentFormSection } from './EnvironmentForm';
import InstanceSection from './InstanceSection';
import { repositoryPath } from './repository';
import SessionHistorySection from './SessionHistorySection';
import TabPane from './TabPane';
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
  /** The same dot the row uses between its facts. */
  metaDivider: css`
    flex: none;

    width: 3px;
    height: 3px;
    border-radius: 50%;

    background: ${cssVar.colorTextQuaternary};
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
}));

type DetailTab = CopyTab | EnvironmentFormSection;

interface EnvironmentDetailPanelProps {
  environment: SandboxEnvironment;
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
const EnvironmentDetailPanel = memo<EnvironmentDetailPanelProps>(({ environment, onClose }) => {
  const { t } = useTranslation('setting');
  const actions = useEnvironmentActions();
  const { data } = useInstances();
  const canEdit = useCanEditEnvironment()(environment);
  // Local to the panel and reset with it (the panel is keyed on the
  // environment), so opening another environment lands on its first tab.
  const [picked, setTab] = useState<DetailTab>();

  const repository = repositoryPath(environment.configuration);
  // A files environment is a folder: there is no repository, setup or runtime
  // to configure, so the panel keeps its name, description and files and
  // drops the tabs and fields that would only ever be empty.
  const kind = environmentKind(environment);
  const creator =
    environment.creator?.fullName ||
    environment.creator?.username ||
    t('environments.meta.unknownCreator');
  const instanceCount = (data?.instances ?? []).filter(
    (instance) => instance.environmentId === environment.id,
  ).length;
  const copies = copyTabs(instanceCount);
  const tab: DetailTab = resolveDetailTab(picked, instanceCount);

  return (
    <Flexbox className={styles.container} gap={20}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={12}>
        <span className={styles.iconTile}>
          {repository ? (
            <Github size={18} />
          ) : (
            <Icon icon={kind === 'files' ? FolderIcon : ContainerIcon} size={18} />
          )}
        </span>
        <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
          <Text ellipsis weight={600}>
            {environment.name}
          </Text>
          {/* One line of facts under the name, the way the row does it,
                rather than a labelled block of its own below the header: who
                made it and when are context for the name, not fields to
                fill in. The absolute time here, the relative one in the row:
                the list is scanned for "is this recent", the panel is read
                for "when". */}
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            <Tag size={'small'}>{t(`environments.kind.${kind}`)}</Tag>
            <Tag size={'small'}>
              {instanceCount === 0
                ? t('environments.instances.empty')
                : t('environments.instances.count', { count: instanceCount })}
            </Tag>
            {environment.workspaceId && environment.visibility === 'public' && (
              <Tag size={'small'}>{t('environments.visibility.publicTag')}</Tag>
            )}
            <Flexbox horizontal align={'center'} gap={6}>
              {/* Name as the avatar value — see EnvironmentItem for why `title` alone does not reach the fallback text. */}
              <Avatar avatar={environment.creator?.avatar || creator} size={16} title={creator} />
              <Text fontSize={12} type={'secondary'}>
                {creator}
              </Text>
            </Flexbox>
            <span className={styles.metaDivider} />
            {/* The same relative phrasing as the row, so the panel does not
                  answer "when" in a different voice; the exact instant is a
                  hover away. */}
            <Tooltip title={new Date(environment.createdAt).toLocaleString()}>
              <Text fontSize={12} type={'secondary'}>
                {t('environments.meta.createdAt', {
                  time: dayjs(environment.createdAt).fromNow(),
                })}
              </Text>
            </Tooltip>
          </Flexbox>
        </Flexbox>
        <ActionIcon
          icon={XIcon}
          size={'small'}
          title={t('environments.detail.close')}
          onClick={onClose}
        />
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

      {/* The copies and their run history are what everyone with access
            comes here for; variables and settings reshape the environment,
            which only its editor may do, so a read-only panel keeps those and
            drops the rest. */}
      <Tabs
        activeKey={tab}
        items={[
          ...(copies.includes('overview')
            ? [
                {
                  icon: <Icon icon={LayoutDashboardIcon} size={16} />,
                  key: 'overview',
                  label: t('environments.detail.tabs.overview'),
                },
              ]
            : [
                {
                  icon: <Icon icon={LayersIcon} size={16} />,
                  key: 'instances',
                  label: t('environments.instances.title'),
                },
                {
                  icon: <Icon icon={HistoryIcon} size={16} />,
                  key: 'sessions',
                  label: t('environments.sessions.title'),
                },
              ]),
          ...(canEdit
            ? [
                ...(kind === 'code'
                  ? [
                      {
                        icon: <Icon icon={KeyRoundIcon} size={16} />,
                        key: 'variables',
                        label: t('environments.form.env'),
                      },
                    ]
                  : []),
                {
                  icon: <Icon icon={SettingsIcon} size={16} />,
                  key: 'settings',
                  label: t('environments.detail.tabs.settings'),
                },
              ]
            : []),
        ]}
        onChange={(key) => setTab(key as DetailTab)}
      />

      {/* One column with no gap: the settings rail is drawn by each of its
            sections and meets the next one's icon exactly, so any space
            between them would show as a break in the line. */}
      <Flexbox>
        {/* The one copy, as the environment itself: its build state (a code
            environment's only — a files one has nothing to build), its files
            and what ran in it, without a list of one to click through. */}
        {tab === 'overview' && (
          <TabPane>
            <InstanceSection single editable={canEdit} environmentId={environment.id} kind={kind} />
            <Flexbox gap={8}>
              <Text weight={500}>{t('environments.sessions.title')}</Text>
              <Text fontSize={12} type={'secondary'}>
                {t('environments.sessions.desc')}
              </Text>
              <SessionHistorySection environmentId={environment.id} />
            </Flexbox>
          </TabPane>
        )}

        {tab === 'instances' && (
          <TabPane desc={t('environments.instances.desc')}>
            <InstanceSection editable={canEdit} environmentId={environment.id} kind={kind} />
          </TabPane>
        )}

        {tab === 'sessions' && (
          <TabPane desc={t('environments.sessions.desc')}>
            <SessionHistorySection environmentId={environment.id} />
          </TabPane>
        )}

        {/* Every field saves itself, so nothing is lost by unmounting the
              form on a tab switch and each tab mounts only what it shows. */}
        {canEdit && (tab === 'variables' || tab === 'settings') && (
          <EnvironmentForm
            environment={environment}
            kind={kind}
            section={tab}
            onSave={(changes) => actions.updateEnvironment({ ...changes, id: environment.id })}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
});

EnvironmentDetailPanel.displayName = 'EnvironmentDetailPanel';

export default EnvironmentDetailPanel;
