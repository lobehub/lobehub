'use client';

import {
  ActionIcon,
  Avatar,
  Block,
  confirmModal,
  createModal,
  createStaticStyles,
  cssVar,
  DropdownMenu,
  Flexbox,
  Icon,
  Tag,
  toast,
} from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { t as translate } from 'i18next';
import { DownloadIcon, Loader2, MoreHorizontalIcon, Plus, Trash2 } from 'lucide-react';
import { lazy, memo, Suspense, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createSkillDetailModal } from '@/features/CommunitySkillDetail';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { usePermission } from '@/hooks/usePermission';
import { discoverService } from '@/services/discover';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';
import { type DiscoverSkillItem } from '@/types/discover';
import { downloadFile } from '@/utils/client/downloadFile';
import { isModifierClick } from '@/utils/navigation';

import { itemStyles } from '../style';

const MarketSkillDetail = lazy(() => import('../MarketSkills/MarketSkillDetail'));

const styles = createStaticStyles(({ css }) => ({
  title: css`
    cursor: pointer;

    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
}));

const openMarketSkillDetailModal = (identifier: string) =>
  createModal({
    content: (
      <Suspense fallback={<div style={{ height: '100%' }} />}>
        <MarketSkillDetail identifier={identifier} />
      </Suspense>
    ),
    footer: null,
    styles: { content: { height: 'calc(100dvh - 200px)', overflow: 'hidden', padding: 0 } },
    title: translate('dev.title.skillDetails', { ns: 'plugin' }),
    width: 960,
  });

const MarketSkillItem = memo<DiscoverSkillItem & { community?: boolean }>(
  ({ name, icon, description, identifier, community }) => {
    const { t } = useTranslation('plugin');
    const { t: tc } = useTranslation('common');
    const [installing, setInstalling] = useState(false);
    const [loading, setLoading] = useState(false);
    const { allowed: canCreate } = usePermission('create_content');
    const { allowed: canEdit } = usePermission('edit_own_content');

    const installed = useToolStore(agentSkillsSelectors.isAgentSkill(identifier));
    const installedSkill = useToolStore(agentSkillsSelectors.getAgentSkillByIdentifier(identifier));
    const [refreshAgentSkills, deleteAgentSkill] = useToolStore((s) => [
      s.refreshAgentSkills,
      s.deleteAgentSkill,
    ]);

    const handleInstall = useCallback(async () => {
      if (!canCreate || installing || installed) return;
      setInstalling(true);
      try {
        await agentSkillService.importFromMarket(identifier);
        await refreshAgentSkills();
      } catch {
        toast.error(t('error.installError', { name }));
      } finally {
        setInstalling(false);
      }
    }, [canCreate, identifier, installing, installed, refreshAgentSkills, name, t]);

    const handleUninstall = useCallback(() => {
      if (!canEdit || !installedSkill) return;
      confirmModal({
        cancelText: tc('cancel'),
        content: t('store.actions.confirmUninstall'),
        okButtonProps: { danger: true },
        okText: t('store.actions.uninstall'),
        onOk: async () => {
          await deleteAgentSkill(installedSkill.id);
        },
        title: t('store.actions.uninstall'),
      });
    }, [canEdit, installedSkill, deleteAgentSkill, t, tc]);

    const handleDownload = useCallback(async () => {
      if (!installedSkill?.zipFileHash) return;
      setLoading(true);
      try {
        const result = await agentSkillService.getZipUrl(installedSkill.id);
        if (result.url) {
          await downloadFile(result.url, `${result.name || name}.zip`);
        }
      } finally {
        setLoading(false);
      }
    }, [installedSkill, name]);

    const renderAction = () => {
      if (installed) {
        return (
          <DropdownMenu
            nativeButton={false}
            placement="bottomRight"
            items={[
              ...(installedSkill?.zipFileHash
                ? [
                    {
                      icon: <Icon icon={DownloadIcon} />,
                      key: 'download',
                      label: tc('download'),
                      onClick: handleDownload,
                    },
                    { type: 'divider' as const },
                  ]
                : []),
              {
                danger: true,
                disabled: !canEdit,
                icon: <Icon icon={Trash2} />,
                key: 'uninstall',
                label: t('store.actions.uninstall'),
                onClick: handleUninstall,
              },
            ]}
          >
            <ActionIcon
              aria-label={t('connectorMarket.action.manage', { ns: 'setting' })}
              disabled={!canEdit}
              icon={MoreHorizontalIcon}
              loading={loading}
            />
          </DropdownMenu>
        );
      }

      if (installing)
        return <ActionIcon loading aria-label={t('store.actions.install')} icon={Loader2} />;

      return (
        <ActionIcon
          aria-label={t('store.actions.install')}
          disabled={!canCreate}
          icon={Plus}
          title={t('store.actions.install')}
          onClick={handleInstall}
        />
      );
    };

    return (
      <Flexbox
        className={itemStyles.container}
        data-testid={community ? 'skill-item' : undefined}
        gap={0}
      >
        <Block
          horizontal
          align={'center'}
          gap={12}
          paddingBlock={community ? 8 : 12}
          paddingInline={12}
          variant={community ? 'filled' : 'outlined'}
        >
          <Avatar
            avatar={icon || name}
            shape={'square'}
            size={community ? 36 : 40}
            style={{ flex: 'none' }}
          />
          <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
            <Flexbox horizontal align="center" gap={8}>
              {community ? (
                <WorkspaceLink
                  className={styles.title}
                  to={`/community/skill/${identifier}`}
                  onClick={(e) => {
                    if (isModifierClick(e)) return;
                    e.preventDefault();
                    void discoverService
                      .reportSkillEvent({ event: 'click', identifier, source: location.pathname })
                      .catch(() => {});
                    createSkillDetailModal({ identifier });
                  }}
                >
                  {name}
                </WorkspaceLink>
              ) : (
                <span
                  className={styles.title}
                  onClick={() => openMarketSkillDetailModal(identifier)}
                >
                  {name}
                </span>
              )}
              {!community && <Tag icon={<Icon icon={SkillsIcon} />} size={'small'} />}
            </Flexbox>
            {description && <span className={itemStyles.description}>{description}</span>}
          </Flexbox>
          {renderAction()}
        </Block>
      </Flexbox>
    );
  },
);

MarketSkillItem.displayName = 'MarketSkillItem';

export default MarketSkillItem;
