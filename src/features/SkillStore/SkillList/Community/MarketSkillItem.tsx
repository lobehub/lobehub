'use client';

import {
  ActionIcon,
  Avatar,
  Block,
  confirmModal,
  createModal,
  DropdownMenu,
  Flexbox,
  Icon,
  Tag,
} from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t as translate } from 'i18next';
import { DownloadIcon, Loader2, MoreVerticalIcon, Plus, Trash2 } from 'lucide-react';
import { lazy, memo, Suspense, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';
import { type DiscoverSkillItem } from '@/types/discover';
import { downloadFile } from '@/utils/client/downloadFile';

import { itemStyles } from '../style';

const MarketSkillDetail = lazy(() => import('../MarketSkills/MarketSkillDetail'));

const styles = stylex.create({
  title: {
    cursor: 'pointer',
    overflow: 'hidden',
    fontSize: '14px',
    fontWeight: 500,
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorPrimary },
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

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

const MarketSkillItem = memo<DiscoverSkillItem>(({ name, icon, description, identifier }) => {
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
      // silently fail
    } finally {
      setInstalling(false);
    }
  }, [canCreate, identifier, installing, installed, refreshAgentSkills]);

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
          <ActionIcon disabled={!canEdit} icon={MoreVerticalIcon} loading={loading} />
        </DropdownMenu>
      );
    }

    if (installing) return <ActionIcon loading icon={Loader2} />;

    return (
      <ActionIcon
        disabled={!canCreate}
        icon={Plus}
        title={t('store.actions.install')}
        onClick={handleInstall}
      />
    );
  };

  return (
    <Flexbox className={itemStyles.container} gap={0}>
      <Block
        horizontal
        align={'center'}
        gap={12}
        paddingBlock={12}
        paddingInline={12}
        variant={'outlined'}
      >
        <Avatar avatar={icon || name} shape={'square'} size={40} style={{ flex: 'none' }} />
        <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
          <Flexbox horizontal align="center" gap={8}>
            <span
              {...stylex.props(styles.title)}
              onClick={() => openMarketSkillDetailModal(identifier)}
            >
              {name}
            </span>
            <Tag icon={<Icon icon={SkillsIcon} />} size={'small'} />
          </Flexbox>
          {description && <span className={itemStyles.description}>{description}</span>}
        </Flexbox>
        {renderAction()}
      </Block>
    </Flexbox>
  );
});

MarketSkillItem.displayName = 'MarketSkillItem';

export default MarketSkillItem;
