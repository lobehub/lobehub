'use client';

import { type SkillListItem } from '@lobechat/types';
import { Block, DropdownMenu, Flexbox, Icon, Button as LobeButton, Modal, Tag } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { DownloadIcon, MoreHorizontalIcon, Package, PuzzleIcon, Trash2 } from 'lucide-react';
import { Suspense, lazy, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { downloadFile } from '@/utils/client/downloadFile';

const AgentSkillDetail = lazy(() => import('@/features/AgentSkillDetail'));

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-block: 12px;
    padding-inline: 0;
  `,
  icon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: 12px;

    font-size: 20px;

    background: ${cssVar.colorFillTertiary};
  `,
  title: css`
    cursor: pointer;
    font-size: 15px;
    font-weight: 500;
    color: ${cssVar.colorText};

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
}));

interface AgentSkillItemProps {
  skill: SkillListItem;
}

const AgentSkillItem = memo<AgentSkillItemProps>(({ skill }) => {
  const { t } = useTranslation('setting');
  const { t: tc } = useTranslation('common');
  const { t: tp } = useTranslation('plugin');
  const { modal } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);

  const handleDownload = async () => {
    if (!skill.zipFileHash) return;

    setLoading(true);
    try {
      const result = await agentSkillService.getZipUrl(skill.id);
      if (result.url) {
        await downloadFile(result.url, `${result.name || skill.name}.zip`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUninstall = () => {
    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        setLoading(true);
        try {
          await deleteAgentSkill(skill.id);
        } finally {
          setLoading(false);
        }
      },
      title: t('store.actions.confirmUninstall', { ns: 'plugin' }),
      type: 'error',
    });
  };

  return (
    <>
      <Flexbox
        align="center"
        className={styles.container}
        gap={16}
        horizontal
        justify="space-between"
      >
        <Flexbox align="center" gap={12} horizontal style={{ flex: 1, overflow: 'hidden' }}>
          <Block className={styles.icon} variant={'outlined'}>
            <PuzzleIcon size={20} />
          </Block>
          <Flexbox align="center" gap={8} horizontal style={{ overflow: 'hidden' }}>
            <span className={styles.title} onClick={() => setDetailOpen(true)}>
              {skill.name}
            </span>
            <Tag icon={<Icon icon={PuzzleIcon} />} size={'small'} />
            <Tag color={'warning'} icon={<Icon icon={Package} />} size={'small'}>
              {t('store.customPlugin', { ns: 'plugin' })}
            </Tag>
          </Flexbox>
        </Flexbox>
        <DropdownMenu
          items={[
            ...(skill.zipFileHash
              ? [
                  {
                    icon: <DownloadIcon size={16} />,
                    key: 'download',
                    label: tc('download'),
                    onClick: handleDownload,
                  },
                  { type: 'divider' as const },
                ]
              : []),
            {
              danger: true,
              icon: <Trash2 size={16} />,
              key: 'uninstall',
              label: t('store.actions.uninstall', { ns: 'plugin' }),
              onClick: handleUninstall,
            },
          ]}
          placement="bottomRight"
        >
          <LobeButton icon={MoreHorizontalIcon} loading={loading} />
        </DropdownMenu>
      </Flexbox>
      <Modal
        destroyOnHidden
        footer={null}
        onCancel={() => setDetailOpen(false)}
        open={detailOpen}
        styles={{ body: { height: 'calc(100dvh - 200px)', overflow: 'hidden', padding: 0 } }}
        title={tp('dev.title.skillDetails')}
        width={960}
      >
        <Suspense fallback={<div style={{ height: '100%' }} />}>
          <AgentSkillDetail skillId={skill.id} />
        </Suspense>
      </Modal>
    </>
  );
});

AgentSkillItem.displayName = 'AgentSkillItem';

export default AgentSkillItem;
