'use client';

import { validateVideoFileSize } from '@lobechat/utils/client';
import { css, cssVar, cx, Icon, Popover, toast, Upload } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import {
  CheckIcon,
  ChevronRight,
  Cloud,
  FileUp,
  LibraryBig,
  PlusIcon,
  Settings2Icon,
  TargetIcon,
  TypeIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, Suspense, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { openAttachKnowledgeModal } from '@/features/LibraryModal';
import { useIsDark } from '@/hooks/useIsDark';
import { useMediaUploadAbility } from '@/hooks/useMediaUploadAbility';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, settingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useChatInputResourceAccess } from '../../hooks/useChatInputResourceAccess';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { useLargeFileLocalPath } from '../../hooks/useLargeFileLocalPath';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import { insertGoalTag } from '../../InputEditor/ActionTag/goalTag';
import { useChatInputStore } from '../../store';
import { type ActionDropdownMenuItems } from '../components/ActionDropdown';
import { ChatInputAction } from '../components/ChatInputAction';
import { useDetailPopoverState } from '../components/useDetailPopoverState';
import { useControls as useKnowledgeControls } from '../Knowledge/useControls';
import { useControls as useToolsControls } from '../Tools/useControls';

const hotArea = css`
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background-color: transparent;
  }
`;

const activeLabel = css`
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;

  width: 100%;

  color: inherit;

  span {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const labelWithChip = css`
  display: inline-flex;
  gap: 8px;
  align-items: center;
`;

const countChip = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;

  min-width: 18px;
  height: 18px;
  padding-block: 0;
  padding-inline: 6px;
  border-radius: 9px;

  font-size: 11px;
  line-height: 18px;
  color: ${cssVar.colorTextSecondary};

  background: ${cssVar.colorFillSecondary};
`;

const gatewayModeInfoCard = css`
  overflow: hidden;
  width: 280px;
  border-radius: 8px;

  .cover {
    display: block;

    width: 100%;
    height: 148px;

    object-fit: cover;
    background: ${cssVar.colorFillTertiary};
  }

  .body {
    padding: 12px;
  }

  .title {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
  }

  .desc {
    margin-block-start: 6px;
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  }
`;

type DropdownItemWithPopover = NonNullable<ActionDropdownMenuItems>[number] & {
  label?: ReactNode;
  popoverContent?: unknown;
};

interface PopoverLabelProps {
  disabled?: boolean;
  label: ReactNode;
  popoverContent: ReactNode;
}

/**
 * The detail card must anchor past the whole menu row, not the label cell:
 * anchored to the label, it opens exactly over the item's trailing `extra`
 * slot ("..." menu, re-authorize link, switches), and a press landing on the
 * portal'd card is read by base-ui as an outside press that dismisses the
 * whole submenu. The card is also rendered inert (pointer-events: none) — it
 * is a hover information surface, so it must never swallow a press meant for
 * the controls beneath it.
 */
const PopoverLabel = memo<PopoverLabelProps>(({ disabled, label, popoverContent }) => {
  const { close, onOpenChange, open } = useDetailPopoverState(disabled);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const rowAnchorRef = useMemo(
    () => ({
      get current() {
        const wrapper = wrapperRef.current;
        return (wrapper?.closest('[role="menuitem"]') as HTMLElement | null) ?? wrapper;
      },
    }),
    [],
  );

  return (
    <Popover
      arrow={false}
      content={popoverContent}
      disabled={disabled}
      mouseEnterDelay={0.25}
      open={open}
      placement={'rightTop'}
      positionerProps={{ anchor: rowAnchorRef, sideOffset: 8 }}
      styles={{ content: { padding: 0 }, root: { pointerEvents: 'none' } }}
      onOpenChange={onOpenChange}
    >
      <span
        ref={wrapperRef}
        style={{ display: 'block', width: '100%' }}
        onClickCapture={close}
        onContextMenuCapture={close}
      >
        {label}
      </span>
    </Popover>
  );
});

PopoverLabel.displayName = 'PopoverLabel';

const wrapPopoverLabel = (label: ReactNode, popoverContent?: unknown, disabled?: boolean) => {
  if (!popoverContent) return label;

  return (
    <PopoverLabel disabled={disabled} label={label} popoverContent={popoverContent as ReactNode} />
  );
};

const stripPopoverContent = (
  items?: ActionDropdownMenuItems,
  detailPopoverDisabled?: boolean,
): ActionDropdownMenuItems =>
  items?.map((item) => {
    if (!item) return item;
    if ('type' in item && item.type === 'divider') return item;

    const nextItem = { ...(item as DropdownItemWithPopover) };
    const popoverContent = nextItem.popoverContent;
    delete nextItem.popoverContent;

    if ('children' in nextItem && nextItem.children) {
      return {
        ...nextItem,
        children: stripPopoverContent(nextItem.children, detailPopoverDisabled),
      } as ActionDropdownMenuItems[number];
    }

    if ('label' in nextItem) {
      nextItem.label = wrapPopoverLabel(nextItem.label, popoverContent, detailPopoverDisabled);
    }

    return nextItem;
  }) ?? [];

const usePlusMenuItems = ({ close }: { close: () => void }): ActionDropdownMenuItems => {
  const { t } = useTranslation('chat');
  const { t: tEditor } = useTranslation('editor');
  const { t: tSetting } = useTranslation('setting');
  const isDark = useIsDark();
  const agentId = useAgentId();
  const { canConfigureResource } = useChatInputResourceAccess();
  const { updateAgentChatConfig } = useUpdateAgentConfig();

  // Goal creation is lab-gated while the product surface is being rolled out.
  const enableGoals = useUserStore(labPreferSelectors.enableGoals);

  const upload = useFileStore((s) => s.uploadChatFiles);
  const { enableKnowledgeBase } = useServerConfigStore(featureFlagsSelectors);
  const enableGatewayMode = useServerConfigStore(serverConfigSelectors.enableGatewayMode);
  const defaultDisableGatewayMode = useUserStore(
    (s) => settingsSelectors.defaultAgentConfig(s).chatConfig?.disableGatewayMode,
  );

  const { model, provider } = useEffectiveModel(agentId);
  const isAgentModeEnabled = useAgentStore(agentSelectors.isAgentModeEnabled);
  const [showRightPanel, workingSidebarTab, openWorkingSidebar, toggleRightPanel] = useGlobalStore(
    (s) => [
      systemStatusSelectors.showRightPanel(s),
      s.status.workingSidebarTab,
      s.openWorkingSidebar,
      s.toggleRightPanel,
    ],
  );
  const isParamsPanelActive = Boolean(showRightPanel) && workingSidebarTab === 'params';
  const skillActivateMode = useAgentStore((s) =>
    chatConfigByIdSelectors.getSkillActivateModeById(agentId)(s),
  );
  const disableGatewayMode = useAgentStore(
    (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s).disableGatewayMode,
  );
  const isGatewayModeEnabled = (disableGatewayMode ?? defaultDisableGatewayMode) !== true;

  const [showTypoBar, setShowTypoBar] = useChatInputStore((s) => [s.showTypoBar, s.setShowTypoBar]);
  const editor = useChatInputStore((s) => s.editor);
  const routeLargeFilesToLocalPaths = useLargeFileLocalPath(agentId, editor);
  const { canUploadImage, canUploadVideo, canUploadAudio } = useMediaUploadAbility(
    model,
    provider,
    agentId,
  );
  const enableFC = useModelSupportToolUse(model, provider);
  const handleOpenKnowledge = useCallback(() => {
    close();
    openAttachKnowledgeModal();
  }, [close]);
  const {
    enabledCount: knowledgeEnabledCount,
    footer: knowledgeFooter,
    items: knowledgeItems,
  } = useKnowledgeControls({ openAttachKnowledgeModal: handleOpenKnowledge });
  const closeDropdown = useCallback(() => close(), [close]);
  const {
    autoCount: skillAutoCount,
    isPolicyMenuOpen: isSkillPolicyMenuOpen,
    marketFooter: skillMarketFooter,
    marketHeader: skillMarketHeader,
    marketItems: skillItems,
    pinnedCount: skillPinnedCount,
  } = useToolsControls({ closeDropdown });

  const handleToggleGatewayMode = useCallback(
    async (checked: boolean) => {
      await updateAgentChatConfig({ disableGatewayMode: checked ? false : true });
    },
    [updateAgentChatConfig],
  );

  const handleToggleParams = useCallback(() => {
    close();
    if (isParamsPanelActive) {
      toggleRightPanel(false);
      return;
    }
    openWorkingSidebar('params');
  }, [close, isParamsPanelActive, openWorkingSidebar, toggleRightPanel]);

  const items = useMemo<ActionDropdownMenuItems>(() => {
    const renderActive = (label: string, active: boolean) =>
      active ? (
        <div className={cx(activeLabel)}>
          <span>{label}</span>
          <Icon icon={CheckIcon} size={14} />
        </div>
      ) : (
        label
      );

    const renderLabelWithCount = (label: string, count: number, prefix?: string) =>
      count > 0 || prefix ? (
        <span className={cx(labelWithChip)}>
          <span>{label}</span>
          <span className={cx(countChip)}>{prefix ? `${prefix} | ${count}` : count}</span>
        </span>
      ) : (
        label
      );

    const gatewayModeInfo = (
      <div className={cx(gatewayModeInfoCard)}>
        <img
          alt=""
          className="cover"
          src={
            isDark ? '/app-images/agent_gateway_dark.webp' : '/app-images/agent_gateway_light.webp'
          }
        />
        <div className="body">
          <div className="title">{t('gatewayMode.cardTitle')}</div>
          <div className="desc">{t('gatewayMode.desc')}</div>
        </div>
      </div>
    );

    // The row detail card and the "..." policy menu anchor to the same right edge,
    // so leaving hover live lets a neighbouring row's card open on top of the menu
    // and swallow the click meant for it.
    const skillMenuItems = stripPopoverContent(
      skillItems as ActionDropdownMenuItems,
      isSkillPolicyMenuOpen,
    );

    const uploadItems: ActionDropdownMenuItems = [
      {
        closeOnClick: false,
        // Match the 20px file/library icons below so the label lines up with those rows.
        icon: <Icon icon={FileUp} size={20} />,
        key: 'upload-file-or-image',
        label: (
          <Upload
            multiple
            beforeUpload={(file) => {
              if (file.type.startsWith('image') && !canUploadImage) return false;
              if (file.type.startsWith('video') && !canUploadVideo) return false;
              if (file.type.startsWith('audio') && !canUploadAudio) return false;
              const validation = validateVideoFileSize(file);
              if (!validation.isValid) {
                toast.error(
                  t('upload.validation.videoSizeExceeded', {
                    actualSize: validation.actualSize,
                    maxSize: validation.maxSize,
                  }),
                );
                return false;
              }
              return true;
            }}
            onFiles={async (files) => {
              close();
              editor?.focus();
              const filesToUpload = routeLargeFilesToLocalPaths(files);
              if (filesToUpload.length > 0) await upload(filesToUpload, agentId);
            }}
          >
            <div className={cx(hotArea)}>{t('upload.action.fileOrImageUpload')}</div>
          </Upload>
        ),
      },
    ];

    // In auto mode every installed skill is callable, so show pinned + auto.
    // In manual mode only the pinned ones are active, so show pinned only.
    const activeSkillCount =
      skillActivateMode === 'auto' ? skillPinnedCount + skillAutoCount : skillPinnedCount;

    const toolsItems: ActionDropdownMenuItems =
      isAgentModeEnabled && enableFC
        ? [
            {
              children: skillMenuItems,
              // Trailing chevron (replaces base-ui's default triangle submenu arrow,
              // which is hidden via the .lobe-submenu-chevron rule in ActionDropdown).
              extra: <Icon className="lobe-submenu-chevron" icon={ChevronRight} size={16} />,
              footer: skillMarketFooter,
              header: skillMarketHeader,
              icon: SkillsIcon,
              key: 'tools',
              label: renderLabelWithCount(
                tSetting('tools.title'),
                activeSkillCount,
                tSetting(
                  skillActivateMode === 'auto'
                    ? 'tools.skillActivateMode.auto.title'
                    : 'tools.skillActivateMode.manual.title',
                ),
              ),
            } as ActionDropdownMenuItems[number],
          ]
        : [];

    // Agent Gateway sits below the formatting toolbar (grouped with advanced
    // params), gated on the resource-configuration permission.
    const gatewayItem: ActionDropdownMenuItems =
      canConfigureResource && enableGatewayMode
        ? [
            {
              checked: isGatewayModeEnabled,
              icon: Cloud,
              key: 'gateway-mode',
              // Brand name — same in every language, so no i18n.
              label: <PopoverLabel label={'Agent Gateway'} popoverContent={gatewayModeInfo} />,
              onCheckedChange: handleToggleGatewayMode,
              type: 'switch',
            } as ActionDropdownMenuItems[number],
          ]
        : [];

    // Memory and web search are activation entries of the Tools popover now: they
    // live in its "Auto" group, can be disabled there, and carry their own settings,
    // so this menu only owns the route to them.
    const coreItems: ActionDropdownMenuItems = canConfigureResource ? [...toolsItems] : [];

    // Formatting toolbar is always available; Agent Gateway + advanced params
    // only when the user can configure resources.
    const formatItems: ActionDropdownMenuItems = [
      // Formatting toolbar toggle — trailing switch; toggle by clicking the switch or the whole row
      {
        checked: Boolean(showTypoBar),
        icon: TypeIcon,
        key: 'typo',
        label: tEditor('actions.typobar.title'),
        onCheckedChange: (checked: boolean) => setShowTypoBar(checked),
        type: 'switch',
      },
      // Agent Gateway directly below the formatting toolbar.
      ...gatewayItem,
      // Advanced parameter settings — only when resources can be configured.
      ...(canConfigureResource
        ? [
            {
              icon: Settings2Icon,
              key: 'params',
              label: renderActive(tSetting('settingModel.params.title'), isParamsPanelActive),
              onClick: handleToggleParams,
            } as ActionDropdownMenuItems[number],
          ]
        : []),
    ];

    // "Add Attachments..." merges file upload with the knowledge base (libraries / files).
    // When the knowledge base is disabled there is no submenu, so Upload stays a top-level entry.
    const attachmentsItems: ActionDropdownMenuItems = enableKnowledgeBase
      ? [
          {
            children: [
              ...uploadItems,
              ...(canConfigureResource && knowledgeItems.length > 0
                ? [{ type: 'divider' as const }, ...knowledgeItems]
                : canConfigureResource
                  ? [
                      {
                        disabled: true,
                        key: 'knowledge-empty',
                        label: t('knowledgeBase.related.empty'),
                      },
                    ]
                  : []),
            ],
            // Trailing chevron (replaces base-ui's default triangle submenu arrow,
            // which is hidden via the .lobe-submenu-chevron rule in ActionDropdown).
            extra: <Icon className="lobe-submenu-chevron" icon={ChevronRight} size={16} />,
            footer: canConfigureResource ? knowledgeFooter : undefined,
            icon: LibraryBig,
            key: 'attachments',
            label: renderLabelWithCount(
              t('plus.addAttachments'),
              canConfigureResource ? knowledgeEnabledCount : 0,
            ),
          } as ActionDropdownMenuItems[number],
        ]
      : uploadItems;

    // Goal creation has one canonical entry: drop the goal chip at the head of
    // the composer. The agent then plans and calls lobe-goal.createGoal,
    // regardless of whether this conversation already has a topic.
    const acceptanceItems: ActionDropdownMenuItems = enableGoals
      ? [
          {
            icon: TargetIcon,
            key: 'set-topic-goal',
            // Same string as the chip it inserts: one label for the affordance,
            // so the menu row and the chip can never drift apart.
            label: tEditor('slash.goal'),
            onClick: () => {
              insertGoalTag(editor, tEditor('slash.goal'));
            },
          },
        ]
      : [];

    // Grouped with a single divider only between non-empty groups:
    // [attachments] | [memory · search · skills] | [set goal] | [formatting · gateway · params]
    const menuGroups: ActionDropdownMenuItems[] = [
      attachmentsItems,
      coreItems,
      acceptanceItems,
      formatItems,
    ];
    return menuGroups
      .filter((group) => group.length > 0)
      .flatMap((group, index) => (index === 0 ? group : [{ type: 'divider' as const }, ...group]));
  }, [
    agentId,
    canConfigureResource,
    enableGoals,
    canUploadImage,
    canUploadVideo,
    canUploadAudio,
    editor,
    enableFC,
    enableGatewayMode,
    enableKnowledgeBase,
    handleToggleGatewayMode,
    handleToggleParams,
    isAgentModeEnabled,
    isDark,
    isGatewayModeEnabled,
    isParamsPanelActive,
    isSkillPolicyMenuOpen,
    knowledgeEnabledCount,
    setShowTypoBar,
    showTypoBar,
    skillActivateMode,
    skillAutoCount,
    skillPinnedCount,
    knowledgeItems,
    knowledgeFooter,
    t,
    tEditor,
    tSetting,
    skillItems,
    skillMarketFooter,
    skillMarketHeader,
    upload,
    routeLargeFilesToLocalPaths,
    close,
  ]);

  return items;
};

/**
 * The trigger stays hook-free: every store subscription and the whole item tree
 * live in `usePlusMenuItems`, which ActionDropdown only invokes from inside the
 * popup — so opening a conversation no longer pays for a menu nobody opened.
 */
const PlusAction = memo(() => {
  const { t } = useTranslation('chat');

  return (
    <ChatInputAction
      icon={PlusIcon}
      size={{ blockSize: 32, borderRadius: 16, size: 18 }}
      title={t('plus.tooltip')}
      tooltipProps={{ placement: 'top' }}
      dropdown={{
        menu: { useItems: usePlusMenuItems },
        minWidth: 220,
        placement: 'topLeft',
      }}
    />
  );
});

PlusAction.displayName = 'PlusAction';

const Plus = () => (
  <Suspense
    fallback={
      <ChatInputAction
        disabled
        icon={PlusIcon}
        size={{ blockSize: 32, borderRadius: 16, size: 18 }}
        title=""
      />
    }
  >
    <PlusAction />
  </Suspense>
);

export default Plus;
