'use client';

import { type SkillListItem } from '@lobechat/types';
import { ActionIcon, Avatar, Block, DropdownMenu, Flexbox, Icon, Modal, Tag } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { DownloadIcon, MoreVerticalIcon, PackageSearch, PuzzleIcon, Trash2 } from 'lucide-react';
import { Suspense, lazy, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { downloadFile } from '@/utils/client/downloadFile';

import { itemStyles } from '../style';

const AgentSkillDetail = lazy(() => import('@/features/AgentSkillDetail'));
const AgentSkillEdit = lazy(() => import('@/features/AgentSkillEdit'));

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

interface AgentSkillItemProps {
  skill: SkillListItem;
}

const AgentSkillItem = memo<AgentSkillItemProps>(({ skill }) => {
  const { t } = useTranslation('plugin');
  const { t: tc } = useTranslation('common');
  const { modal } = App.useApp();
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(false);
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

  const handleDelete = () => {
    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteAgentSkill(skill.id);
      },
      title: t('store.actions.confirmUninstall'),
      type: 'error',
    });
  };

  return (
    <>
      <Flexbox className={itemStyles.container} gap={0}>
        <Block
          align={'center'}
          gap={12}
          horizontal
          paddingBlock={12}
          paddingInline={12}
          variant={'outlined'}
        >
          <Avatar avatar={'🧩'} shape={'square'} size={40} />
          <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
            <Flexbox align="center" gap={8} horizontal>
              <span className={styles.title} onClick={() => setDetailOpen(true)}>
                {skill.name}
              </span>
              <Tag icon={<Icon icon={PuzzleIcon} />} size={'small'} />
            </Flexbox>
            {skill.description && (
              <span className={itemStyles.description}>{skill.description}</span>
            )}
          </Flexbox>
          <Flexbox horizontal>
            <ActionIcon
              icon={PackageSearch}
              onClick={() => setEditOpen(true)}
              title={t('store.actions.manifest')}
            />
            <DropdownMenu
              items={[
                ...(skill.zipFileHash
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
                  onClick: handleDelete,
                },
              ]}
              nativeButton={false}
              placement="bottomRight"
            >
              <ActionIcon icon={MoreVerticalIcon} loading={loading} />
            </DropdownMenu>
          </Flexbox>
        </Block>
      </Flexbox>
      <Modal
        destroyOnHidden
        footer={null}
        onCancel={() => setDetailOpen(false)}
        open={detailOpen}
        styles={{ body: { height: 'calc(100dvh - 200px)', overflow: 'hidden', padding: 0 } }}
        title={t('dev.title.skillDetails')}
        width={960}
      >
        <Suspense fallback={<div style={{ height: '100%' }} />}>
          <AgentSkillDetail skillId={skill.id} />
        </Suspense>
      </Modal>
      <Suspense>
        <AgentSkillEdit onClose={() => setEditOpen(false)} open={editOpen} skillId={skill.id} />
      </Suspense>
    </>
  );
});

AgentSkillItem.displayName = 'AgentSkillStoreItem';

export default AgentSkillItem;
