import { ActionIcon, Block, Button, Flexbox, Text } from '@lobehub/ui';
import { Modal } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import {
  Blocks,
  CheckCircle2,
  Lightbulb,
  Loader2,
  PencilLineIcon,
  RefreshCw,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type ActionKeys,
  type ChatInputEditor,
  ChatInputProvider,
  DesktopChatInput,
} from '@/features/ChatInput';
import { useRandomQuestions } from '@/routes/(main)/home/features/SuggestQuestions/useRandomQuestions';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import type { DiscoverSkillItem } from '@/types/discover';

import {
  type AgentSkillSuggestionResult,
  searchAgentSkillSuggestion,
} from './agentSkillSuggestion';
import type {
  CreateAgentModalSkillSuggestionAction,
  CreateAgentModalSubmitSource,
} from './createAgentModalAnalytics';
import {
  trackCreateAgentModalCreationSucceeded,
  trackCreateAgentModalSkillSuggestionAction,
} from './createAgentModalAnalytics';

const LEFT_ACTIONS: ActionKeys[] = ['model'];

interface InstalledSkill {
  identifier: string;
  name: string;
}

interface SkillSuggestionPanelProps {
  installError?: boolean;
  installingIdentifier?: string;
  items: DiscoverSkillItem[];
  onContinueCreate: () => void;
  onInstall: (identifier: string) => void;
}

const SkillSuggestionPanel = memo<SkillSuggestionPanelProps>(
  ({ installError, installingIdentifier, items, onContinueCreate, onInstall }) => {
    const { t } = useTranslation('chat');
    const primarySkillIdentifier = items[0]?.identifier;
    const installing = Boolean(installingIdentifier);

    return (
      <Flexbox
        gap={12}
        style={{
          background: cssVar.colorFillQuaternary,
          border: `1px solid ${cssVar.colorFillSecondary}`,
          borderRadius: 12,
          padding: 14,
        }}
      >
        <Flexbox gap={4}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Blocks color={cssVar.colorTextSecondary} size={18} />
            <Text fontSize={14} style={{ fontWeight: 600 }}>
              {t('createModal.skillSuggestion.title')}
            </Text>
          </Flexbox>
          <Text color={cssVar.colorTextSecondary} fontSize={13}>
            {t('createModal.skillSuggestion.description')}
          </Text>
        </Flexbox>
        <Flexbox gap={8}>
          {items.map((item) => (
            <Flexbox
              horizontal
              align={'center'}
              gap={12}
              justify={'space-between'}
              key={item.identifier}
              style={{
                background: cssVar.colorBgContainer,
                border: `1px solid ${cssVar.colorFillTertiary}`,
                borderRadius: 10,
                padding: 10,
              }}
            >
              <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
                <Text ellipsis fontSize={13} style={{ fontWeight: 500 }}>
                  {item.name}
                </Text>
                <Text color={cssVar.colorTextTertiary} ellipsis={{ rows: 2 }} fontSize={12}>
                  {item.description}
                </Text>
              </Flexbox>
              <Button
                disabled={installing}
                icon={installingIdentifier === item.identifier ? <Loader2 size={14} /> : undefined}
                size={'small'}
                type={item.identifier === primarySkillIdentifier ? 'primary' : undefined}
                onClick={() => onInstall(item.identifier)}
              >
                {t('createModal.skillSuggestion.actions.install')}
              </Button>
            </Flexbox>
          ))}
        </Flexbox>
        {installError && (
          <Text color={cssVar.colorError} fontSize={12}>
            {t('createModal.skillSuggestion.installError')}
          </Text>
        )}
        <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
          <Text color={cssVar.colorTextTertiary} fontSize={12}>
            {t('createModal.skillSuggestion.actions.createAnywayHint')}
          </Text>
          <Button disabled={installing} onClick={onContinueCreate}>
            {t('createModal.skillSuggestion.actions.createAnyway')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

interface SkillInstalledPanelProps {
  onClose: () => void;
  onOpenSkills?: (identifier: string) => void;
  skill: InstalledSkill;
}

const SkillInstalledPanel = memo<SkillInstalledPanelProps>(({ onClose, onOpenSkills, skill }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox
      gap={16}
      style={{
        background: cssVar.colorFillQuaternary,
        border: `1px solid ${cssVar.colorFillSecondary}`,
        borderRadius: 12,
        padding: 16,
      }}
    >
      <Flexbox gap={8}>
        <Flexbox horizontal align={'center'} gap={8}>
          <CheckCircle2 color={cssVar.colorSuccess} size={18} />
          <Text fontSize={14} style={{ fontWeight: 600 }}>
            {t('createModal.skillSuggestion.installed.title')}
          </Text>
        </Flexbox>
        <Text color={cssVar.colorTextSecondary} fontSize={13}>
          {t('createModal.skillSuggestion.installed.description')}
        </Text>
      </Flexbox>
      <Flexbox
        horizontal
        align={'center'}
        gap={12}
        justify={'space-between'}
        style={{
          background: cssVar.colorBgContainer,
          border: `1px solid ${cssVar.colorFillTertiary}`,
          borderRadius: 10,
          padding: 10,
        }}
      >
        <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
          <Text ellipsis fontSize={13} style={{ fontWeight: 500 }}>
            {skill.name}
          </Text>
          <Text color={cssVar.colorTextTertiary} fontSize={12}>
            {skill.identifier}
          </Text>
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
        {onOpenSkills && (
          <Button onClick={() => onOpenSkills(skill.identifier)}>
            {t('createModal.skillSuggestion.actions.openSkills')}
          </Button>
        )}
        <Button type={'primary'} onClick={onClose}>
          {t('createModal.skillSuggestion.actions.tryInLobeAI')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

interface ExampleItemProps {
  description: string;
  onClick: (prompt: string) => void;
  prompt: string;
  title: string;
}

const ExampleItem = memo<ExampleItemProps>(({ title, description, onClick, prompt }) => {
  return (
    <Block
      clickable
      variant={'outlined'}
      style={{
        borderRadius: cssVar.borderRadiusLG,
        cursor: 'pointer',
      }}
      onClick={() => onClick(prompt)}
    >
      <Flexbox gap={4} paddingBlock={12} paddingInline={14}>
        <Text ellipsis fontSize={14} style={{ fontWeight: 500 }}>
          {title}
        </Text>
        <Text color={cssVar.colorTextTertiary} ellipsis={{ rows: 2 }} fontSize={12}>
          {description}
        </Text>
      </Flexbox>
    </Block>
  );
});

interface ExamplesProps {
  onExampleClick: (prompt: string) => void;
  suggestMode: 'agent' | 'group';
}

const Examples = memo<ExamplesProps>(({ suggestMode, onExampleClick }) => {
  const { t: tCommon } = useTranslation('common');
  const { t: tSuggest } = useTranslation('suggestQuestions');
  const { questions, refresh } = useRandomQuestions(suggestMode);

  if (questions.length === 0) return null;

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Lightbulb color={cssVar.colorTextDescription} size={18} />
          <Text color={cssVar.colorTextSecondary}>{tCommon('home.suggestQuestions')}</Text>
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          gap={4}
          style={{ cursor: 'pointer' }}
          onClick={refresh}
        >
          <ActionIcon icon={RefreshCw} size={'small'} />
          <Text color={cssVar.colorTextSecondary} fontSize={12}>
            {tCommon('switch')}
          </Text>
        </Flexbox>
      </Flexbox>
      <Flexbox gap={12} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {questions.map((item) => {
          const prompt = tSuggest(item.promptKey as any);
          return (
            <ExampleItem
              description={prompt}
              key={item.id}
              prompt={prompt}
              title={tSuggest(item.titleKey as any)}
              onClick={onExampleClick}
            />
          );
        })}
      </Flexbox>
    </Flexbox>
  );
});

export interface CreateAgentModalProps {
  agentId?: string;
  onClose: () => void;
  onCreateBlank: () => Promise<void> | void;
  onOpenSkills?: (identifier: string) => void;
  onSubmit: (prompt: string) => Promise<void> | void;
  open: boolean;
  type: 'agent' | 'group';
}

export const CreateAgentModal = memo<CreateAgentModalProps>(
  ({ open, type, agentId, onClose, onOpenSkills, onSubmit, onCreateBlank }) => {
    const { t } = useTranslation('chat');
    const editorRef = useRef<ChatInputEditor | null>(null);
    const contentRef = useRef('');
    const examplePromptRef = useRef('');
    const skipSkillSuggestionPromptRef = useRef('');
    const submitSourceRef = useRef<CreateAgentModalSubmitSource>('manual');
    const refreshAgentSkills = useToolStore((s) => s.refreshAgentSkills);
    const [installedSkill, setInstalledSkill] = useState<InstalledSkill>();
    const [installingSkillIdentifier, setInstallingSkillIdentifier] = useState<string>();
    const [loading, setLoading] = useState(false);
    const [skillInstallError, setSkillInstallError] = useState(false);
    const [skillSuggestion, setSkillSuggestion] = useState<
      (AgentSkillSuggestionResult & { prompt: string }) | undefined
    >();

    const isAgent = type === 'agent';
    const modalTitle = isAgent ? t('createModal.title') : t('createModal.groupTitle');

    const resetInputTracking = useCallback(() => {
      contentRef.current = '';
      examplePromptRef.current = '';
      skipSkillSuggestionPromptRef.current = '';
      submitSourceRef.current = 'manual';
    }, []);

    useEffect(() => {
      if (!open) return;
      resetInputTracking();
      setInstalledSkill(undefined);
      setInstallingSkillIdentifier(undefined);
      setSkillInstallError(false);
      setSkillSuggestion(undefined);
    }, [open, resetInputTracking]);

    const handleClose = useCallback(() => {
      resetInputTracking();
      setInstalledSkill(undefined);
      setInstallingSkillIdentifier(undefined);
      setSkillInstallError(false);
      setSkillSuggestion(undefined);
      onClose();
    }, [onClose, resetInputTracking]);

    const getSubmitSource = useCallback((text: string): CreateAgentModalSubmitSource => {
      if (examplePromptRef.current && submitSourceRef.current !== 'manual') {
        return text.trim() === examplePromptRef.current ? 'example' : 'example_edited';
      }

      return submitSourceRef.current;
    }, []);

    const trackSkillSuggestionAction = useCallback(
      (
        action: CreateAgentModalSkillSuggestionAction,
        selectedSkillIdentifier?: string,
        suggestion = skillSuggestion,
      ) => {
        if (!suggestion) return;

        void trackCreateAgentModalSkillSuggestionAction({
          action,
          selectedSkillIdentifier,
          skillIdentifiers: suggestion.items.map((item) => item.identifier),
          source: getSubmitSource(suggestion.prompt),
        });
      },
      [getSubmitSource, skillSuggestion],
    );

    const handleSubmit = useCallback(
      async (prompt?: string) => {
        const text = prompt || contentRef.current.trim();
        if (!text || loading) return;
        setLoading(true);
        try {
          const skipSkillSuggestion = skipSkillSuggestionPromptRef.current === text;
          skipSkillSuggestionPromptRef.current = '';

          if (isAgent && !skipSkillSuggestion) {
            try {
              const suggestion = await searchAgentSkillSuggestion(text);
              if (suggestion) {
                setInstalledSkill(undefined);
                setSkillInstallError(false);
                setSkillSuggestion({ ...suggestion, prompt: text });
                void trackCreateAgentModalSkillSuggestionAction({
                  action: 'shown',
                  skillIdentifiers: suggestion.items.map((item) => item.identifier),
                  source: getSubmitSource(text),
                });
                return;
              }
            } catch (error) {
              console.warn('[CreateAgentModal] Failed to search skill suggestions:', error);
            }
          }

          await onSubmit(text);
          void trackCreateAgentModalCreationSucceeded({
            source: getSubmitSource(text),
            type,
          });
          handleClose();
        } finally {
          setLoading(false);
        }
      },
      [getSubmitSource, handleClose, isAgent, loading, onSubmit, type],
    );

    const handleContinueCreate = useCallback(() => {
      const prompt = skillSuggestion?.prompt || contentRef.current.trim();
      if (!prompt) return;
      trackSkillSuggestionAction('create_agent_anyway_clicked');
      skipSkillSuggestionPromptRef.current = prompt;
      void handleSubmit(prompt);
    }, [handleSubmit, skillSuggestion?.prompt, trackSkillSuggestionAction]);

    const handleInstallSkill = useCallback(
      async (identifier: string) => {
        if (installingSkillIdentifier || loading) return;
        trackSkillSuggestionAction('install_clicked', identifier);
        setInstallingSkillIdentifier(identifier);
        setSkillInstallError(false);
        try {
          const result = await agentSkillService.importFromMarket(identifier);
          await refreshAgentSkills();
          const marketSkill = skillSuggestion?.items.find((item) => item.identifier === identifier);
          const skill = result?.skill;
          setInstalledSkill({
            identifier: skill?.identifier || marketSkill?.identifier || identifier,
            name: skill?.name || marketSkill?.name || identifier,
          });
          trackSkillSuggestionAction('install_succeeded', identifier);
        } catch (error) {
          console.warn('[CreateAgentModal] Failed to import suggested skill:', error);
          setSkillInstallError(true);
          trackSkillSuggestionAction('install_failed', identifier);
        } finally {
          setInstallingSkillIdentifier(undefined);
        }
      },
      [
        installingSkillIdentifier,
        loading,
        refreshAgentSkills,
        skillSuggestion?.items,
        trackSkillSuggestionAction,
      ],
    );

    const handleOpenInstalledSkill = useCallback(
      (identifier: string) => {
        trackSkillSuggestionAction('open_skills_clicked', identifier);
        onOpenSkills?.(identifier);
      },
      [onOpenSkills, trackSkillSuggestionAction],
    );

    const handleTryInLobeAI = useCallback(() => {
      if (installedSkill) {
        trackSkillSuggestionAction('try_in_lobeai_clicked', installedSkill.identifier);
      }
      handleClose();
    }, [handleClose, installedSkill, trackSkillSuggestionAction]);

    const handleCreateBlank = useCallback(async () => {
      if (loading) return;
      setLoading(true);
      try {
        await onCreateBlank();
        void trackCreateAgentModalCreationSucceeded({
          source: 'blank',
          type,
        });
        handleClose();
      } finally {
        setLoading(false);
      }
    }, [handleClose, loading, onCreateBlank, type]);

    const handleExampleClick = useCallback((prompt: string) => {
      examplePromptRef.current = prompt.trim();
      submitSourceRef.current = 'example';
      editorRef.current?.instance?.setDocument('markdown', prompt);
      editorRef.current?.focus();
      contentRef.current = prompt;
    }, []);

    const handleSend = useCallback(() => {
      handleSubmit();
    }, [handleSubmit]);

    const inputContainerProps = useMemo(
      () => ({
        minHeight: 88,
        resize: false,
        style: { borderRadius: 16 },
      }),
      [],
    );

    const sendButtonProps = useMemo(
      () => ({
        generating: loading,
        onStop: () => {},
        shape: 'round' as const,
      }),
      [loading],
    );

    return (
      <Modal
        centered
        destroyOnHidden
        closable={false}
        footer={null}
        open={open}
        title={false}
        width={'min(90vw, 760px)'}
        styles={{
          body: { padding: 0 },
        }}
        onCancel={handleClose}
      >
        <Flexbox gap={24} paddingBlock={'16px 24px'} paddingInline={24}>
          {/* Header: Create Blank + Close */}
          <Flexbox horizontal align="center" gap={4} justify="flex-end">
            {!installedSkill && (
              <Button icon={<PencilLineIcon size={14} />} type="text" onClick={handleCreateBlank}>
                {t('createModal.createBlank')}
              </Button>
            )}
            <ActionIcon icon={X} onClick={handleClose} />
          </Flexbox>
          {/* Title */}
          {!installedSkill && (
            <Flexbox align="center">
              <h3 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{modalTitle}</h3>
            </Flexbox>
          )}

          {/* ChatInput */}
          {open && !installedSkill && (
            <ChatInputProvider
              agentId={agentId}
              allowExpand={false}
              leftActions={LEFT_ACTIONS}
              sendButtonProps={sendButtonProps}
              chatInputEditorRef={(instance) => {
                if (instance) editorRef.current = instance;
              }}
              onSend={handleSend}
              onMarkdownContentChange={(content) => {
                contentRef.current = content;
                const trimmedContent = content.trim();
                if (skillSuggestion && trimmedContent !== skillSuggestion.prompt) {
                  setSkillSuggestion(undefined);
                }
                if (
                  examplePromptRef.current &&
                  (submitSourceRef.current === 'example' ||
                    submitSourceRef.current === 'example_edited')
                ) {
                  submitSourceRef.current =
                    trimmedContent === examplePromptRef.current ? 'example' : 'example_edited';
                }
              }}
            >
              <DesktopChatInput
                inputContainerProps={inputContainerProps}
                showControlBar={false}
                placeholder={
                  isAgent ? t('createModal.placeholder') : t('createModal.groupPlaceholder')
                }
              />
            </ChatInputProvider>
          )}

          {isAgent && installedSkill && (
            <SkillInstalledPanel
              skill={installedSkill}
              onClose={handleTryInLobeAI}
              onOpenSkills={onOpenSkills ? handleOpenInstalledSkill : undefined}
            />
          )}

          {isAgent && skillSuggestion && !installedSkill && (
            <SkillSuggestionPanel
              installError={skillInstallError}
              installingIdentifier={installingSkillIdentifier}
              items={skillSuggestion.items}
              onContinueCreate={handleContinueCreate}
              onInstall={handleInstallSkill}
            />
          )}

          {/* Examples */}
          {!skillSuggestion && !installedSkill && (
            <Examples suggestMode={type} onExampleClick={handleExampleClick} />
          )}
        </Flexbox>
      </Modal>
    );
  },
);
