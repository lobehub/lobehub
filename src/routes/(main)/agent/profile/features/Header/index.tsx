import { isDesktop } from '@lobechat/const';
import { ActionIcon, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { ShapesUploadIcon } from '@lobehub/ui/icons';
import isEqual from 'fast-deep-equal';
import type { TFunction } from 'i18next';
import { BotMessageSquareIcon, Download, MoreHorizontal, Settings2Icon, Trash } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { message } from '@/components/AntdStaticMethods';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { resolveMarketAuthError } from '@/layout/AuthProvider/MarketAuth/errors';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

import { useProfileStore } from '../store';
import AgentForkTag from './AgentForkTag';
import ForkConfirmModal from './AgentPublishButton/ForkConfirmModal';
import PublishResultModal from './AgentPublishButton/PublishResultModal';
import { type OriginalAgentInfo, useMarketPublish } from './AgentPublishButton/useMarketPublish';
import AgentStatusTag from './AgentStatusTag';
import AgentVersionReviewTag, { useVersionReviewStatus } from './AgentVersionReviewTag';
import AutoSaveHint from './AutoSaveHint';

type HeaderTranslation = TFunction<
  readonly ['setting', 'marketAuth', 'chat', 'file', 'common'],
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
  const { t } = useTranslation(['setting', 'marketAuth', 'chat', 'file', 'common']);
  const navigate = useNavigate();

  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const systemRole = useAgentStore(agentSelectors.currentAgentSystemRole);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const canPublishToCommunity = useAgentStore(agentSelectors.canCurrentAgentPublishToCommunity);
  const [showAgentBuilderPanel, toggleAgentBuilderPanel, isStatusInit] = useGlobalStore((s) => [
    systemStatusSelectors.showAgentBuilderPanel(s),
    s.toggleAgentBuilderPanel,
    systemStatusSelectors.isStatusInit(s),
  ]);
  const removeAgent = useHomeStore((s) => s.removeAgent);
  const editor = useProfileStore((s) => s.editor);
  const { isAuthenticated, isLoading: isAuthLoading, signIn } = useMarketAuth();
  const { isUnderReview } = useVersionReviewStatus();

  const action = meta?.marketIdentifier ? 'upload' : 'submit';

  const [showResultModal, setShowResultModal] = useState(false);
  const [publishedIdentifier, setPublishedIdentifier] = useState<string>();
  const [showForkModal, setShowForkModal] = useState(false);
  const [originalAgentInfo, setOriginalAgentInfo] = useState<OriginalAgentInfo | null>(null);

  const handlePublishSuccess = useCallback((identifier: string) => {
    setPublishedIdentifier(identifier);
    setShowResultModal(true);
  }, []);

  const { checkOwnership, isPublishing, publish } = useMarketPublish({
    action,
    onSuccess: handlePublishSuccess,
  });

  const doPublish = useCallback(async () => {
    const { needsForkConfirm, originalAgent } = await checkOwnership();
    if (needsForkConfirm && originalAgent) {
      setOriginalAgentInfo(originalAgent);
      setShowForkModal(true);
      return;
    }
    await publish();
  }, [checkOwnership, publish]);

  const handlePublishClick = useCallback(async () => {
    if (isUnderReview) {
      message.warning({
        content: t('marketPublish.validation.underReview', {
          defaultValue:
            'Your new version is currently under review. Please wait for approval before publishing a new version.',
          ns: 'setting',
        }),
      });
      return;
    }

    if (!meta?.title || meta.title.trim() === '') {
      message.error({ content: t('marketPublish.validation.emptyName', { ns: 'setting' }) });
      return;
    }

    if (!systemRole || systemRole.trim() === '') {
      message.error({
        content: t('marketPublish.validation.emptySystemRole', { ns: 'setting' }),
      });
      return;
    }

    confirmModal({
      onOk: async () => {
        if (!isAuthenticated) {
          try {
            await signIn();
            await doPublish();
          } catch (error) {
            console.error(`[MarketPublishButton][${action}] Authorization failed:`, error);
            const normalizedError = resolveMarketAuthError(error);
            message.error({
              content: t(`errors.${normalizedError.code}`, { ns: 'marketAuth' }),
              key: 'market-auth',
            });
          }
          return;
        }
        await doPublish();
      },
      title: t('marketPublish.validation.confirmPublish', { ns: 'setting' }),
    });
  }, [action, doPublish, isAuthenticated, isUnderReview, meta?.title, signIn, systemRole, t]);

  const handleForkConfirm = useCallback(async () => {
    setShowForkModal(false);
    setOriginalAgentInfo(null);
    await publish();
  }, [publish]);

  const handleDelete = useCallback(() => {
    if (!activeAgentId) return;
    confirmModal({
      okButtonProps: { danger: true },
      onOk: async () => {
        await removeAgent(activeAgentId);
        message.success(t('confirmRemoveSessionSuccess', { ns: 'chat' }));
        navigate('/');
      },
      title: t('confirmRemoveSessionItemAlert', { ns: 'chat' }),
    });
  }, [activeAgentId, navigate, removeAgent, t]);

  const handleExportMarkdown = useCallback(async () => {
    try {
      const editorMarkdown = editor?.getDocument('markdown') as string | null | undefined;
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
  }, [config.model, config.plugins, config.provider, editor, meta, systemRole, t]);

  const menuItems = useMemo(
    () => [
      {
        icon: <Icon icon={Settings2Icon} />,
        key: 'advanced-settings',
        label: t('advancedSettings', { ns: 'setting' }),
        onClick: () => useAgentStore.setState({ showAgentSetting: true }),
      },
      { type: 'divider' as const },
      ...(canPublishToCommunity
        ? [
            {
              icon: <Icon icon={ShapesUploadIcon} />,
              key: 'publish',
              label: t('publishToCommunity', { ns: 'setting' }),
              onClick: handlePublishClick,
            },
            { type: 'divider' as const },
          ]
        : []),
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
      { type: 'divider' as const },
      {
        danger: true,
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: handleDelete,
      },
    ],
    [canPublishToCommunity, handlePublishClick, handleExportMarkdown, handleDelete, t],
  );

  return (
    <>
      <NavHeader
        left={
          <Flexbox horizontal gap={8}>
            <AutoSaveHint />
            <AgentStatusTag />
            <AgentVersionReviewTag />
            <AgentForkTag />
          </Flexbox>
        }
        right={
          <Flexbox horizontal align={'center'} gap={4}>
            <DropdownMenu items={menuItems}>
              <ActionIcon
                icon={MoreHorizontal}
                loading={canPublishToCommunity && (isPublishing || isAuthLoading)}
                size={DESKTOP_HEADER_ICON_SMALL_SIZE}
              />
            </DropdownMenu>
            {!isHeterogeneous && isStatusInit && (
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
      <ForkConfirmModal
        loading={isPublishing}
        open={showForkModal}
        originalAgent={originalAgentInfo}
        onConfirm={handleForkConfirm}
        onCancel={() => {
          setShowForkModal(false);
          setOriginalAgentInfo(null);
        }}
      />
      <PublishResultModal
        identifier={publishedIdentifier}
        open={showResultModal}
        onCancel={() => setShowResultModal(false)}
      />
    </>
  );
});

export default Header;
