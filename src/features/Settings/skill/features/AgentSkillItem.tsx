'use client';

import { type SkillListItem } from '@lobechat/types';
import {
  Button,
  confirmModal,
  createModal,
  DropdownMenu,
  Flexbox,
  Icon,
  stopPropagation,
} from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import * as stylex from '@stylexjs/stylex';
import { DownloadIcon, MoreHorizontalIcon, Trash2 } from 'lucide-react';
import { lazy, memo, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MarketSkillIcon from '@/components/MarketSkillIcon';
import {
  GitHubSkillUpdate,
  GitHubSkillUpdateIndicator,
  hasGitHubSource,
} from '@/features/AgentSkillDetail/GitHubSkillUpdate';
import NavItem from '@/features/NavPanel/components/NavItem';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { downloadFile } from '@/utils/client/downloadFile';

import { RowMoreMenu } from './RowActions';
import SkillListRow, { useSkillListVariant } from './SkillListRow';
import { styles } from './style';

const AgentSkillDetail = lazy(() => import('@/features/AgentSkillDetail'));

interface AgentSkillItemProps {
  isSelected?: boolean;
  onSelect?: () => void;
  skill: SkillListItem;
}

const AgentSkillItem = memo<AgentSkillItemProps>(({ skill, isSelected, onSelect }) => {
  const { t } = useTranslation('setting');
  const { t: tc } = useTranslation('common');
  const { t: tp } = useTranslation('plugin');
  const [loading, setLoading] = useState(false);
  const { allowed: canEdit } = usePermission('edit_own_content');

  const isPage = useSkillListVariant() === 'page';
  const canManage = useResourceManageable(skill.userId);

  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);
  const title = skill.name;

  const renderIcon = (size: number, marketSize = size) => {
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
    if (!canEdit || !canManage) return;
    confirmModal({
      okButtonProps: { danger: true },
      onOk: async () => {
        setLoading(true);
        try {
          await deleteAgentSkill(skill.id);
        } finally {
          setLoading(false);
        }
      },
      content: tp('store.actions.confirmUninstall'),
      okText: tp('store.actions.uninstall'),
      title: tp('store.actions.uninstall'),
    });
  };

  // ===== Status & Actions =====

  const tracked = hasGitHubSource(skill);
  const updateAction = tracked ? <GitHubSkillUpdate compact skill={skill} /> : null;

  const renderActions = () => {
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
  };

  if (isPage) {
    return (
      <SkillListRow
        active={isSelected}
        icon={() => renderIcon(20, 40)}
        summary={skill.description}
        title={title}
        extra={
          <>
            {updateAction}
            <RowMoreMenu
              items={[
                ...(skill.zipFileHash
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
          </>
        }
        onClick={onSelect ?? handleOpenDetail}
      />
    );
  }

  if (onSelect) {
    return (
      <NavItem
        active={isSelected}
        icon={() => renderIcon(18)}
        role="button"
        slots={{ titleSuffix: tracked && <GitHubSkillUpdateIndicator id={skill.id} /> }}
        tabIndex={0}
        title={title}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect();
          }
        }}
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
          <div {...stylex.props(styles.icon)}>{renderIcon(16)}</div>
          <span {...stylex.props(styles.title)}>{title}</span>
        </Flexbox>
      </Flexbox>
      {!onSelect && (
        <Flexbox horizontal align="center" gap={8} onClick={stopPropagation}>
          {updateAction}
          {renderActions()}
        </Flexbox>
      )}
    </Flexbox>
  );
});

AgentSkillItem.displayName = 'AgentSkillItem';

export default AgentSkillItem;
