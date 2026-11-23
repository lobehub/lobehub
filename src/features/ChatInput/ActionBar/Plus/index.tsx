'use client';

import { validateVideoFileSize } from '@lobechat/utils/client';
import { Icon, toast, Upload } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  CheckIcon,
  FileUp,
  LibraryBig,
  PlusIcon,
  Settings2Icon,
  TargetIcon,
  TypeIcon,
} from 'lucide-react';
import { memo, Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useInRouterContext, useLocation } from 'react-router';

import { openAttachKnowledgeModal } from '@/features/LibraryModal';
import { useMediaUploadAbility } from '@/hooks/useMediaUploadAbility';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useDensityTokens } from '@/styles/density';
import { densityTokens } from '@/styles/density.stylex';

import { useAgentId } from '../../hooks/useAgentId';
import { useChatInputResourceAccess } from '../../hooks/useChatInputResourceAccess';
import { useChatInputUpload } from '../../hooks/useChatInputUpload';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { useLargeFileLocalPath } from '../../hooks/useLargeFileLocalPath';
import { insertGoalTag } from '../../InputEditor/ActionTag/goalTag';
import { useChatInputStore } from '../../store';
import { type ActionDropdownMenuItems } from '../components/ActionDropdown';
import { ChatInputAction } from '../components/ChatInputAction';
import SubmenuChevron from '../components/SubmenuChevron';
import { useControls as useKnowledgeControls } from '../Knowledge/useControls';
import { usePopupToolsMenuItem } from './usePopupToolsMenuItem';
import { useSkillsMenuItem } from './useSkillsMenuItem';
import { useToolsMenuItem } from './useToolsMenuItem';

const styles = stylex.create({
  activeLabel: {
    display: 'flex',
    gap: densityTokens['--lobe-density-section-gap'],
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    color: 'inherit',
  },
  activeLabelText: {
    overflow: 'hidden',
    minWidth: '0',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  countChip: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '18px',
    height: '18px',
    paddingBlock: '0',
    paddingInline: '6px',
    borderRadius: '9px',
    fontSize: '11px',
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  hotArea: {
    '::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      backgroundColor: 'transparent',
    },
  },
  labelWithChip: { display: 'inline-flex', gap: '8px', alignItems: 'center' },
});

const usePlusMenuItemsBase = ({
  close,
  toolsMenuItem,
}: {
  close: () => void;
  toolsMenuItem: ActionDropdownMenuItems[number];
}): ActionDropdownMenuItems => {
  const { t } = useTranslation('chat');
  const { t: tEditor } = useTranslation('editor');
  const { t: tSetting } = useTranslation('setting');
  const agentId = useAgentId();
  const { canConfigureResource } = useChatInputResourceAccess();

  const upload = useChatInputUpload();
  const { enableKnowledgeBase } = useServerConfigStore(featureFlagsSelectors);

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
  const skillsMenuItem = useSkillsMenuItem(closeDropdown);

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
        <div {...stylex.props(styles.activeLabel)}>
          <span {...stylex.props(styles.activeLabelText)}>{label}</span>
          <Icon icon={CheckIcon} size={14} />
        </div>
      ) : (
        label
      );

    const renderLabelWithCount = (label: string, count: number) =>
      count > 0 ? (
        <span {...stylex.props(styles.labelWithChip)}>
          <span>{label}</span>
          <span {...stylex.props(styles.countChip)}>{count}</span>
        </span>
      ) : (
        label
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
            <div {...stylex.props(styles.hotArea)}>{t('upload.action.fileOrImageUpload')}</div>
          </Upload>
        ),
      },
    ];

    const toolsItems: ActionDropdownMenuItems =
      isAgentModeEnabled && enableFC ? [toolsMenuItem] : [];

    // Memory and web search are activation entries of the Tools popover now: they
    // live in its "Auto" group, can be disabled there, and carry their own settings,
    // so this menu only owns the route to them.
    // Selecting a skill adds composer context; unlike tool configuration, it
    // does not require resource-edit permission or model function calling.
    const coreItems: ActionDropdownMenuItems = [
      ...(canConfigureResource ? toolsItems : []),
      skillsMenuItem,
    ];

    // Formatting toolbar is always available; advanced params only when the
    // user can configure resources.
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
            extra: <SubmenuChevron />,
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
    // the composer. The agent then plans and calls builtin-goal.createGoal,
    // regardless of whether this conversation already has a topic.
    const goalItems: ActionDropdownMenuItems = [
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
    ];

    // Grouped with a single divider only between non-empty groups:
    // [attachments] | [tools · skills] | [set goal] | [formatting · params]
    const menuGroups: ActionDropdownMenuItems[] = [
      attachmentsItems,
      coreItems,
      goalItems,
      formatItems,
    ];
    return menuGroups
      .filter((group) => group.length > 0)
      .flatMap((group, index) => (index === 0 ? group : [{ type: 'divider' as const }, ...group]));
  }, [
    agentId,
    canConfigureResource,
    canUploadImage,
    canUploadVideo,
    canUploadAudio,
    editor,
    enableFC,
    enableKnowledgeBase,
    handleToggleParams,
    isAgentModeEnabled,
    isParamsPanelActive,
    knowledgeEnabledCount,
    setShowTypoBar,
    showTypoBar,
    knowledgeItems,
    knowledgeFooter,
    t,
    tEditor,
    tSetting,
    skillsMenuItem,
    toolsMenuItem,
    upload,
    routeLargeFilesToLocalPaths,
    close,
  ]);

  return items;
};

const useMainPlusMenuItems = ({ close }: { close: () => void }): ActionDropdownMenuItems => {
  const closeDropdown = useCallback(() => close(), [close]);
  const toolsMenuItem = useToolsMenuItem(closeDropdown);

  return usePlusMenuItemsBase({ close, toolsMenuItem });
};

const usePopupPlusMenuItems = ({ close }: { close: () => void }): ActionDropdownMenuItems => {
  const closeDropdown = useCallback(() => close(), [close]);
  const toolsMenuItem = usePopupToolsMenuItem(closeDropdown);

  return usePlusMenuItemsBase({ close, toolsMenuItem });
};

/**
 * The trigger stays hook-free: every store subscription and the whole item tree
 * live in `useMainPlusMenuItems` / `usePopupPlusMenuItems`, which ActionDropdown
 * only invokes from inside the popup — so opening a conversation no longer pays
 * for a menu nobody opened.
 */
const PlusActionBase = memo<{ isPopup: boolean }>(({ isPopup }) => {
  const { t } = useTranslation('chat');
  const { controlHeight, iconSize } = useDensityTokens();

  return (
    <ChatInputAction
      icon={PlusIcon}
      size={{ blockSize: controlHeight, borderRadius: controlHeight / 2, size: iconSize }}
      title={t('plus.contextTooltip')}
      tooltipProps={{ placement: 'top' }}
      dropdown={{
        menu: { useItems: isPopup ? usePopupPlusMenuItems : useMainPlusMenuItems },
        minWidth: 196,
        placement: 'topLeft',
      }}
    />
  );
});

PlusActionBase.displayName = 'PlusActionBase';

const PlusActionInRouter = memo(() => {
  const { pathname } = useLocation();

  return <PlusActionBase isPopup={pathname.startsWith('/popup')} />;
});

PlusActionInRouter.displayName = 'PlusActionInRouter';

const PlusAction = memo(() => {
  const inRouter = useInRouterContext();

  return inRouter ? <PlusActionInRouter /> : <PlusActionBase isPopup={false} />;
});

PlusAction.displayName = 'PlusAction';

const Plus = () => {
  const { controlHeight, iconSize } = useDensityTokens();

  return (
    <Suspense
      fallback={
        <ChatInputAction
          disabled
          icon={PlusIcon}
          size={{ blockSize: controlHeight, borderRadius: controlHeight / 2, size: iconSize }}
          title=""
        />
      }
    >
      <PlusAction />
    </Suspense>
  );
};

export default Plus;
