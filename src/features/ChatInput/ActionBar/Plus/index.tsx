'use client';

import { validateVideoFileSize } from '@lobechat/utils/client';
import { Icon, type IconProps } from '@lobehub/ui';
import { BrainOffIcon, GlobeOffIcon } from '@lobehub/ui/icons';
import { Upload } from 'antd';
import { css, cssVar, cx } from 'antd-style';
import {
  Blocks,
  Brain,
  CheckIcon,
  FileUp,
  Globe,
  ImageUp,
  PlusIcon,
  SparkleIcon,
  TypeIcon,
  WandSparklesIcon,
} from 'lucide-react';
import { memo, Suspense, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
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

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import { useChatInputStore } from '../../store';
import Action from '../components/Action';
import { type ActionDropdownMenuItems } from '../components/ActionDropdown';
import { useMemoryEnabled } from '../Memory/useMemoryEnabled';

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

const activeIcon = (icon: IconProps['icon'], active?: boolean): IconProps['icon'] =>
  active ? <Icon color={cssVar.colorInfo} icon={icon} size={16} /> : icon;

const PlusAction = memo(() => {
  const { t } = useTranslation('chat');
  const { t: tEditor } = useTranslation('editor');
  const { t: tSetting } = useTranslation('setting');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const upload = useFileStore((s) => s.uploadChatFiles);

  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(agentId)(s));
  const provider = useAgentStore((s) => agentByIdSelectors.getAgentModelProviderById(agentId)(s));
  const isAgentModeEnabled = useAgentStore(agentSelectors.isAgentModeEnabled);
  const [searchMode, useModelBuiltinSearch] = useAgentStore((s) => [
    chatConfigByIdSelectors.getSearchModeById(agentId)(s),
    chatConfigByIdSelectors.getUseModelBuiltinSearchById(agentId)(s),
  ]);

  const isMemoryEnabled = useMemoryEnabled(agentId);
  const [showTypoBar, setShowTypoBar] = useChatInputStore((s) => [s.showTypoBar, s.setShowTypoBar]);
  const { canUploadImage, canUploadVideo } = useVisualMediaUploadAbility(model, provider);
  const enableFC = useModelSupportToolUse(model, provider);

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

    const uploadItems: ActionDropdownMenuItems = [
      {
        closeOnClick: false,
        disabled: !canUploadImage,
        icon: ImageUp,
        key: 'upload-image',
        label: canUploadImage ? (
          <Upload
            multiple
            accept={'image/*'}
            showUploadList={false}
            beforeUpload={async (file) => {
              setDropdownOpen(false);
              await upload([file]);
              return false;
            }}
          >
            <div className={cx(hotArea)}>{t('upload.action.imageUpload')}</div>
          </Upload>
        ) : (
          <div className={cx(hotArea)}>{t('upload.action.imageUpload')}</div>
        ),
      },
      {
        closeOnClick: false,
        icon: FileUp,
        key: 'upload-file',
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
            <div className={cx(hotArea)}>{t('upload.action.fileUpload')}</div>
          </Upload>
        ),
      },
    ];

    const toolsItems: ActionDropdownMenuItems =
      isAgentModeEnabled && enableFC
        ? [
            { type: 'divider' },
            {
              icon: Blocks,
              key: 'tools',
              label: tSetting('tools.title'),
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
                  icon: GlobeOffIcon,
                  key: 'search-off',
                  label: renderActive(t('plus.search.off'), activeSearchOption === 'off'),
                  onClick: () => handleSelectSearch('off'),
                },
                {
                  icon: activeIcon(SparkleIcon, activeSearchOption === 'app'),
                  key: 'search-app',
                  label: renderActive(t('plus.search.appSearch'), activeSearchOption === 'app'),
                  onClick: () => handleSelectSearch('app'),
                },
                {
                  icon: activeIcon(WandSparklesIcon, activeSearchOption === 'provider'),
                  key: 'search-provider',
                  label: renderActive(
                    t('plus.search.modelSearch'),
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

    return [...uploadItems, ...capabilityItems];
  }, [
    activeSearchOption,
    canUploadImage,
    canUploadVideo,
    enableFC,
    handleOpenTools,
    handleSelectSearch,
    handleToggleMemory,
    isAgentModeEnabled,
    isMemoryEnabled,
    setShowTypoBar,
    showProviderSearch,
    showTypoBar,
    t,
    tEditor,
    tSetting,
    upload,
  ]);

  return (
    <Action
      icon={PlusIcon}
      open={dropdownOpen}
      title={t('plus.title')}
      dropdown={{
        menu: { items },
        minWidth: 220,
        placement: 'topLeft',
      }}
      onOpenChange={setDropdownOpen}
    />
  );
});

PlusAction.displayName = 'PlusAction';

const Plus = memo(() => (
  <Suspense fallback={<Action disabled icon={PlusIcon} title="" />}>
    <PlusAction />
  </Suspense>
));

Plus.displayName = 'Plus';

export default Plus;
