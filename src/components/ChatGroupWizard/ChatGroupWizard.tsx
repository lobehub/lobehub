'use client';

import {
  Accordion,
  Button,
  Checkbox,
  Empty,
  Flexbox,
  List,
  ModalFooter,
  SearchBar,
  stopPropagation,
  Switch,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { omit } from 'es-toolkit/compat';
import { Users } from 'lucide-react';
import { type ChangeEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import ImperativeModal from '@/components/ImperativeModal';
import { DEFAULT_AVATAR } from '@/const/meta';
import GroupAvatar from '@/features/GroupAvatar';
import ModelSelect from '@/features/ModelSelect';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useSessionStore } from '@/store/session';
import { sx } from '@/styles/sx';
import { type LobeAgentSession } from '@/types/session';
import { LobeSessionType } from '@/types/session';

import { type GroupTemplate } from './templates';
import { useGroupTemplates } from './templates';

const styles = stylex.create({
  container: {
    display: 'flex',
    flexDirection: 'row',
    height: '500px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
  description: {
    fontSize: '12px',
    lineHeight: 1.2,
    color: cssVar.colorTextSecondary,
  },
  hostCard: {
    marginBlockStart: cssVar.paddingSM,
    marginInline: cssVar.paddingSM,
    padding: cssVar.padding,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  leftColumn: {
    userSelect: 'none',
    overflowY: 'auto',
    flex: '1',
    padding: '0',
    borderInlineEndWidth: '1px',
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
  memberDescription: {
    display: 'block',
    paddingInlineEnd: '48px',
  },
  modelSelectDisabled: {
    pointerEvents: 'none',
  },
  rightColumn: {
    overflowY: 'auto',
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    padding: '0',
  },
  title: {
    fontSize: '14px',
    fontWeight: 500,
  },
});

const memberDescriptionClass = stylex.props(styles.description, styles.memberDescription).className;

const TemplateItem = memo<{
  isSelected: boolean;
  onToggle: (_templateId: string) => void;
  template: GroupTemplate;
}>(({ template, isSelected, onToggle }) => {
  const { t } = useTranslation('chat');

  return (
    <div {...stylex.props(styles.listItem)} onClick={() => onToggle(template.id)}>
      <Flexbox horizontal align="center" gap={12} width="100%">
        <Checkbox
          checked={isSelected}
          onChange={() => onToggle(template.id)}
          onClick={stopPropagation}
        />
        <GroupAvatar
          size={40}
          avatars={template.members
            .filter((member) => member !== null && member !== undefined)
            .map((member) => ({
              avatar: member.avatar || DEFAULT_AVATAR,
              background: member.backgroundColor || undefined,
            }))}
        />
        <Flexbox flex={1} gap={2}>
          <Text className={stylex.props(styles.title).className}>{template.title}</Text>
          <Text ellipsis className={stylex.props(styles.description).className}>
            {template.description}
          </Text>
          <Flexbox horizontal align="center" gap={4}>
            <Users size={11} style={{ color: cssVar.colorTextTertiary }} />
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
  isSelected: boolean;
  onToggle: (_agentId: string) => void;
}>(({ agent, isSelected, onToggle }) => {
  const { t } = useTranslation(['chat', 'common']);
  const agentId = agent.config?.id;
  const title = agent.meta?.title || t('defaultSession', { ns: 'common' });
  const description = agent.meta?.description || '';
  const avatar = agent.meta?.avatar;
  const avatarBackground = agent.meta?.backgroundColor;

  if (!agentId) return null;

  return (
    <div {...stylex.props(styles.listItem)} onClick={() => onToggle(agentId)}>
      <Flexbox horizontal align="center" gap={12} width="100%">
        <Checkbox
          checked={isSelected}
          onChange={() => onToggle(agentId)}
          onClick={stopPropagation}
        />
        <AgentAvatar
          agentId={agentId}
          avatar={avatar}
          background={avatarBackground}
          name={title}
          shape={'circle'}
          size={40}
        />
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text className={stylex.props(styles.title).className}>{title}</Text>
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

export interface ChatGroupWizardProps {
  /**
   * External loading state for template creation (controlled by parent)
   */
  isCreatingFromTemplate?: boolean;
  onCancel: () => void;
  onCreateCustom: (selectedAgents: string[]) => void | Promise<void>;
  onCreateFromTemplate: (
    templateId: string,
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
    const groupTemplates = useGroupTemplates();
    const enabledModels = useEnabledChatModels();
    const agentSessions = useSessionStore((s) =>
      (s.sessions || []).filter((session) => session.type === LobeSessionType.Agent),
    );

    const visibleAgentSessions = useMemo(
      () => agentSessions.filter((session) => !session.config?.virtual),
      [agentSessions],
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

    const handleReset = useCallback(() => {
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
    }, [defaultModel]);

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

    const handlePanelChange = useCallback((keys: string[]) => {
      const nextKey = keys[0];

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
          avatar: member.avatar,
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
      return selectedAgents
        .map((agentId) => {
          const agent = agentSessions.find((session) => session.config?.id === agentId);
          if (!agent) return null;

          const title = agent.meta?.title || t('defaultSession', { ns: 'common' });
          const avatar = agent.meta?.avatar;
          const avatarBackground = agent.meta?.backgroundColor;
          const description = agent.meta?.description || '';

          return {
            actions: (
              <Switch
                checked
                size="small"
                onChange={(checked) => {
                  if (!checked) handleRemoveAgent(agentId);
                }}
              />
            ),
            avatar: (
              <AgentAvatar
                agentId={agentId}
                avatar={avatar}
                background={avatarBackground}
                name={title}
                shape={'circle'}
                size={40}
              />
            ),
            description: description ? (
              <Tooltip title={description}>
                <Text className={memberDescriptionClass} ellipsis={{ rows: 1 }}>
                  {description}
                </Text>
              </Tooltip>
            ) : null,
            key: agentId,
            label: title,
            showAction: true,
          };
        })

        .filter((item): item is NonNullable<typeof item> => Boolean(item));
    }, [selectedAgents, agentSessions, t, handleRemoveAgent]);

    const normalizedHostModelConfig = useMemo(() => {
      const model = hostModelConfig.model ?? defaultModel.model;
      const provider = hostModelConfig.provider ?? defaultModel.provider;

      if (!model || !provider) return undefined;

      return { model, provider };
    }, [hostModelConfig, defaultModel]);

    const handleTemplateConfirm = useCallback(async () => {
      if (!selectedTemplate) return;

      try {
        // collect selected member titles (not removed)
        const template = groupTemplates.find((t) => t.id === selectedTemplate);
        const removedForTemplate = new Set(removedMembers[selectedTemplate] || []);
        const selectedMemberTitles = (template?.members || [])
          .filter((m) => m !== null && m !== undefined && !removedForTemplate.has(m.title))
          .map((m) => m.title);

        await onCreateFromTemplate(selectedTemplate, selectedMemberTitles);
        handleReset();
      } catch (error) {
        console.error('Failed to create group from template:', error);
      }
    }, [selectedTemplate, onCreateFromTemplate, groupTemplates, removedMembers, handleReset]);

    const handleCustomConfirm = useCallback(async () => {
      if (selectedAgents.length === 0) return;

      try {
        setIsCreatingCustom(true);
        await onCreateCustom(selectedAgents);
        handleReset();
        onCancel();
      } catch (error) {
        console.error('Failed to create group with selected members:', error);
      } finally {
        setIsCreatingCustom(false);
      }
    }, [selectedAgents, onCreateCustom, onCancel, handleReset]);

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
      <ImperativeModal
        open={open}
        title={t('groupWizard.title')}
        width={900}
        footer={
          <ModalFooter>
            <Button onClick={handleCancel}>{t('cancel', { ns: 'common' })}</Button>
            <Button
              disabled={confirmDisabled}
              loading={confirmLoading}
              type="primary"
              onClick={handleConfirm}
            >
              {t('groupWizard.createGroup')}
            </Button>
          </ModalFooter>
        }
        onCancel={handleCancel}
      >
        <Flexbox horizontal className={stylex.props(styles.container).className}>
          <Flexbox className={stylex.props(styles.leftColumn).className} flex={1} gap={12}>
            <SearchBar
              allowClear
              placeholder={t('memberSelection.searchAgents')}
              style={{ margin: `${cssVar.paddingSM} ${cssVar.paddingSM} 0 ${cssVar.paddingSM}` }}
              value={inputValue}
              variant="filled"
              onChange={handleSearchChange}
            />
            <Flexbox flex={1} style={{ overflowY: 'auto', padding: `0 ${cssVar.paddingSM}` }}>
              <Accordion
                gap={12}
                indicatorPlacement="end"
                multiple={false}
                value={[activePanel]}
                variant="borderless"
                items={[
                  {
                    children:
                      filteredTemplates.length === 0 ? (
                        <Empty
                          descriptionProps={{ fontSize: 14 }}
                          icon={Users}
                          style={{ maxWidth: 400 }}
                          description={
                            searchTerm
                              ? t('groupWizard.noMatchingTemplates')
                              : t('groupWizard.noTemplates')
                          }
                        />
                      ) : (
                        <Flexbox gap={4}>
                          {filteredTemplates.map((template) => (
                            <TemplateItem
                              isSelected={selectedTemplate === template.id}
                              key={template.id}
                              template={template}
                              onToggle={handleTemplateToggle}
                            />
                          ))}
                        </Flexbox>
                      ),
                    key: 'templates',
                    title: t('groupWizard.useTemplate'),
                  },
                  {
                    children:
                      filteredAgents.length === 0 ? (
                        <Empty
                          descriptionProps={{ fontSize: 14 }}
                          icon={Users}
                          style={{ maxWidth: 400 }}
                          description={
                            searchTerm
                              ? t('noMatchingAgents', { ns: 'chat' })
                              : t('noAvailableAgents', { ns: 'chat' })
                          }
                        />
                      ) : (
                        <Flexbox gap={4}>
                          {filteredAgents.map((agent) => (
                            <ExistingMemberItem
                              agent={agent}
                              isSelected={selectedAgents.includes(agent.config?.id || '')}
                              key={agent.id}
                              onToggle={handleAgentToggle}
                            />
                          ))}
                        </Flexbox>
                      ),
                    key: 'agents',
                    title: t('groupWizard.existingMembers'),
                  },
                ]}
                styles={{
                  header: { color: cssVar.colorTextDescription, fontSize: cssVar.fontSize },
                }}
                onValueChange={handlePanelChange}
              />
            </Flexbox>
          </Flexbox>

          <Flexbox className={stylex.props(styles.rightColumn).className} flex={1}>
            <Flexbox flex={1} gap={16} style={{ overflowY: 'auto' }}>
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
                    {...sx([isHostRemoved && styles.modelSelectDisabled], undefined, {
                      opacity: isHostRemoved ? 0.6 : 1,
                    })}
                  >
                    <ModelSelect
                      requiredAbilities={['functionCall']}
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

              <Flexbox style={{ padding: `0 ${cssVar.paddingSM}` }}>
                {selectedTemplate ? (
                  templateMemberItems.length > 0 ? (
                    <List
                      styles={{ item: { paddingInlineEnd: 56 } }}
                      items={templateMemberItems.map((member) => ({
                        actions: (
                          <Switch
                            checked={!member.isRemoved}
                            size="small"
                            onChange={(checked) =>
                              handleToggleMember(selectedTemplate, member.title, checked)
                            }
                          />
                        ),
                        avatar: (
                          <AgentAvatar
                            avatar={member.avatar}
                            background={member.backgroundColor}
                            name={member.title}
                            shape={'circle'}
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
                        label: (
                          <Text type={member.isRemoved ? 'secondary' : undefined}>
                            {member.title}
                          </Text>
                        ),
                        showAction: true,
                      }))}
                    />
                  ) : (
                    <Empty
                      description={t('groupWizard.noTemplateMembers')}
                      descriptionProps={{ fontSize: 14 }}
                      icon={Users}
                      style={{ maxWidth: 400 }}
                    />
                  )
                ) : selectedAgentListItems.length > 0 ? (
                  <List
                    items={selectedAgentListItems}
                    styles={{ item: { paddingInlineEnd: 56 } }}
                  />
                ) : (
                  <Empty
                    description={t('memberSelection.noSelectedAgents')}
                    descriptionProps={{ fontSize: 14 }}
                    icon={Users}
                    style={{ maxWidth: 400 }}
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

export default ChatGroupWizard;
