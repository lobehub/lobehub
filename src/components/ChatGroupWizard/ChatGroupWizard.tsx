'use client';

import { Avatar, Collapse, GroupAvatar, List, Modal, SearchBar, Text, Tooltip } from '@lobehub/ui';
import { Button, Checkbox, Empty, Switch } from 'antd';
import { createStyles, useTheme } from 'antd-style';
import { omit } from 'lodash-es';
import { Users } from 'lucide-react';
import { ChangeEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { DEFAULT_AVATAR } from '@/const/meta';
import ModelSelect from '@/features/ModelSelect';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useSessionStore } from '@/store/session';
import { LobeAgentSession, LobeSessionType } from '@/types/session';

import { GroupTemplate, useGroupTemplates } from './templates';

const TemplateItem = memo<{
  cx: (..._args: any[]) => string;
  isSelected: boolean;
  onToggle: (_templateId: string) => void;
  styles: Record<string, string>;
  template: GroupTemplate;
}>(({ template, isSelected, onToggle, styles, cx }) => {
  const { t } = useTranslation('chat');

  return (
    <div className={cx(styles.listItem)} onClick={() => onToggle(template.id)}>
      <Flexbox align="center" gap={12} horizontal width="100%">
        <Checkbox
          checked={isSelected}
          onChange={() => onToggle(template.id)}
          onClick={(e) => e.stopPropagation()}
        />
        <GroupAvatar
          avatars={template.members
            .filter((member) => member !== null && member !== undefined)
            .map((member) => ({
              avatar: member.avatar || DEFAULT_AVATAR,
              background: member.backgroundColor || undefined,
            }))}
          size={40}
        />
        <Flexbox flex={1} gap={2}>
          <Text className={styles.title}>{template.title}</Text>
          <Text className={styles.description} ellipsis>
            {template.description}
          </Text>
          <Flexbox align="center" gap={4} horizontal>
            <Users size={11} style={{ color: '#999' }} />
            <Text style={{ fontSize: 11 }} type="secondary">
              {t('groupWizard.memberCount', {
                count: template.members.filter((member) => member !== null && member !== undefined)
                  .length,
              })}
            </Text>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </div>
  );
});

const ExistingMemberItem = memo<{
  agent: LobeAgentSession;
  cx: (..._args: any[]) => string;
  isSelected: boolean;
  onToggle: (_agentId: string) => void;
  styles: Record<string, string>;
}>(({ agent, isSelected, onToggle, styles, cx }) => {
  const { t } = useTranslation(['chat', 'common']);
  const agentId = agent.config?.id;
  const title = agent.meta?.title || t('defaultSession', { ns: 'common' });
  const description = agent.meta?.description || '';
  const avatar = agent.meta?.avatar || DEFAULT_AVATAR;
  const avatarBackground = agent.meta?.backgroundColor;

  if (!agentId) return null;

  return (
    <div className={cx(styles.listItem)} onClick={() => onToggle(agentId)}>
      <Flexbox align="center" gap={12} horizontal width="100%">
        <Checkbox
          checked={isSelected}
          onChange={() => onToggle(agentId)}
          onClick={(e) => e.stopPropagation()}
        />
        <Avatar avatar={avatar} background={avatarBackground} shape="circle" size={40} />
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text className={styles.title}>{title}</Text>
          {description && (
            <Text className={styles.description} ellipsis>
              {description}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
    </div>
  );
});

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-direction: row;

    height: 500px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;
  `,
  description: css`
    font-size: 12px;
    line-height: 1.2;
    color: ${token.colorTextSecondary};
  `,
  hostCard: css`
    margin-block-start: ${token.paddingSM}px;
    margin-inline: ${token.paddingSM}px;
    padding: ${token.padding}px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillTertiary};
  `,
  leftColumn: css`
    user-select: none;

    overflow-y: auto;
    flex: 1;

    padding: 0;
    border-inline-end: 1px solid ${token.colorBorderSecondary};
  `,
  listHeader: css`
    padding: 0;
    color: ${token.colorTextDescription};
  `,
  listItem: css`
    cursor: pointer;

    position: relative;

    margin-block: 2px;
    padding: ${token.paddingSM}px !important;
    border-radius: ${token.borderRadius}px;

    transition: all 0.2s ease;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  memberDescription: css`
    display: block;
    padding-inline-end: 48px;
  `,
  modelSelectDisabled: css`
    pointer-events: none;
  `,
  rightColumn: css`
    overflow-y: auto;
    display: flex;
    flex: 1;
    flex-direction: column;

    padding: 0;
  `,
  title: css`
    font-size: 14px;
    font-weight: 500;
  `,
}));

export interface ChatGroupWizardProps {
  /**
   * External loading state for template creation (controlled by parent)
   */
  isCreatingFromTemplate?: boolean;
  onCancel: () => void;
  onCreateCustom: (
    selectedAgents: string[],
    hostConfig?: { model?: string; provider?: string },
    enableSupervisor?: boolean,
  ) => void | Promise<void>;
  onCreateFromTemplate: (
    templateId: string,
    hostConfig?: { model?: string; provider?: string },
    enableSupervisor?: boolean,
    selectedMemberTitles?: string[],
  ) => void | Promise<void>;
  open: boolean;
}

const ChatGroupWizard = memo<ChatGroupWizardProps>(
  ({
    onCancel,
    onCreateFromTemplate,
    onCreateCustom,
    open,
    isCreatingFromTemplate: externalLoading,
  }) => {
    const { t } = useTranslation(['chat', 'common']);
    const { styles, cx } = useStyles();
    const theme = useTheme();
    const groupTemplates = useGroupTemplates();
    const enabledModels = useEnabledChatModels();
    const agentSessions = useSessionStore((s) =>
      (s.sessions || []).filter((session) => session.type === LobeSessionType.Agent),
    );

    const visibleAgentSessions = useMemo(
      () => agentSessions.filter((session) => !session.config?.virtual),
      [agentSessions],
    );

    const memberDescriptionClass = useMemo(
      () => cx(styles.description, styles.memberDescription),
      [cx, styles.description, styles.memberDescription],
    );

    const defaultModel = useMemo(() => {
      if (enabledModels.length > 0 && enabledModels[0].children.length > 0) {
        const firstProvider = enabledModels[0];
        const firstModel = firstProvider.children[0];

        return {
          model: firstModel.id,
          provider: firstProvider.id,
        };
      }
      return { model: undefined, provider: undefined };
    }, [enabledModels]);

    const [inputValue, setInputValue] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState<string>('');
    const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
    const [removedMembers, setRemovedMembers] = useState<Record<string, string[]>>({});
    const [isHostRemoved, setIsHostRemoved] = useState(false);
    const [hostModelConfig, setHostModelConfig] = useState<{ model?: string; provider?: string }>(
      defaultModel.model && defaultModel.provider ? defaultModel : {},
    );
    const [isCreatingCustom, setIsCreatingCustom] = useState(false);
    const [activePanel, setActivePanel] = useState<'templates' | 'agents'>('templates');

    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isCreatingFromTemplate = externalLoading ?? false;

    const handleTemplateToggle = useCallback((templateId: string) => {
      setSelectedTemplate((prev) => {
        const next = prev === templateId ? '' : templateId;

        if (next !== prev) {
          setRemovedMembers({});
          setIsHostRemoved(false);
        }

        if (next) {
          setSelectedAgents([]);
        }

        return next;
      });
    }, []);

    const handleAgentToggle = useCallback((agentId: string) => {
      setSelectedTemplate('');
      setRemovedMembers({});
      setSelectedAgents((prev) =>
        prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId],
      );
    }, []);

    const handleRemoveAgent = useCallback((agentId: string) => {
      setSelectedAgents((prev) => prev.filter((id) => id !== agentId));
    }, []);

    const handleReset = () => {
      setSelectedTemplate('');
      setSelectedAgents([]);
      setInputValue('');
      setSearchTerm('');
      setRemovedMembers({});
      setIsHostRemoved(false);
      setHostModelConfig(defaultModel.model && defaultModel.provider ? defaultModel : {});

      // Clear any pending debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };

    const handleHostModelChange = useCallback((config: { model?: string; provider?: string }) => {
      setHostModelConfig(config);
    }, []);

    const handleToggleMember = useCallback(
      (templateId: string, memberTitle: string, enabled: boolean) => {
        setRemovedMembers((prev) => {
          const current = prev[templateId] || [];

          if (enabled) {
            const next = current.filter((title) => title !== memberTitle);

            if (next.length === 0) {
              return omit(prev, [templateId]);
            }

            return { ...prev, [templateId]: next };
          }

          if (current.includes(memberTitle)) return prev;

          return {
            ...prev,
            [templateId]: [...current, memberTitle],
          };
        });
      },
      [],
    );

    const handleHostToggle = useCallback((enabled: boolean) => {
      setIsHostRemoved(!enabled);
    }, []);

    const handleSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setInputValue(value);

      // Clear previous timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Set new timer to update searchTerm after 300ms
      debounceTimerRef.current = setTimeout(() => {
        setSearchTerm(value);
      }, 300);
    }, []);

    const agentCount = visibleAgentSessions.length;

    // Cleanup debounce timer on unmount
    useEffect(() => {
      return () => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
      };
    }, []);

    useEffect(() => {
      if (!open) return;

      setActivePanel(agentCount > 2 ? 'agents' : 'templates');
    }, [open, agentCount]);

    useEffect(() => {
      setSelectedAgents((prev) =>
        prev.filter((id) => visibleAgentSessions.some((session) => session.config?.id === id)),
      );
    }, [visibleAgentSessions]);

    const handlePanelChange = useCallback((key: string | string[]) => {
      if (!key) return;

      const nextKey = Array.isArray(key) ? key[0] : key;

      if (nextKey === 'templates' || nextKey === 'agents') {
        setActivePanel(nextKey);
      }
    }, []);

    const filteredTemplates = useMemo(() => {
      const searchLower = searchTerm.trim().toLowerCase();
      if (!searchLower) return groupTemplates;

      return groupTemplates.filter((template) => {
        if (template.title.toLowerCase().includes(searchLower)) return true;
        if (template.description.toLowerCase().includes(searchLower)) return true;

        return template.members.some(
          (member) =>
            member !== null &&
            member !== undefined &&
            member.title.toLowerCase().includes(searchLower),
        );
      });
    }, [groupTemplates, searchTerm]);

    const filteredAgents = useMemo(() => {
      const searchLower = searchTerm.trim().toLowerCase();
      if (!searchLower) return visibleAgentSessions;

      return visibleAgentSessions.filter((agent) => {
        const title = agent.meta?.title || '';
        const description = agent.meta?.description || '';

        return (
          title.toLowerCase().includes(searchLower) ||
          description.toLowerCase().includes(searchLower)
        );
      });
    }, [visibleAgentSessions, searchTerm]);

    const templateMemberItems = useMemo(() => {
      if (!selectedTemplate) return [];

      const template = groupTemplates.find((t) => t.id === selectedTemplate);
      if (!template) return [];

      const removedForTemplate = new Set(removedMembers[selectedTemplate] || []);

      return template.members
        .filter((member) => member !== null && member !== undefined)
        .map((member) => ({
          avatar: member.avatar || DEFAULT_AVATAR,
          backgroundColor: member.backgroundColor,
          description: member.systemRole,
          isRemoved: removedForTemplate.has(member.title),
          key: `${selectedTemplate}-${member.title}`,
          systemRole: member.systemRole,
          title: member.title,
        }));
    }, [selectedTemplate, removedMembers, groupTemplates]);

    const activeTemplateMembersCount = useMemo(
      () => templateMemberItems.filter((member) => !member.isRemoved).length,
      [templateMemberItems],
    );

    const selectedAgentListItems = useMemo(() => {
      return (
        selectedAgents
          .map((agentId) => {
            const agent = agentSessions.find((session) => session.config?.id === agentId);
            if (!agent) return null;

            const title = agent.meta?.title || t('defaultSession', { ns: 'common' });
            const avatar = agent.meta?.avatar || DEFAULT_AVATAR;
            const avatarBackground = agent.meta?.backgroundColor;
            const description = agent.meta?.description || '';

            return {
              actions: (
                <Switch
                  checked
                  onChange={(checked) => {
                    if (!checked) handleRemoveAgent(agentId);
                  }}
                  size="small"
                />
              ),
              avatar: (
                <Avatar avatar={avatar} background={avatarBackground} shape="circle" size={40} />
              ),
              description: description ? (
                <Tooltip title={description}>
                  <Text className={memberDescriptionClass} ellipsis={{ rows: 1 }}>
                    {description}
                  </Text>
                </Tooltip>
              ) : null,
              key: agentId,
              showAction: true,
              title,
            };
          })
          // eslint-disable-next-line unicorn/prefer-native-coercion-functions
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      );
    }, [selectedAgents, agentSessions, t, handleRemoveAgent, memberDescriptionClass]);

    const normalizedHostModelConfig = useMemo(() => {
      const model = hostModelConfig.model ?? defaultModel.model;
      const provider = hostModelConfig.provider ?? defaultModel.provider;

      if (!model || !provider) return undefined;

      return { model, provider };
    }, [hostModelConfig, defaultModel]);

    const handleTemplateConfirm = useCallback(async () => {
      if (!selectedTemplate) return;

      const hostConfig = isHostRemoved ? undefined : normalizedHostModelConfig;

      try {
        // collect selected member titles (not removed)
        const template = groupTemplates.find((t) => t.id === selectedTemplate);
        const removedForTemplate = new Set(removedMembers[selectedTemplate] || []);
        const selectedMemberTitles = (template?.members || [])
          .filter((m) => m !== null && m !== undefined && !removedForTemplate.has(m.title))
          .map((m) => m.title);

        await onCreateFromTemplate(
          selectedTemplate,
          hostConfig,
          !isHostRemoved,
          selectedMemberTitles,
        );
        handleReset();
      } catch (error) {
        console.error('Failed to create group from template:', error);
      }
    }, [
      selectedTemplate,
      onCreateFromTemplate,
      normalizedHostModelConfig,
      isHostRemoved,
      groupTemplates,
      removedMembers,
    ]);

    const handleCustomConfirm = useCallback(async () => {
      if (selectedAgents.length === 0) return;

      const hostConfig = isHostRemoved ? undefined : normalizedHostModelConfig;

      try {
        setIsCreatingCustom(true);
        await onCreateCustom(selectedAgents, hostConfig, !isHostRemoved);
        handleReset();
        onCancel();
      } catch (error) {
        console.error('Failed to create group with selected members:', error);
      } finally {
        setIsCreatingCustom(false);
      }
    }, [selectedAgents, onCreateCustom, normalizedHostModelConfig, isHostRemoved, onCancel]);

    const handleConfirm = useCallback(async () => {
      if (selectedTemplate) {
        await handleTemplateConfirm();
        return;
      }

      await handleCustomConfirm();
    }, [selectedTemplate, handleTemplateConfirm, handleCustomConfirm]);

    const handleCancel = () => {
      handleReset();
      onCancel();
    };

    const confirmDisabled = selectedTemplate
      ? activeTemplateMembersCount === 0 && isHostRemoved
      : selectedAgents.length === 0;

    const confirmLoading = selectedTemplate ? isCreatingFromTemplate : isCreatingCustom;

    return (
      <Modal
        footer={
          <Flexbox gap={8} horizontal justify="end">
            <Button onClick={handleCancel}>{t('cancel', { ns: 'common' })}</Button>
            <Button
              disabled={confirmDisabled}
              loading={confirmLoading}
              onClick={handleConfirm}
              type="primary"
            >
              {t('groupWizard.createGroup')}
            </Button>
          </Flexbox>
        }
        onCancel={handleCancel}
        open={open}
        title={t('groupWizard.title')}
        width={900}
      >
        <Flexbox className={styles.container} horizontal>
          <Flexbox className={styles.leftColumn} flex={1} gap={12}>
            <SearchBar
              allowClear
              onChange={handleSearchChange}
              placeholder={t('memberSelection.searchAgents')}
              style={{ margin: `${theme.paddingSM}px ${theme.paddingSM}px 0 ${theme.paddingSM}px` }}
              value={inputValue}
              variant="filled"
            />
            <Flexbox flex={1} style={{ overflowY: 'auto', padding: `0 ${theme.paddingSM}px` }}>
              <Collapse
                accordion
                activeKey={activePanel}
                collapsible
                expandIconPosition="end"
                gap={12}
                items={[
                  {
                    children:
                      filteredTemplates.length === 0 ? (
                        <Empty
                          description={
                            searchTerm
                              ? t('groupWizard.noMatchingTemplates')
                              : t('groupWizard.noTemplates')
                          }
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                      ) : (
                        <Flexbox gap={4}>
                          {filteredTemplates.map((template) => (
                            <TemplateItem
                              cx={cx}
                              isSelected={selectedTemplate === template.id}
                              key={template.id}
                              onToggle={handleTemplateToggle}
                              styles={styles}
                              template={template}
                            />
                          ))}
                        </Flexbox>
                      ),
                    key: 'templates',
                    label: t('groupWizard.useTemplate'),
                  },
                  {
                    children:
                      filteredAgents.length === 0 ? (
                        <Empty
                          description={
                            searchTerm
                              ? t('noMatchingAgents', { ns: 'chat' })
                              : t('noAvailableAgents', { ns: 'chat' })
                          }
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                      ) : (
                        <Flexbox gap={4}>
                          {filteredAgents.map((agent) => (
                            <ExistingMemberItem
                              agent={agent}
                              cx={cx}
                              isSelected={selectedAgents.includes(agent.config?.id || '')}
                              key={agent.id}
                              onToggle={handleAgentToggle}
                              styles={styles}
                            />
                          ))}
                        </Flexbox>
                      ),
                    key: 'agents',
                    label: t('groupWizard.existingMembers'),
                  },
                ]}
                onChange={handlePanelChange}
                size="small"
                styles={{
                  header: {
                    color: theme.colorTextDescription,
                    fontSize: theme.fontSize,
                    padding: 0,
                  },
                }}
                variant="borderless"
              />
            </Flexbox>
          </Flexbox>

          <Flexbox className={styles.rightColumn} flex={1}>
            <Flexbox flex={1} gap={16} style={{ overflowY: 'auto' }}>
              <Flexbox align="center" className={styles.hostCard} gap={12} horizontal>
                <Flexbox flex={1} gap={2}>
                  <Text
                    style={{ fontSize: 14, fontWeight: 500 }}
                    type={isHostRemoved ? 'secondary' : undefined}
                  >
                    {t('groupWizard.host.title')}
                  </Text>
                  <Text
                    style={{ color: '#999', fontSize: 12 }}
                    type={isHostRemoved ? 'secondary' : undefined}
                  >
                    {t('groupWizard.host.description')}
                  </Text>
                </Flexbox>
                <Flexbox align="center" gap={12} horizontal>
                  <div
                    className={cx(isHostRemoved && styles.modelSelectDisabled)}
                    style={{ opacity: isHostRemoved ? 0.6 : 1 }}
                  >
                    <ModelSelect
                      onChange={handleHostModelChange}
                      requiredAbilities={['functionCall']}
                      value={normalizedHostModelConfig}
                    />
                  </div>
                  <Tooltip title={t('groupWizard.host.tooltip')}>
                    <Switch
                      checked={!isHostRemoved}
                      onChange={(checked) => handleHostToggle(checked)}
                      size="small"
                    />
                  </Tooltip>
                </Flexbox>
              </Flexbox>

              <Flexbox style={{ padding: `0 ${theme.paddingSM}px` }}>
                {selectedTemplate ? (
                  templateMemberItems.length > 0 ? (
                    <List
                      items={templateMemberItems.map((member) => ({
                        actions: (
                          <Switch
                            checked={!member.isRemoved}
                            onChange={(checked) =>
                              handleToggleMember(selectedTemplate, member.title, checked)
                            }
                            size="small"
                          />
                        ),
                        avatar: (
                          <Avatar
                            avatar={member.avatar}
                            background={member.backgroundColor}
                            shape="circle"
                            size={40}
                          />
                        ),
                        description: member.systemRole ? (
                          <Tooltip title={member.systemRole}>
                            <Text
                              className={memberDescriptionClass}
                              ellipsis={{ rows: 1 }}
                              type={member.isRemoved ? 'secondary' : undefined}
                            >
                              {member.systemRole}
                            </Text>
                          </Tooltip>
                        ) : null,
                        key: member.key,
                        showAction: true,
                        title: (
                          <Text type={member.isRemoved ? 'secondary' : undefined}>
                            {member.title}
                          </Text>
                        ),
                      }))}
                    />
                  ) : (
                    <Empty
                      description={t('groupWizard.noTemplateMembers')}
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                  )
                ) : selectedAgentListItems.length > 0 ? (
                  <List items={selectedAgentListItems} />
                ) : (
                  <Empty
                    description={t('memberSelection.noSelectedAgents')}
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                )}
              </Flexbox>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </Modal>
    );
  },
);

export default ChatGroupWizard;
