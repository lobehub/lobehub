'use client';

import { type BuiltinSkillManifest, type SkillListItem } from '@lobechat/types';
import {
  Avatar,
  Button,
  confirmModal,
  createModal,
  cssVar,
  DropdownMenu,
  Flexbox,
  Icon,
  stopPropagation,
} from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import * as stylex from '@stylexjs/stylex';
import { DownloadIcon, MoreHorizontalIcon, Plus, Trash2 } from 'lucide-react';
import { lazy, memo, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MarketSkillIcon from '@/components/MarketSkillIcon';
import { GitHubSkillUpdate, hasGitHubSource } from '@/features/AgentSkillDetail/GitHubSkillUpdate';
import NavItem from '@/features/NavPanel/components/NavItem';
import { createBuiltinAgentSkillDetailModal } from '@/features/SkillStore/SkillDetail';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';
import { downloadFile } from '@/utils/client/downloadFile';

import { RowAddAction, RowMoreMenu } from './RowActions';
import SkillListRow, { useSkillListVariant } from './SkillListRow';
import { styles } from './style';

const AgentSkillDetail = lazy(() => import('@/features/AgentSkillDetail'));

const isBuiltinSkill = (
  skill: BuiltinSkillManifest | SkillListItem,
): skill is BuiltinSkillManifest => !('id' in skill);

interface AgentSkillItemProps {
  isSelected?: boolean;
  onSelect?: () => void;
  skill: BuiltinSkillManifest | SkillListItem;
}

const AgentSkillItem = memo<AgentSkillItemProps>(({ skill, isSelected, onSelect }) => {
  const { t } = useTranslation('setting');
  const { t: tc } = useTranslation('common');
  const { t: tp } = useTranslation('plugin');
  const [loading, setLoading] = useState(false);
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  const isBuiltin = isBuiltinSkill(skill);
  const isPage = useSkillListVariant() === 'page';
  const canManage = useResourceManageable(isBuiltin ? undefined : skill.userId);

  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);
  const [installBuiltinTool, uninstallBuiltinTool, isBuiltinInstalled] = useToolStore((s) => [
    s.installBuiltinTool,
    s.uninstallBuiltinTool,
    isBuiltin ? builtinToolSelectors.isBuiltinToolInstalled(skill.identifier)(s) : true,
  ]);

  const title = isBuiltin
    ? t(`tools.builtins.${skill.identifier}.title`, { defaultValue: skill.name })
    : skill.name;

  const renderIcon = (size: number, marketSize = size) => {
    if (isBuiltin && skill.avatar) return <Avatar avatar={skill.avatar} size={size} />;

    const fallback = <Icon icon={SkillsIcon} size={size} />;
    if (skill.source !== 'market') return fallback;

    return (
      <MarketSkillIcon
        fallback={fallback}
        identifier={skill.identifier}
        name={skill.name}
        size={marketSize}
      />
    );
  };

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
    if (!canEdit || !canManage) return;
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
      content: tp('store.actions.confirmUninstall'),
      okText: tp('store.actions.uninstall'),
      title: tp('store.actions.uninstall'),
    });
  };

  // ===== Status & Actions =====

  const updateAction =
    !isBuiltin && hasGitHubSource(skill) ? <GitHubSkillUpdate compact skill={skill} /> : null;

  const renderStatus = () => {
    if (!isBuiltin) return null;
    if (isBuiltinInstalled) {
      return <span {...stylex.props(styles.connected)}>{t('tools.builtins.installed')}</span>;
    }
    return <span {...stylex.props(styles.disconnected)}>{t('tools.builtins.uninstalled')}</span>;
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
            <Button
              aria-label={t('connectorMarket.action.manage')}
              disabled={!canEdit}
              icon={<Icon icon={MoreHorizontalIcon} />}
            />
          </DropdownMenu>
        );
      }
      return (
        <Button
          disabled={!canCreate}
          icon={<Icon icon={Plus} />}
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
        <Button
          aria-label={t('connectorMarket.action.manage')}
          disabled={!canEdit}
          icon={<Icon icon={MoreHorizontalIcon} />}
          loading={loading}
        />
      </DropdownMenu>
    );
  };

  // ===== Detail Modal =====

  const handleOpenDetail = () => {
    if (isBuiltin) {
      createBuiltinAgentSkillDetailModal({ identifier: skill.identifier });
    } else {
      createModal({
        content: (
          <Suspense fallback={<div style={{ height: '100%' }} />}>
            <AgentSkillDetail skillId={skill.id} />
          </Suspense>
        ),
        footer: null,
        styles: { content: { height: 'calc(100dvh - 200px)', overflow: 'hidden', padding: 0 } },
        title: tp('dev.title.skillDetails'),
        width: 960,
      });
    }
  };

  const showDisconnected = isBuiltin && !isBuiltinInstalled;

  if (isPage) {
    return (
      <SkillListRow
        active={isSelected}
        description={updateAction}
        icon={() => renderIcon(20, 40)}
        title={title}
        extra={
          showDisconnected ? (
            <RowAddAction
              disabled={!canCreate}
              label={tp('store.actions.install')}
              loading={loading}
              onClick={async () => {
                if (!canCreate || loading) return;
                setLoading(true);
                try {
                  await installBuiltinTool(skill.identifier);
                } finally {
                  setLoading(false);
                }
              }}
            />
          ) : (
            <RowMoreMenu
              items={[
                ...(!isBuiltin && skill.zipFileHash
                  ? [
                      {
                        disabled: loading,
                        icon: <Icon icon={DownloadIcon} />,
                        key: 'download',
                        label: tc('download'),
                        onClick: handleDownload,
                      },
                    ]
                  : []),
                {
                  danger: true,
                  disabled: !canEdit || !canManage || loading,
                  icon: <Icon icon={Trash2} />,
                  key: 'uninstall',
                  label: tp('store.actions.uninstall'),
                  onClick: handleUninstall,
                },
              ]}
              onOpenDetail={onSelect ?? handleOpenDetail}
            />
          )
        }
        summary={
          isBuiltin
            ? t(`tools.builtins.${skill.identifier}.description`, {
                defaultValue: skill.description,
              })
            : skill.description
        }
        onClick={onSelect ?? handleOpenDetail}
      />
    );
  }

  if (onSelect) {
    return (
      <NavItem
        active={isSelected}
        extra={updateAction}
        icon={() => renderIcon(18)}
        title={title}
        titleColor={showDisconnected ? cssVar.colorTextDescription : undefined}
        onClick={onSelect}
      />
    );
  }

  return (
    <Flexbox
      horizontal
      align="center"
      className={stylex.props(styles.container).className}
      gap={16}
      justify="space-between"
      style={{
        ...(isSelected ? { background: 'var(--lobe-color-primary-bg)', borderRadius: 6 } : {}),
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
          <div {...stylex.props(styles.icon, showDisconnected && styles.disconnectedIcon)}>
            {renderIcon(16)}
          </div>
          <span {...stylex.props(styles.title, showDisconnected && styles.disconnectedTitle)}>
            {title}
          </span>
        </Flexbox>
        {showDisconnected && renderStatus()}
      </Flexbox>
      {!onSelect && (
        <Flexbox horizontal align="center" gap={8} onClick={stopPropagation}>
          {isBuiltin && isBuiltinInstalled && renderStatus()}
          {updateAction}
          {renderActions()}
        </Flexbox>
      )}
    </Flexbox>
  );
});

AgentSkillItem.displayName = 'AgentSkillItem';

export default AgentSkillItem;
