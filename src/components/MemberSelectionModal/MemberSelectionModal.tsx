'use client';

import { agentDisplayName, type SidebarAgentItem } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  Checkbox,
  Flexbox,
  List,
  ModalFooter,
  SearchBar,
  Switch,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { useHover } from 'ahooks';
import { X } from 'lucide-react';
import { type ChangeEvent } from 'react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import ImperativeModal from '@/components/ImperativeModal';
import AgentSelectionEmpty from '@/features/AgentSelectionEmpty';
import ModelSelect from '@/features/ModelSelect';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { sx } from '@/styles/sx';

const AvailableAgentItem = memo<{
  agent: SidebarAgentItem;
  isSelected: boolean;
  onToggle: (_agentId: string) => void;
  t: any;
}>(({ agent, isSelected, onToggle, t }) => {
  const ref = useRef<HTMLDivElement>(null);
  const isHovering = useHover(ref);

  const _agentId = agent.id;
  const title = agentDisplayName(agent, t('defaultSession', { ns: 'common' }));
  const description = agent.description || '';
  const avatar = typeof agent.avatar === 'string' ? agent.avatar : undefined;
  const avatarBackground = agent.backgroundColor || undefined;

  if (!_agentId) return null;

  return (
    <div {...stylex.props(styles.listItem)} ref={ref} onClick={() => onToggle(_agentId)}>
      <Flexbox horizontal align="center" gap={12} width="100%">
        <Checkbox
          checked={isSelected}
          onChange={() => {
            onToggle(_agentId);
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        />
        <Flexbox style={{ flexShrink: 0 }}>
          <AgentAvatar
            agentId={_agentId}
            animation={isHovering}
            avatar={avatar}
            background={avatarBackground}
            name={title}
            shape={'circle'}
            size={40}
          />
        </Flexbox>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text weight={500}>{title}</Text>
          {description && (
            <Text ellipsis className={stylex.props(styles.description).className}>
              {description}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
    </div>
  );
});

const styles = stylex.create({
  container: {
    display: 'flex',
    flexDirection: { default: 'row', [media.sm]: 'column' },
    height: { default: '500px', [media.sm]: 'min(500px, calc(100dvh - 160px))' },
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
  description: {
    fontSize: '11px',
    lineHeight: 1.2,
    color: cssVar.colorTextSecondary,
  },
  hostCard: {
    marginBlockEnd: cssVar.paddingSM,
    padding: cssVar.padding,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
    flexDirection: { default: null, [media.sm]: 'column' },
    alignItems: { default: null, [media.sm]: 'stretch' },
  },
  hostModelSelect: {
    flex: { default: null, [media.sm]: '1' },
    minWidth: { default: null, [media.sm]: 0 },
  },
  leftColumn: {
    userSelect: 'none',
    overflowY: 'auto',
    flex: '1',
    paddingBlockStart: cssVar.paddingSM,
    paddingBlockEnd: 0,
    paddingInline: cssVar.paddingSM,
    minHeight: { default: null, [media.sm]: 0 },
    borderBlockEndWidth: { default: null, [media.sm]: '1px' },
    borderBlockEndStyle: { default: null, [media.sm]: 'solid' },
    borderBlockEndColor: { default: null, [media.sm]: cssVar.colorBorderSecondary },
    borderInlineEndWidth: { default: '1px', [media.sm]: 0 },
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: cssVar.colorBorderSecondary,
  },
  listItem: {
    cursor: 'pointer',
    position: 'relative',
    marginBlock: '2px',
    padding: cssVar.paddingSM,
    borderRadius: cssVar.borderRadius,
    transition: 'all 0.2s ease',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  modelSelectDisabled: { pointerEvents: 'none' },
  rightColumn: {
    overflowY: 'auto',
    flex: '1',
    padding: cssVar.paddingSM,
    minHeight: { default: null, [media.sm]: 0 },
  },
});

export type MemberSelectionMode = 'create' | 'add';

export interface MemberSelectionModalProps {
  /**
   * Current host configuration (for add mode)
   */
  currentHostConfig?: {
    enableSupervisor?: boolean;
    orchestratorModel?: string;
    orchestratorProvider?: string;
  };
  /**
   * Existing group members to exclude from available agents (for add mode)
   */
  existingMembers?: string[];
  /**
   * Group ID for add mode (required when mode is 'add')
   */
  groupId?: string;
  /**
   * The mode of the modal:
   * - 'create': For selecting initial members when creating a new group
   * - 'add': For adding members to an existing group
   */
  mode: MemberSelectionMode;
  onCancel: () => void;
  onConfirm: (selectedAgents: string[]) => void | Promise<void>;
  open: boolean;
  /**
   * Pre-selected agent IDs (useful for editing existing groups)
   */
  preSelectedAgents?: string[];
}

const MemberSelectionModal = memo<MemberSelectionModalProps>(
  ({
    currentHostConfig,
    existingMembers = [],
    mode,
    onCancel,
    onConfirm,
    open,
    preSelectedAgents = [],
  }) => {
    const { t } = useTranslation(['chat', 'common']);
    const enabledModels = useEnabledChatModels();
    const [selectedAgents, setSelectedAgents] = useState<string[]>(preSelectedAgents);
    const [searchTerm, setSearchTerm] = useState('');

    // Determine if host card should be shown
    const isHostCurrentlyEnabled = mode === 'add' && currentHostConfig?.enableSupervisor === true;

    // Initialize host state:
    // - In create mode: default to enabled (isHostRemoved = false)
    // - In add mode with host disabled: default to disabled (isHostRemoved = true)
    const [isHostRemoved, setIsHostRemoved] = useState(mode === 'add' ? true : false);
    const [hostModelConfig, setHostModelConfig] = useState<{ model?: string; provider?: string }>(
      () => {
        if (mode === 'add' && currentHostConfig) {
          return {
            model: currentHostConfig.orchestratorModel,
            provider: currentHostConfig.orchestratorProvider,
          };
        }
        // Set default for create mode
        if (enabledModels.length > 0 && enabledModels[0].children.length > 0) {
          const firstProvider = enabledModels[0];
          const firstModel = firstProvider.children[0];

          return {
            model: firstModel.id,
            provider: firstProvider.id,
          };
        }
        return {};
      },
    );

    const isLogin = useUserStore(authSelectors.isLogin);
    const useFetchAgentList = useHomeStore((s) => s.useFetchAgentList);
    useFetchAgentList(open && isLogin);
    const agents = useHomeStore((s) =>
      homeAgentListSelectors.allAgents(s).filter((item) => item.type === 'agent'),
    );

    const handleAgentToggle = (agentId: string) => {
      setSelectedAgents((prev) =>
        prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId],
      );
    };

    const handleRemoveAgent = useCallback((agentId: string) => {
      setSelectedAgents((prev) => prev.filter((id) => id !== agentId));
    }, []);

    const handleSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
      setSearchTerm(e.target.value);
    }, []);

    const handleHostToggle = useCallback((enabled: boolean) => {
      setIsHostRemoved(!enabled);
    }, []);

    const handleHostModelChange = useCallback((config: { model?: string; provider?: string }) => {
      setHostModelConfig(config);
    }, []);

    // Filter logic based on mode
    const availableAgents = useMemo(() => {
      if (mode === 'create') {
        // When creating a new group, all agents are available
        return agents;
      } else {
        // Existing members already belong to the group and cannot be selected again.
        return agents.filter((agent) => !existingMembers.includes(agent.id || ''));
      }
    }, [agents, mode, existingMembers]);

    // Filter available agents based on search term
    const filteredAvailableAgents = useMemo(() => {
      if (!searchTerm.trim()) return availableAgents;

      return availableAgents.filter((agent) => {
        const title = agentDisplayName(agent) ?? '';
        const description = agent.description || '';
        const searchLower = searchTerm.toLowerCase();

        return (
          title.toLowerCase().includes(searchLower) ||
          description.toLowerCase().includes(searchLower)
        );
      });
    }, [availableAgents, searchTerm]);

    const selectedAgentListItems = useMemo(() => {
      return selectedAgents
        .map((agentId) => {
          const agent = agents.find((agent) => agent.id === agentId);
          if (!agent) return null;

          const title = agentDisplayName(agent, t('defaultSession', { ns: 'common' }));
          const avatar = typeof agent.avatar === 'string' ? agent.avatar : undefined;
          const avatarBackground = agent.backgroundColor || undefined;
          const description = agent.description || '';

          return {
            actions: (
              <ActionIcon
                icon={X}
                size="small"
                style={{ color: cssVar.colorTextTertiary }}
                onClick={() => handleRemoveAgent(agentId)}
              />
            ),
            avatar: (
              <AgentAvatar
                agentId={agentId}
                avatar={avatar}
                background={avatarBackground}
                name={title}
                shape="circle"
                size={40}
              />
            ),
            description,
            key: agentId,
            label: title,
            showAction: true,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
    }, [selectedAgents, agents, t, handleRemoveAgent]);

    const handleReset = () => {
      setSelectedAgents(preSelectedAgents);
      setSearchTerm('');
      setIsHostRemoved(mode === 'add' ? true : false);
      if (mode === 'add' && currentHostConfig) {
        setHostModelConfig({
          model: currentHostConfig.orchestratorModel,
          provider: currentHostConfig.orchestratorProvider,
        });
      }
    };

    const [isAdding, setIsAdding] = useState(false);

    const normalizedHostModelConfig = useMemo(() => {
      const model = hostModelConfig.model;
      const provider = hostModelConfig.provider;

      if (!model || !provider) return undefined;

      return { model, provider };
    }, [hostModelConfig]);

    const handleConfirm = async () => {
      try {
        setIsAdding(true);
        await onConfirm(selectedAgents);
        handleReset();
      } catch (error) {
        console.error('Failed to confirm action:', error);
      } finally {
        setIsAdding(false);
      }
    };

    const handleCancel = () => {
      handleReset();
      onCancel();
    };

    // Dynamic content based on mode
    const modalTitle =
      mode === 'create' ? t('memberSelection.setInitialMembers') : t('memberSelection.addMember');

    const confirmButtonText =
      mode === 'create' ? t('memberSelection.createGroup') : t('memberSelection.addMember');

    // Calculate total member count including host if enabled
    // Only count the host when the host card is visible (create mode or add mode with host disabled)
    const shouldShowHostCard = !isHostCurrentlyEnabled;
    const totalMemberCount = selectedAgents.length + (shouldShowHostCard && !isHostRemoved ? 1 : 0);

    const minMembersRequired = mode === 'create' ? 1 : 0; // At least 1 member for group creation
    const isConfirmDisabled = totalMemberCount < minMembersRequired || isAdding;

    return (
      <ImperativeModal
        allowFullscreen
        open={open}
        title={modalTitle}
        width={800}
        footer={
          <ModalFooter>
            <Button onClick={handleCancel}>{t('cancel', { ns: 'common' })}</Button>
            <Button
              disabled={isConfirmDisabled}
              loading={isAdding}
              type="primary"
              onClick={handleConfirm}
            >
              {confirmButtonText} ({totalMemberCount})
            </Button>
          </ModalFooter>
        }
        onCancel={handleCancel}
      >
        <Flexbox horizontal className={stylex.props(styles.container).className}>
          {/* Left Column - Available Agents */}
          <Flexbox className={stylex.props(styles.leftColumn).className} flex={1} gap={12}>
            <SearchBar
              allowClear
              placeholder={t('memberSelection.searchAgents')}
              value={searchTerm}
              variant="filled"
              onChange={handleSearchChange}
            />

            <Flexbox flex={1} style={{ overflowY: 'auto' }}>
              {filteredAvailableAgents.length === 0 ? (
                <AgentSelectionEmpty
                  search={Boolean(searchTerm)}
                  variant={searchTerm ? 'empty' : 'noAvailable'}
                />
              ) : (
                filteredAvailableAgents.map((agent) => {
                  const agentId = agent.id;
                  if (!agentId) return null;

                  return (
                    <AvailableAgentItem
                      agent={agent}
                      isSelected={selectedAgents.includes(agentId)}
                      key={agentId}
                      t={t}
                      onToggle={handleAgentToggle}
                    />
                  );
                })
              )}
            </Flexbox>
          </Flexbox>

          {/* Right Column - Host and Selected Agents */}
          <Flexbox className={stylex.props(styles.rightColumn).className} flex={1}>
            <Flexbox gap={16}>
              {/* Host Card - Only show in create mode or when host is disabled in add mode */}
              {!isHostCurrentlyEnabled && (
                <Flexbox
                  horizontal
                  align="center"
                  className={stylex.props(styles.hostCard).className}
                  gap={12}
                >
                  <Flexbox flex={1} gap={2}>
                    <Text
                      style={{ fontSize: 14, fontWeight: 500 }}
                      type={isHostRemoved ? 'secondary' : undefined}
                    >
                      {t('groupWizard.host.title')}
                    </Text>
                    <Text
                      style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}
                      type={isHostRemoved ? 'secondary' : undefined}
                    >
                      {t('groupWizard.host.description')}
                    </Text>
                  </Flexbox>
                  <Flexbox horizontal align="center" gap={12}>
                    <div
                      {...sx(
                        [styles.hostModelSelect, isHostRemoved && styles.modelSelectDisabled],
                        undefined,
                        { opacity: isHostRemoved ? 0.6 : 1 },
                      )}
                    >
                      <ModelSelect
                        requiredAbilities={['functionCall']}
                        style={{ maxWidth: '100%', minWidth: 'min(200px, 100%)' }}
                        value={normalizedHostModelConfig}
                        onChange={handleHostModelChange}
                      />
                    </div>
                    <Tooltip title={t('groupWizard.host.tooltip')}>
                      <Switch
                        checked={!isHostRemoved}
                        size="small"
                        onChange={(checked) => handleHostToggle(checked)}
                      />
                    </Tooltip>
                  </Flexbox>
                </Flexbox>
              )}

              {/* Selected Agents List */}
              <Flexbox flex={1}>
                {selectedAgentListItems.length === 0 ? (
                  <AgentSelectionEmpty variant="noSelected" />
                ) : (
                  <List
                    items={selectedAgentListItems}
                    styles={{ item: { paddingInlineEnd: 56 } }}
                  />
                )}
              </Flexbox>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </ImperativeModal>
    );
  },
);

export default MemberSelectionModal;
