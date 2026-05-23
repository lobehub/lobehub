import { ActionIcon, Block, Button, Flexbox, Text } from '@lobehub/ui';
import { Modal } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Lightbulb, PencilLineIcon, RefreshCw, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type ActionKeys,
  type ChatInputEditor,
  ChatInputProvider,
  DesktopChatInput,
} from '@/features/ChatInput';
import { useRandomQuestions } from '@/routes/(main)/home/features/SuggestQuestions/useRandomQuestions';

import type { CreateAgentModalSubmitSource } from './createAgentModalAnalytics';
import { trackCreateAgentModalCreationSucceeded } from './createAgentModalAnalytics';

const LEFT_ACTIONS: ActionKeys[] = ['model'];

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
  onSubmit: (prompt: string) => Promise<void> | void;
  open: boolean;
  type: 'agent' | 'group';
}

export const CreateAgentModal = memo<CreateAgentModalProps>(
  ({ open, type, agentId, onClose, onSubmit, onCreateBlank }) => {
    const { t } = useTranslation('chat');
    const editorRef = useRef<ChatInputEditor | null>(null);
    const contentRef = useRef('');
    const examplePromptRef = useRef('');
    const submitSourceRef = useRef<CreateAgentModalSubmitSource>('manual');
    const [loading, setLoading] = useState(false);

    const isAgent = type === 'agent';
    const modalTitle = isAgent ? t('createModal.title') : t('createModal.groupTitle');

    const resetInputTracking = useCallback(() => {
      contentRef.current = '';
      examplePromptRef.current = '';
      submitSourceRef.current = 'manual';
    }, []);

    useEffect(() => {
      if (open) resetInputTracking();
    }, [open, resetInputTracking]);

    const handleClose = useCallback(() => {
      resetInputTracking();
      onClose();
    }, [onClose, resetInputTracking]);

    const getSubmitSource = useCallback((text: string): CreateAgentModalSubmitSource => {
      if (examplePromptRef.current && submitSourceRef.current !== 'manual') {
        return text.trim() === examplePromptRef.current ? 'example' : 'example_edited';
      }

      return submitSourceRef.current;
    }, []);

    const handleSubmit = useCallback(
      async (prompt?: string) => {
        const text = prompt || contentRef.current.trim();
        if (!text || loading) return;
        setLoading(true);
        try {
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
      [getSubmitSource, handleClose, loading, onSubmit, type],
    );

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
            <Button icon={<PencilLineIcon size={14} />} type="text" onClick={handleCreateBlank}>
              {t('createModal.createBlank')}
            </Button>
            <ActionIcon icon={X} onClick={handleClose} />
          </Flexbox>
          {/* Title */}
          <Flexbox align="center">
            <h3 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{modalTitle}</h3>
          </Flexbox>

          {/* ChatInput */}
          {open && (
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
                showRuntimeConfig={false}
                placeholder={
                  isAgent ? t('createModal.placeholder') : t('createModal.groupPlaceholder')
                }
              />
            </ChatInputProvider>
          )}

          {/* Examples */}
          <Examples suggestMode={type} onExampleClick={handleExampleClick} />
        </Flexbox>
      </Modal>
    );
  },
);
