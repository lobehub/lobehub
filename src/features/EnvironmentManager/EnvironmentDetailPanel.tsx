'use client';

import { Github } from '@lobehub/icons';
import { ActionIcon, Flexbox, Icon, Tabs, Tag, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import {
  FolderGit2Icon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LockIcon,
  SettingsIcon,
  TerminalIcon,
  XIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/components/UserAvatar';

import EnvironmentForm, { type EnvironmentFormSection } from './EnvironmentForm';
import PanelSection from './PanelSection';
import { repositoryPath } from './repository';
import TabPane from './TabPane';
import { useCanEditEnvironment } from './useCanEditEnvironment';
import { type SandboxEnvironment, useEnvironmentActions } from './useEnvironmentData';

const styles = stylex.create({
  container: { paddingBlock: '16px', paddingInline: '20px' },
  header: {
    paddingBlockEnd: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  metaDivider: {
    flex: 'none',
    width: '3px',
    height: '3px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorTextQuaternary,
    backgroundImage: 'none',
  },
  iconTile: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

type DetailTab = 'overview' | EnvironmentFormSection;

interface EnvironmentDetailPanelProps {
  environment: SandboxEnvironment;
  onClose: () => void;
}

/**
 * Everything one environment is, beside the list it was picked from.
 *
 * The list answers which environment; this answers what it holds — who made it,
 * which repository it checks out and what setup runs after. An environment is
 * a one-time initializer and keeps no copies, so there is nothing else to show.
 * Its editor gets the definition to change; everyone else who can use it reads
 * what it will do. Splitting it this way is what lets the row stay scannable:
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
  const canEdit = useCanEditEnvironment()(environment);
  // Local to the panel and reset with it (the panel is keyed on the
  // environment), so opening another environment lands on its first tab.
  const [picked, setTab] = useState<DetailTab>();
  // An editor works in the definition; a reader only has the summary.
  const tab: DetailTab = canEdit ? (picked === 'variables' ? 'variables' : 'settings') : 'overview';
  const configuration = environment.configuration ?? {};
  const repository = repositoryPath(configuration);

  const creator =
    environment.creator?.fullName ||
    environment.creator?.username ||
    t('environments.meta.unknownCreator');

  return (
    <Flexbox className={stylex.props(styles.container).className} gap={20}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
        gap={12}
      >
        <span className={stylex.props(styles.iconTile).className}>
          <Github size={18} />
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

      <Tabs
        activeKey={tab}
        styles={{ list: { maxWidth: '100%', overflowX: 'auto' } }}
        items={
          canEdit
            ? [
                {
                  icon: <Icon icon={SettingsIcon} size={16} />,
                  key: 'settings',
                  label: t('environments.detail.tabs.settings'),
                },
                {
                  icon: <Icon icon={KeyRoundIcon} size={16} />,
                  key: 'variables',
                  label: t('environments.form.env'),
                },
              ]
            : [
                {
                  icon: <Icon icon={LayoutDashboardIcon} size={16} />,
                  key: 'overview',
                  label: t('environments.detail.tabs.overview'),
                },
              ]
        }
        onChange={(key) => setTab(key as DetailTab)}
      />

      {/* One column with no gap: the settings rail is drawn by each of its
            sections and meets the next one's icon exactly, so any space
            between them would show as a break in the line. */}
      <Flexbox>
        {tab === 'overview' && (
          <TabPane desc={t('environments.detail.initializerDesc')}>
            <PanelSection icon={FolderGit2Icon} title={t('environments.form.sources')}>
              <Text fontSize={13}>{repository ?? t('environments.detail.noRepository')}</Text>
            </PanelSection>
            <PanelSection last icon={TerminalIcon} title={t('environments.form.bootstrap')}>
              <Text code={!!configuration.bootstrapCommand} fontSize={13}>
                {configuration.bootstrapCommand || t('environments.detail.noSetup')}
              </Text>
            </PanelSection>
          </TabPane>
        )}

        {/* Every field saves itself, so nothing is lost by unmounting the
              form on a tab switch and each tab mounts only what it shows. */}
        {canEdit && (tab === 'variables' || tab === 'settings') && (
          <EnvironmentForm
            environment={environment}
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
