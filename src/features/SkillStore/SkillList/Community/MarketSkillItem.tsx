'use client';

import { ActionIcon, Avatar, Block, DropdownMenu, Flexbox, Icon, Modal, Tag } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { DownloadIcon, Loader2, MoreVerticalIcon, Plus, Trash2 } from 'lucide-react';
import { lazy, memo, Suspense, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';
import { type DiscoverSkillItem } from '@/types/discover';
import { downloadFile } from '@/utils/client/downloadFile';

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

const MarketSkillItem = memo<DiscoverSkillItem>(({ name, icon, description, identifier }) => {
  const { t } = useTranslation('plugin');
  const { t: tc } = useTranslation('common');
  const [detailOpen, setDetailOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [loading, setLoading] = useState(false);
  const { modal } = App.useApp();

  const installed = useToolStore(agentSkillsSelectors.isAgentSkill(identifier));
  const installedSkill = useToolStore(agentSkillsSelectors.getAgentSkillByIdentifier(identifier));
  const [refreshAgentSkills, deleteAgentSkill] = useToolStore((s) => [
    s.refreshAgentSkills,
    s.deleteAgentSkill,
  ]);

  const handleInstall = useCallback(async () => {
    if (installing || installed) return;
    setInstalling(true);
    try {
      await agentSkillService.importFromMarket(identifier);
      await refreshAgentSkills();
    } catch {
      // silently fail
    } finally {
      setInstalling(false);
    }
  }, [identifier, installing, installed, refreshAgentSkills]);

  const handleUninstall = useCallback(() => {
    if (!installedSkill) return;
    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteAgentSkill(installedSkill.id);
      },
      title: t('store.actions.confirmUninstall'),
      type: 'error',
    });
  }, [installedSkill, deleteAgentSkill, modal, t]);

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
              icon: <Icon icon={Trash2} />,
              key: 'uninstall',
              label: t('store.actions.uninstall'),
              onClick: handleUninstall,
            },
          ]}
        >
          <ActionIcon icon={MoreVerticalIcon} loading={loading} />
        </DropdownMenu>
      );
    }

    if (installing) return <ActionIcon loading icon={Loader2} />;

    return <ActionIcon icon={Plus} title={t('store.actions.install')} onClick={handleInstall} />;
  };

  return (
    <>
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
              <span className={styles.title} onClick={() => setDetailOpen(true)}>
                {name}
              </span>
              <Tag icon={<Icon icon={SkillsIcon} />} size={'small'} />
            </Flexbox>
            {description && <span className={itemStyles.description}>{description}</span>}
          </Flexbox>
          {renderAction()}
        </Block>
      </Flexbox>
      <Modal
        destroyOnHidden
        footer={null}
        open={detailOpen}
        styles={{ body: { height: 'calc(100dvh - 200px)', overflow: 'hidden', padding: 0 } }}
        title={t('dev.title.skillDetails')}
        width={960}
        onCancel={() => setDetailOpen(false)}
      >
        <Suspense fallback={<div style={{ height: '100%' }} />}>
          <MarketSkillDetail identifier={identifier} />
        </Suspense>
      </Modal>
    </>
  );
});

MarketSkillItem.displayName = 'MarketSkillItem';

export default MarketSkillItem;
