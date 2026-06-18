'use client';

import { type BuiltinSkill, type SkillListItem } from '@lobechat/types';
import { Avatar, Button, DropdownMenu, Flexbox, Icon, Modal, stopPropagation } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { Space } from 'antd';
import { DownloadIcon, MoreHorizontalIcon, Plus, Trash2 } from 'lucide-react';
import { lazy, memo, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createBuiltinAgentSkillDetailModal } from '@/features/SkillStore/SkillDetail';
import { usePermission } from '@/hooks/usePermission';
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
  isSelected?: boolean;
  onSelect?: () => void;
  skill: BuiltinSkill | SkillListItem;
}

const AgentSkillItem = memo<AgentSkillItemProps>(({ skill, isSelected, onSelect }) => {
  const { t } = useTranslation('setting');
  const { t: tc } = useTranslation('common');
  const { t: tp } = useTranslation('plugin');
  const [loading, setLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

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

  const avatar = isBuiltin ? skill.avatar : undefined;

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
    if (!canEdit) return;
    confirmModal({
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
                disabled: !canEdit,
                icon: <Icon icon={Trash2} />,
                key: 'uninstall',
                label: tp('store.actions.uninstall'),
                onClick: handleUninstall,
              },
            ]}
          >
            <Button disabled={!canEdit} icon={MoreHorizontalIcon} />
          </DropdownMenu>
        );
      }
      return (
        <Button
          disabled={!canCreate}
          icon={Plus}
          onClick={() => {
            if (!canCreate) return;
            installBuiltinTool(skill.identifier);
          }}
        >
          {tp('store.actions.install')}
        </Button>
      );
    }

    return (
      <Space.Compact>
        <Button disabled={!canEdit} onClick={() => setEditOpen(true)}>
          {tp('store.actions.configure')}
        </Button>
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
              disabled: !canEdit,
              icon: <Trash2 size={16} />,
              key: 'uninstall',
              label: tp('store.actions.uninstall'),
              onClick: handleUninstall,
            },
          ]}
        >
          <Button disabled={!canEdit} icon={MoreHorizontalIcon} loading={loading} />
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
        style={{
          ...(isSelected ? { background: 'var(--ant-color-primary-bg)', borderRadius: 6 } : {}),
          ...(onSelect ? { cursor: 'pointer' } : {}),
        }}
        onClick={onSelect}
      >
        <Flexbox horizontal align="center" gap={8} style={{ flex: 1, overflow: 'hidden' }}>
          <Flexbox
            horizontal
            align="center"
            gap={8}
            style={{ cursor: onSelect ? undefined : 'pointer' }}
            onClick={onSelect ? undefined : handleOpenDetail}
          >
            <div className={`${styles.icon} ${showDisconnected ? styles.disconnectedIcon : ''}`}>
              {avatar ? <Avatar avatar={avatar} size={16} /> : <Icon icon={SkillsIcon} size={16} />}
            </div>
            <span className={`${styles.title} ${showDisconnected ? styles.disconnectedTitle : ''}`}>
              {title}
            </span>
          </Flexbox>
          {showDisconnected && renderStatus()}
        </Flexbox>
        {!onSelect && (
          <Flexbox horizontal align="center" gap={8} onClick={stopPropagation}>
            {isBuiltin && isBuiltinInstalled && renderStatus()}
            {renderActions()}
          </Flexbox>
        )}
      </Flexbox>
      {!onSelect && renderDetailModal()}
    </>
  );
});

AgentSkillItem.displayName = 'AgentSkillItem';

export default AgentSkillItem;
