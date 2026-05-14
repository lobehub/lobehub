'use client';

import { validateVideoFileSize } from '@lobechat/utils/client';
import type { IconProps } from '@lobehub/ui';
import { Icon, Popover } from '@lobehub/ui';
import { BrainOffIcon, GlobeOffIcon, SkillsIcon } from '@lobehub/ui/icons';
import { Upload } from 'antd';
import { css, cssVar, cx } from 'antd-style';
import {
  Brain,
  CheckIcon,
  CloudCog,
  FileUp,
  Globe,
  LibraryBig,
  PlusIcon,
  SearchCheck,
  Store,
  TypeIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { openAttachKnowledgeModal } from '@/features/LibraryModal';
import { createSkillStoreModal } from '@/features/SkillStore';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useVisualMediaUploadAbility } from '@/hooks/useVisualMediaUploadAbility';
import { useAgentStore } from '@/store/agent';
import {
  agentByIdSelectors,
  agentSelectors,
  chatConfigByIdSelectors,
} from '@/store/agent/selectors';
import { aiModelSelectors, aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useFileStore } from '@/store/file';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import { useChatInputStore } from '../../store';
import Action from '../components/Action';
import { type ActionDropdownMenuItems } from '../components/ActionDropdown';
import { useControls as useKnowledgeControls } from '../Knowledge/useControls';
import { useMemoryEnabled } from '../Memory/useMemoryEnabled';
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
  gap: 8px;
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

const optionLabel = css`
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;

  width: 100%;
  min-width: 220px;

  .title {
    line-height: 1.25;
  }

  .desc {
    margin-block-start: 3px;

    font-size: 12px;
    line-height: 1.35;
    color: ${cssVar.colorTextDescription};
    white-space: normal;
  }
`;

const searchOptionRow = css`
  display: flex;
  gap: 10px;
  align-items: center;

  width: 100%;
  min-width: 220px;
  max-width: 320px;

  .title {
    line-height: 1.25;
  }

  .desc {
    margin-block-start: 3px;

    font-size: 12px;
    line-height: 1.35;
    color: ${cssVar.colorTextDescription};
    white-space: normal;
  }
`;

const searchIconBox = css`
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;

  width: 36px;
  height: 36px;
  border: 1px solid ${cssVar.colorBorderSecondary};
  border-radius: 8px;

  background: ${cssVar.colorBgContainer};
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

const activeIcon = (icon: IconProps['icon'], active?: boolean): IconProps['icon'] =>
  active ? <Icon color={cssVar.colorInfo} icon={icon} size={16} /> : icon;

type DropdownItemWithPopover = NonNullable<ActionDropdownMenuItems>[number] & {
  label?: ReactNode;
  popoverContent?: unknown;
};

const CLOSE_TOOL_DETAIL_POPOVER_EVENT = 'lobe-chat-tool-detail-popover-close';

interface PopoverLabelProps {
  label: ReactNode;
  popoverContent: ReactNode;
}

const PopoverLabel = memo<PopoverLabelProps>(({ label, popoverContent }) => {
  const [open, setOpen] = useState(false);
  const suppressUntilRef = useRef(0);

  useEffect(() => {
    const close = () => {
      suppressUntilRef.current = Date.now() + 600;
      setOpen(false);
    };
    window.addEventListener(CLOSE_TOOL_DETAIL_POPOVER_EVENT, close);

    return () => window.removeEventListener(CLOSE_TOOL_DETAIL_POPOVER_EVENT, close);
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen && Date.now() < suppressUntilRef.current) return;

    setOpen(nextOpen);
  }, []);

  return (
    <Popover
      arrow={false}
      content={popoverContent}
      mouseEnterDelay={0.25}
      open={open}
      placement={'rightTop'}
      positionerProps={{ sideOffset: 10 }}
      styles={{ content: { padding: 0 } }}
      onOpenChange={handleOpenChange}
    >
      <span
        style={{ display: 'block', width: '100%' }}
        onClickCapture={() => setOpen(false)}
        onContextMenuCapture={() => setOpen(false)}
      >
        {label}
      </span>
    </Popover>
  );
});

PopoverLabel.displayName = 'PopoverLabel';

const wrapPopoverLabel = (label: ReactNode, popoverContent?: unknown) => {
  if (!popoverContent) return label;

  return <PopoverLabel label={label} popoverContent={popoverContent as ReactNode} />;
};

const stripPopoverContent = (items?: ActionDropdownMenuItems): ActionDropdownMenuItems =>
  items?.map((item) => {
    if (!item) return item;
    if ('type' in item && item.type === 'divider') return item;

    const nextItem = { ...(item as DropdownItemWithPopover) };
    const popoverContent = nextItem.popoverContent;
    delete nextItem.popoverContent;

    if ('children' in nextItem && nextItem.children) {
      return { ...nextItem, children: stripPopoverContent(nextItem.children) };
    }

    if ('label' in nextItem) {
      nextItem.label = wrapPopoverLabel(nextItem.label, popoverContent);
    }

    return nextItem;
  }) ?? [];

const PlusAction = memo(() => {
  const { t } = useTranslation('chat');
  const { t: tEditor } = useTranslation('editor');
  const { t: tSetting } = useTranslation('setting');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const upload = useFileStore((s) => s.uploadChatFiles);
  const { enableKnowledgeBase } = useServerConfigStore(featureFlagsSelectors);

  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(agentId)(s));
  const provider = useAgentStore((s) => agentByIdSelectors.getAgentModelProviderById(agentId)(s));
  const isAgentModeEnabled = useAgentStore(agentSelectors.isAgentModeEnabled);
  const skillActivateMode = useAgentStore((s) =>
    chatConfigByIdSelectors.getSkillActivateModeById(agentId)(s),
  );
  const [searchMode, useModelBuiltinSearch] = useAgentStore((s) => [
    chatConfigByIdSelectors.getSearchModeById(agentId)(s),
    chatConfigByIdSelectors.getUseModelBuiltinSearchById(agentId)(s),
  ]);

  const isMemoryEnabled = useMemoryEnabled(agentId);
  const [showTypoBar, setShowTypoBar] = useChatInputStore((s) => [s.showTypoBar, s.setShowTypoBar]);
  const { canUploadImage, canUploadVideo } = useVisualMediaUploadAbility(model, provider);
  const enableFC = useModelSupportToolUse(model, provider);
  const { enabledCount: knowledgeEnabledCount, items: knowledgeItems } = useKnowledgeControls({
    openAttachKnowledgeModal,
  });
  const {
    autoCount: skillAutoCount,
    editPluginDrawer: skillEditPluginDrawer,
    marketItems: skillItems,
    pinnedCount: skillPinnedCount,
  } = useToolsControls();

  const isModelBuiltinSearchInternal = useAiInfraStore(
    aiModelSelectors.isModelBuiltinSearchInternal(model, provider),
  );
  const isModelHasBuiltinSearch = useAiInfraStore(
    aiModelSelectors.isModelHasBuiltinSearchConfig(model, provider),
  );
  const isProviderHasBuiltinSearch = useAiInfraStore(
    aiProviderSelectors.isProviderHasBuiltinSearchConfig(provider),
  );
  const showProviderSearch =
    !isModelBuiltinSearchInternal && (isModelHasBuiltinSearch || isProviderHasBuiltinSearch);

  // Derived active search option
  const activeSearchOption: 'off' | 'app' | 'provider' =
    searchMode === 'off' ? 'off' : useModelBuiltinSearch ? 'provider' : 'app';

  const handleToggleMemory = useCallback(async () => {
    await updateAgentChatConfig({ memory: { enabled: !isMemoryEnabled } });
  }, [isMemoryEnabled, updateAgentChatConfig]);

  const handleSelectSearch = useCallback(
    async (option: 'off' | 'app' | 'provider') => {
      if (option === 'off') {
        await updateAgentChatConfig({ searchMode: 'off', useModelBuiltinSearch: false });
      } else if (option === 'app') {
        await updateAgentChatConfig({ searchMode: 'auto', useModelBuiltinSearch: false });
      } else {
        await updateAgentChatConfig({ searchMode: 'auto', useModelBuiltinSearch: true });
      }
    },
    [updateAgentChatConfig],
  );

  const handleOpenTools = useCallback(() => {
    setDropdownOpen(false);
    createSkillStoreModal();
  }, []);

  const items: ActionDropdownMenuItems = useMemo(() => {
    const renderActive = (label: string, active: boolean) =>
      active ? (
        <div className={cx(activeLabel)}>
          <span>{label}</span>
          <Icon icon={CheckIcon} size={14} />
        </div>
      ) : (
        label
      );

    const renderOption = (title: string, description: string, active: boolean) => (
      <div className={cx(optionLabel)}>
        <div>
          <div className="title">{title}</div>
          {description && <div className="desc">{description}</div>}
        </div>
        {active && <Icon icon={CheckIcon} size={14} />}
      </div>
    );

    const renderSearchOption = (
      icon: ReactNode,
      title: string,
      description: string,
      active: boolean,
    ) => (
      <div className={cx(searchOptionRow)}>
        <div className={cx(searchIconBox)}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="title">{title}</div>
          {description && <div className="desc">{description}</div>}
        </div>
        {active && <Icon icon={CheckIcon} size={14} />}
      </div>
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

    const skillMenuItems = stripPopoverContent(skillItems as ActionDropdownMenuItems);

    const uploadItems: ActionDropdownMenuItems = [
      {
        closeOnClick: false,
        icon: FileUp,
        key: 'upload-file-or-image',
        label: (
          <Upload
            multiple
            showUploadList={false}
            beforeUpload={async (file) => {
              if (file.type.startsWith('image') && !canUploadImage) return false;
              if (file.type.startsWith('video') && !canUploadVideo) return false;
              const validation = validateVideoFileSize(file);
              if (!validation.isValid) {
                message.error(
                  t('upload.validation.videoSizeExceeded', { actualSize: validation.actualSize }),
                );
                return false;
              }
              setDropdownOpen(false);
              await upload([file]);
              return false;
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
            { type: 'divider' },
            {
              children: skillMenuItems,
              icon: activeIcon(SkillsIcon, activeSkillCount > 0),
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
            },
            {
              icon: Store,
              key: 'add-skills',
              label: t('plus.addSkills'),
              onClick: handleOpenTools,
            },
          ]
        : [];

    const capabilityItems: ActionDropdownMenuItems = [
      { type: 'divider' },
      // Rich text toolbar toggle
      {
        icon: TypeIcon,
        key: 'typo',
        label: renderActive(
          tEditor(showTypoBar ? 'actions.typobar.off' : 'actions.typobar.on'),
          Boolean(showTypoBar),
        ),
        onClick: () => setShowTypoBar(!showTypoBar),
      },
      { type: 'divider' },
      // Memory toggle
      {
        icon: activeIcon(isMemoryEnabled ? Brain : BrainOffIcon, Boolean(isMemoryEnabled)),
        key: 'memory',
        label: renderActive(t('memory.title'), Boolean(isMemoryEnabled)),
        onClick: handleToggleMemory,
      },
      // Web search: simple toggle when 2 options, submenu when 3
      ...(showProviderSearch
        ? [
            {
              children: [
                {
                  key: 'search-off',
                  label: renderSearchOption(
                    <Icon icon={GlobeOffIcon} size={18} />,
                    t('plus.search.off'),
                    t('plus.search.offDesc'),
                    activeSearchOption === 'off',
                  ),
                  onClick: () => handleSelectSearch('off'),
                },
                {
                  key: 'search-app',
                  label: renderSearchOption(
                    <Icon
                      color={activeSearchOption === 'app' ? cssVar.colorInfo : undefined}
                      icon={SearchCheck}
                      size={18}
                    />,
                    t('plus.search.appSearch'),
                    t('plus.search.appSearchDesc'),
                    activeSearchOption === 'app',
                  ),
                  onClick: () => handleSelectSearch('app'),
                },
                {
                  key: 'search-provider',
                  label: renderSearchOption(
                    <Icon
                      color={activeSearchOption === 'provider' ? cssVar.colorInfo : undefined}
                      icon={CloudCog}
                      size={18}
                    />,
                    t('plus.search.modelSearch'),
                    t('plus.search.modelSearchDesc'),
                    activeSearchOption === 'provider',
                  ),
                  onClick: () => handleSelectSearch('provider'),
                },
              ],
              icon: activeIcon(
                activeSearchOption === 'off' ? GlobeOffIcon : Globe,
                activeSearchOption !== 'off',
              ),
              key: 'search-group',
              label: t('search.title'),
            } as ActionDropdownMenuItems[number],
          ]
        : [
            {
              icon: activeIcon(
                activeSearchOption === 'off' ? GlobeOffIcon : Globe,
                activeSearchOption !== 'off',
              ),
              key: 'search-toggle',
              label: renderActive(t('search.title'), activeSearchOption !== 'off'),
              onClick: () => handleSelectSearch(activeSearchOption === 'off' ? 'app' : 'off'),
            } as ActionDropdownMenuItems[number],
          ]),
      ...toolsItems,
    ];

    const knowledgeSectionItems: ActionDropdownMenuItems = enableKnowledgeBase
      ? [
          {
            children: knowledgeItems,
            icon: activeIcon(LibraryBig, knowledgeEnabledCount > 0),
            key: 'knowledge-base',
            label: renderLabelWithCount(t('knowledgeBase.title'), knowledgeEnabledCount),
          } as ActionDropdownMenuItems[number],
        ]
      : [];

    return [...uploadItems, ...knowledgeSectionItems, ...capabilityItems];
  }, [
    activeSearchOption,
    canUploadImage,
    canUploadVideo,
    enableFC,
    enableKnowledgeBase,
    handleOpenTools,
    handleSelectSearch,
    handleToggleMemory,
    isAgentModeEnabled,
    isMemoryEnabled,
    knowledgeEnabledCount,
    setShowTypoBar,
    showProviderSearch,
    showTypoBar,
    skillActivateMode,
    skillAutoCount,
    skillPinnedCount,
    knowledgeItems,
    t,
    tEditor,
    tSetting,
    skillItems,
    upload,
  ]);

  return (
    <>
      <Action
        icon={PlusIcon}
        open={dropdownOpen}
        size={{ blockSize: 32, borderRadius: 16, size: 18 }}
        title={t('plus.tooltip')}
        tooltipProps={{ placement: 'top' }}
        dropdown={{
          menu: { items },
          minWidth: 220,
          placement: 'topLeft',
        }}
        onOpenChange={setDropdownOpen}
      />
      {skillEditPluginDrawer}
    </>
  );
});

PlusAction.displayName = 'PlusAction';

const Plus = memo(() => (
  <Suspense
    fallback={
      <Action
        disabled
        icon={PlusIcon}
        size={{ blockSize: 32, borderRadius: 16, size: 18 }}
        title=""
      />
    }
  >
    <PlusAction />
  </Suspense>
));

Plus.displayName = 'Plus';

export default Plus;
