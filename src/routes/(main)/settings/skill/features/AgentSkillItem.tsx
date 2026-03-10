'use client';

import { type BuiltinSkill, type SkillListItem } from '@lobechat/types';
import {
  Avatar,
  Button,
  DropdownMenu,
  Flexbox,
  Icon,
  Modal,
  stopPropagation,
  Tag,
} from '@lobehub/ui';
import { App, Space } from 'antd';
import { DownloadIcon, MoreHorizontalIcon, Plus, PuzzleIcon, Trash2 } from 'lucide-react';
import { lazy, memo, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SkillSourceTag from '@/components/SkillSourceTag';
import { createBuiltinAgentSkillDetailModal } from '@/features/SkillStore/SkillDetail';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';
import { downloadFile } from '@/utils/client/downloadFile';

import { styles } from './style';

const AgentSkillDetail = lazy(() => import('@/features/AgentSkillDetail'));
const AgentSkillEdit = lazy(() => import('@/features/AgentSkillEdit'));

const isBuiltinSkill = (skill: BuiltinSkill | SkillListItem): skill is BuiltinSkill =>
  !('id' in skill);

interface AgentSkillItemProps {
  skill: BuiltinSkill | SkillListItem;
}

const AgentSkillItem = memo<AgentSkillItemProps>(({ skill }) => {
  const { t } = useTranslation('setting');
  const { t: tc } = useTranslation('common');
  const { t: tp } = useTranslation('plugin');
  const { modal } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const isBuiltin = isBuiltinSkill(skill);

  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);
  const [installBuiltinTool, uninstallBuiltinTool, isBuiltinInstalled] = useToolStore((s) => [
    s.installBuiltinTool,
    s.uninstallBuiltinTool,
    isBuiltin ? builtinToolSelectors.isBuiltinToolInstalled(skill.identifier)(s) : true,
  ]);

  const title = isBuiltin
    ? t(`tools.builtins.${skill.identifier}.title`, { defaultValue: skill.name })
    : skill.name;

  const avatar = isBuiltin ? skill.avatar : '🧩';

  // ===== Handlers =====

  const handleDownload = async () => {
    if (isBuiltin || !skill.zipFileHash) return;
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
        if (isBuiltin) {
          await uninstallBuiltinTool(skill.identifier);
        } else {
          setLoading(true);
          try {
            await deleteAgentSkill(skill.id);
          } finally {
            setLoading(false);
          }
        }
      },
      title: tp('store.actions.confirmUninstall'),
      type: 'error',
    });
  };

  // ===== Status & Actions =====

  const renderStatus = () => {
    if (!isBuiltin) return null;
    if (isBuiltinInstalled) {
      return <span className={styles.connected}>{t('tools.builtins.installed')}</span>;
    }
    return <span className={styles.disconnected}>{t('tools.builtins.uninstalled')}</span>;
  };

  const renderActions = () => {
    if (isBuiltin) {
      if (isBuiltinInstalled) {
        return (
          <DropdownMenu
            placement="bottomRight"
            items={[
              {
                danger: true,
                icon: <Icon icon={Trash2} />,
                key: 'uninstall',
                label: tp('store.actions.uninstall'),
                onClick: handleUninstall,
              },
            ]}
          >
            <Button icon={MoreHorizontalIcon} />
          </DropdownMenu>
        );
      }
      return (
        <Button icon={Plus} onClick={() => installBuiltinTool(skill.identifier)}>
          {tp('store.actions.install')}
        </Button>
      );
    }

    return (
      <Space.Compact>
        <Button onClick={() => setEditOpen(true)}>{tp('store.actions.configure')}</Button>
        <DropdownMenu
          placement="bottomRight"
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
              label: tp('store.actions.uninstall'),
              onClick: handleUninstall,
            },
          ]}
        >
          <Button icon={MoreHorizontalIcon} loading={loading} />
        </DropdownMenu>
      </Space.Compact>
    );
  };

  // ===== Detail Modal =====

  const handleOpenDetail = () => {
    if (isBuiltin) {
      createBuiltinAgentSkillDetailModal({ identifier: skill.identifier });
    } else {
      setDetailOpen(true);
    }
  };

  const renderDetailModal = () => {
    if (isBuiltin) return null;
    return (
      <>
        <Modal
          destroyOnHidden
          footer={null}
          open={detailOpen}
          styles={{ body: { height: 'calc(100dvh - 200px)', overflow: 'hidden', padding: 0 } }}
          title={tp('dev.title.skillDetails')}
          width={960}
          onCancel={() => setDetailOpen(false)}
        >
          <Suspense fallback={<div style={{ height: '100%' }} />}>
            <AgentSkillDetail skillId={skill.id} />
          </Suspense>
        </Modal>
        <Suspense>
          <AgentSkillEdit open={editOpen} skillId={skill.id} onClose={() => setEditOpen(false)} />
        </Suspense>
      </>
    );
  };

  const showDisconnected = isBuiltin && !isBuiltinInstalled;

  return (
    <>
      <Flexbox
        horizontal
        align="center"
        className={styles.container}
        gap={16}
        justify="space-between"
      >
        <Flexbox horizontal align="center" gap={16} style={{ flex: 1, overflow: 'hidden' }}>
          <Flexbox
            horizontal
            align="center"
            gap={16}
            style={{ cursor: 'pointer' }}
            onClick={handleOpenDetail}
          >
            <div className={`${styles.icon} ${showDisconnected ? styles.disconnectedIcon : ''}`}>
              <Avatar avatar={avatar} size={32} />
            </div>
            <Flexbox gap={4} style={{ overflow: 'hidden' }}>
              <Flexbox horizontal align="center" gap={8}>
                <span
                  className={`${styles.title} ${showDisconnected ? styles.disconnectedTitle : ''}`}
                >
                  {title}
                </span>
                {!isBuiltin && <Tag icon={<Icon icon={PuzzleIcon} />} size={'small'} />}
                <SkillSourceTag source={skill.source} />
              </Flexbox>
              {showDisconnected && renderStatus()}
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align="center" gap={12} onClick={stopPropagation}>
          {isBuiltin && isBuiltinInstalled && renderStatus()}
          {renderActions()}
        </Flexbox>
      </Flexbox>
      {renderDetailModal()}
    </>
  );
});

AgentSkillItem.displayName = 'AgentSkillItem';

export default AgentSkillItem;
