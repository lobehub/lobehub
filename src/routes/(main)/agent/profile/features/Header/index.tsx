import { isDesktop } from '@lobechat/const';
import { ActionIcon, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { confirmModal, type ModalInstance } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import type { TFunction } from 'i18next';
import {
  BarChart3,
  BotMessageSquareIcon,
  Download,
  MoreHorizontal,
  Settings2Icon,
  Trash,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentTransferMenuItem } from '@/business/client/hooks/useAgentTransferMenuItem';
import { useBusinessAgentImportMenuItem } from '@/business/client/hooks/useBusinessAgentImportMenuItem';
import { message } from '@/components/AntdStaticMethods';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

import { openAgentSettingsModal } from '../AgentSettings';
import { selectors as profileSelectors, useProfileStore } from '../store';
import AgentForkTag from './AgentForkTag';
import AgentStatusTag from './AgentStatusTag';
import AgentVersionReviewTag from './AgentVersionReviewTag';
import AutoSaveHint from './AutoSaveHint';

type HeaderTranslation = TFunction<
  readonly ['setting', 'chat', 'file', 'common', 'spend'],
  undefined
>;

const buildAgentProfileMarkdown = (params: {
  description?: string;
  model?: string;
  plugins?: string[];
  provider?: string;
  systemRole?: string;
  t: HeaderTranslation;
  tags?: string[];
  title?: string;
}) => {
  const { description, model, plugins = [], provider, systemRole, t, tags = [], title } = params;
  const sections: string[] = [];
  const agentTitle = title?.trim() || t('settingAgent.export.untitled', { ns: 'setting' });

  sections.push(`# ${agentTitle}`);

  if (description?.trim()) sections.push(description.trim());

  const metadata = [
    provider ? `- ${t('settingAgent.export.provider', { ns: 'setting' })}: ${provider}` : undefined,
    model ? `- ${t('settingAgent.export.model', { ns: 'setting' })}: ${model}` : undefined,
    tags.length > 0
      ? `- ${t('settingAgent.export.tags', { ns: 'setting' })}: ${tags.join(', ')}`
      : undefined,
  ].filter(Boolean);

  if (metadata.length > 0) {
    sections.push(
      `## ${t('settingAgent.export.metadata', { ns: 'setting' })}\n\n${metadata.join('\n')}`,
    );
  }

  if (plugins.length > 0) {
    sections.push(
      `## ${t('settingAgent.export.enabledPlugins', { ns: 'setting' })}\n\n${plugins
        .map((plugin) => `- ${plugin}`)
        .join('\n')}`,
    );
  }

  if (systemRole?.trim()) {
    sections.push(
      `## ${t('settingAgent.prompt.title', { ns: 'setting' })}\n\n${systemRole.trim()}`,
    );
  }

  return `${sections.join('\n\n')}\n`;
};

const Header = memo(() => {
  const { t } = useTranslation(['setting', 'chat', 'file', 'common', 'spend']);
  const navigate = useWorkspaceAwareNavigate();

  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const systemRole = useAgentStore(agentSelectors.currentAgentSystemRole);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const [showAgentBuilderPanel, toggleAgentBuilderPanel, isStatusInit] = useGlobalStore((s) => [
    systemStatusSelectors.showAgentBuilderPanel(s),
    s.toggleAgentBuilderPanel,
    systemStatusSelectors.isStatusInit(s),
  ]);
  const removeAgent = useHomeStore((s) => s.removeAgent);
  const editor = useProfileStore((s) => s.editor);
  const lockedByOther = useProfileStore(profileSelectors.lockedByOther);
  const lockPending = useProfileStore(profileSelectors.lockPending);
  const { allowed: canEdit } = usePermission('edit_own_content');

  const handleDelete = useCallback(() => {
    if (!canEdit || !activeAgentId) return;
    confirmModal({
      okButtonProps: { danger: true },
      onOk: async () => {
        await removeAgent(activeAgentId);
        message.success(t('confirmRemoveSessionSuccess', { ns: 'chat' }));
        navigate('/');
      },
      title: t('confirmRemoveSessionItemAlert', { ns: 'chat' }),
    });
  }, [activeAgentId, canEdit, navigate, removeAgent, t]);

  const handleExportMarkdown = useCallback(async () => {
    try {
      const editorMarkdown = isHeterogeneous
        ? undefined
        : (editor?.getDocument('markdown') as string | null | undefined);
      const profileMarkdown = buildAgentProfileMarkdown({
        description: meta?.description,
        model: config.model,
        plugins: config.plugins,
        provider: config.provider,
        systemRole: editorMarkdown ?? systemRole,
        t,
        tags: meta?.tags,
        title: meta?.title,
      });
      const baseFileName = sanitizeFileName(
        meta?.title || '',
        t('settingAgent.export.untitledFileName', { ns: 'setting' }),
      );
      const fileName = `${baseFileName}.md`;

      if (isDesktop) {
        const { desktopExportService } = await import('@/services/electron/desktopExportService');
        await desktopExportService.exportMarkdown({
          content: profileMarkdown,
          dialogTitle: t('settingAgent.export.dialogTitle', { ns: 'setting' }),
          fileName,
          successTitle: t('settingAgent.export.success', { ns: 'setting' }),
        });
      } else {
        const blob = new Blob([profileMarkdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.append(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        message.success(t('settingAgent.export.success', { ns: 'setting' }));
      }
    } catch (error) {
      console.error('Failed to export agent profile markdown:', error);
      message.error(t('settingAgent.export.error', { ns: 'setting' }));
    }
  }, [config.model, config.plugins, config.provider, editor, isHeterogeneous, meta, systemRole, t]);

  const importMenuItem = useBusinessAgentImportMenuItem(activeAgentId ?? undefined);
  const transferMenuItems = useAgentTransferMenuItem(activeAgentId ?? undefined, meta);

  const settingsModalRef = useRef<ModalInstance | null>(null);
  useEffect(
    () => () => {
      settingsModalRef.current?.close();
      settingsModalRef.current = null;
    },
    [],
  );

  const menuItems = useMemo(() => {
    const businessTransferMenuItems = transferMenuItems ?? [];

    return [
      {
        icon: <Icon icon={Settings2Icon} />,
        key: 'advanced-settings',
        label: t('advancedSettings', { ns: 'setting' }),
        onClick: () => {
          settingsModalRef.current?.close();
          settingsModalRef.current = openAgentSettingsModal();
        },
      },
      {
        icon: <Icon icon={BarChart3} />,
        key: 'usage-stats',
        label: t('usageStats.entry', { ns: 'spend' }),
        onClick: () => {
          if (activeAgentId) navigate(`/agent/${activeAgentId}/stats`);
        },
      },
      { type: 'divider' as const },
      {
        children: [
          {
            key: 'export-markdown',
            label: t('pageEditor.menu.export.markdown', { ns: 'file' }),
            onClick: handleExportMarkdown,
          },
        ],
        icon: <Icon icon={Download} />,
        key: 'export',
        label: t('pageEditor.menu.export', { ns: 'file' }),
      },
      importMenuItem ? { type: 'divider' as const } : null,
      importMenuItem,
      businessTransferMenuItems.length > 0 ? { type: 'divider' as const } : null,
      ...businessTransferMenuItems,
      { type: 'divider' as const },
      {
        danger: true,
        disabled: !canEdit,
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: handleDelete,
      },
    ].filter(Boolean);
  }, [
    activeAgentId,
    canEdit,
    handleExportMarkdown,
    handleDelete,
    navigate,
    t,
    importMenuItem,
    transferMenuItems,
  ]);

  return (
    <NavHeader
      left={
        <Flexbox horizontal align={'center'} gap={8}>
          <AutoSaveHint />
          <AgentStatusTag />
          <AgentVersionReviewTag />
          <AgentForkTag />
        </Flexbox>
      }
      right={
        <Flexbox horizontal align={'center'} gap={4}>
          <DropdownMenu items={menuItems}>
            <ActionIcon icon={MoreHorizontal} size={DESKTOP_HEADER_ICON_SMALL_SIZE} />
          </DropdownMenu>
          {!isHeterogeneous && isStatusInit && !lockedByOther && !lockPending && (
            <ToggleRightPanelButton
              expand={showAgentBuilderPanel}
              icon={BotMessageSquareIcon}
              showActive={true}
              onToggle={() => toggleAgentBuilderPanel()}
            />
          )}
        </Flexbox>
      }
    />
  );
});

export default Header;
