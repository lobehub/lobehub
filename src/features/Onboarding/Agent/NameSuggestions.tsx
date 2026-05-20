import { ActionIcon, Block, Flexbox, FluentEmoji, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { RefreshCw } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation';

import {
  type NameSuggestionItem,
  nameSuggestionPool,
  resolveNameSuggestion,
} from './nameSuggestions.config';

const SUGGESTIONS_PER_GROUP = 3;

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    cursor: pointer;

    flex-shrink: 0;

    padding-block: 6px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 999px;

    background: ${cssVar.colorBgContainer};

    transition: background 0.15s;

    &:hover {
      background: ${cssVar.colorBgTextHover};
    }
  `,

  chipRow: css`
    scrollbar-width: none;
    overflow-x: auto;
    flex-wrap: nowrap;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
}));

const sampleSuggestions = (count: number, excludeIds: string[] = []): NameSuggestionItem[] => {
  const remaining = nameSuggestionPool.filter((item) => !excludeIds.includes(item.id));
  const target = Math.min(count, remaining.length);
  const picked: NameSuggestionItem[] = [];
  while (picked.length < target) {
    const idx = Math.floor(Math.random() * remaining.length);
    picked.push(remaining.splice(idx, 1)[0]);
  }
  return picked;
};

interface NameSuggestionsProps {
  variant?: 'cards' | 'chips';
}

const NameSuggestions = memo<NameSuggestionsProps>(({ variant = 'cards' }) => {
  const { t, i18n } = useTranslation('onboarding');
  const updateInputMessage = useConversationStore((s) => s.updateInputMessage);
  const editor = useConversationStore((s) => s.editor);
  const [items, setItems] = useState<NameSuggestionItem[]>(() =>
    sampleSuggestions(SUGGESTIONS_PER_GROUP),
  );

  const handleRefresh = useCallback(() => {
    setItems((current) => {
      const excludeIds = current.map((item) => item.id);
      const next = sampleSuggestions(SUGGESTIONS_PER_GROUP, excludeIds);
      return next.length === SUGGESTIONS_PER_GROUP
        ? next
        : sampleSuggestions(SUGGESTIONS_PER_GROUP);
    });
  }, []);

  const handleSelect = useCallback(
    (prompt: string, emoji: string) => {
      const avatarHint = t('agent.welcome.suggestion.avatarHint', { emoji });
      const message = `${prompt} ${avatarHint}`;
      updateInputMessage(message);
      editor?.setDocument('text', message);
      editor?.focus();
    },
    [t, updateInputMessage, editor],
  );

  if (variant === 'chips') {
    return (
      <Flexbox gap={6} paddingInline={24}>
        <Flexbox horizontal align={'center'} gap={4} justify={'space-between'}>
          <Text fontSize={12} type={'secondary'}>
            {t('agent.welcome.suggestion.title')}
          </Text>
          <Flexbox
            horizontal
            align={'center'}
            gap={2}
            style={{ cursor: 'pointer' }}
            onClick={handleRefresh}
          >
            <ActionIcon icon={RefreshCw} size={'small'} />
            <Text fontSize={11} type={'secondary'}>
              {t('agent.welcome.suggestion.switch')}
            </Text>
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal className={styles.chipRow} gap={6}>
          {items.map((item) => {
            const { name, prompt } = resolveNameSuggestion(item, i18n.language);
            return (
              <Flexbox
                horizontal
                align={'center'}
                className={styles.chip}
                gap={6}
                key={item.id}
                onClick={() => handleSelect(prompt, item.emoji)}
              >
                <FluentEmoji emoji={item.emoji} size={16} type={'anim'} />
                <Text fontSize={13} weight={500}>
                  {name}
                </Text>
              </Flexbox>
            );
          })}
        </Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Text type={'secondary'}>{t('agent.welcome.suggestion.title')}</Text>
        <Flexbox
          horizontal
          align={'center'}
          gap={4}
          style={{ cursor: 'pointer' }}
          onClick={handleRefresh}
        >
          <ActionIcon icon={RefreshCw} size={'small'} />
          <Text fontSize={12} type={'secondary'}>
            {t('agent.welcome.suggestion.switch')}
          </Text>
        </Flexbox>
      </Flexbox>
      <Flexbox
        gap={12}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
      >
        {items.map((item) => {
          const { name, prompt } = resolveNameSuggestion(item, i18n.language);
          return (
            <Block
              clickable
              shadow
              key={item.id}
              variant={'outlined'}
              style={{
                borderRadius: cssVar.borderRadiusLG,
                boxShadow: '0 8px 16px -8px rgba(0,0,0,0.06)',
                cursor: 'pointer',
              }}
              onClick={() => handleSelect(prompt, item.emoji)}
            >
              <Flexbox gap={6} padding={12}>
                <Flexbox horizontal align={'center'} gap={8}>
                  <FluentEmoji emoji={item.emoji} size={20} type={'anim'} />
                  <Text fontSize={14} weight={500}>
                    {name}
                  </Text>
                </Flexbox>
                <Text ellipsis fontSize={12} type={'secondary'}>
                  {prompt}
                </Text>
              </Flexbox>
            </Block>
          );
        })}
      </Flexbox>
    </Flexbox>
  );
});

NameSuggestions.displayName = 'NameSuggestions';

export default NameSuggestions;
