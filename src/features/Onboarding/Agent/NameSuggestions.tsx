import { ActionIcon, Block, Flexbox, FluentEmoji, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { RefreshCw } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation';

interface SuggestionItem {
  emoji: string;
  id: string;
  nameKey: string;
  promptKey: string;
}

const suggestionGroups = [
  [
    {
      emoji: '🌙',
      id: 'lumi',
      nameKey: 'agent.welcome.suggestion.items.1.name',
      promptKey: 'agent.welcome.suggestion.items.1.prompt',
    },
    {
      emoji: '🧭',
      id: 'atlas',
      nameKey: 'agent.welcome.suggestion.items.2.name',
      promptKey: 'agent.welcome.suggestion.items.2.prompt',
    },
    {
      emoji: '🍡',
      id: 'momo',
      nameKey: 'agent.welcome.suggestion.items.3.name',
      promptKey: 'agent.welcome.suggestion.items.3.prompt',
    },
  ],
  [
    {
      emoji: '🌌',
      id: 'nova',
      nameKey: 'agent.welcome.suggestion.items.4.name',
      promptKey: 'agent.welcome.suggestion.items.4.prompt',
    },
    {
      emoji: '🪄',
      id: 'milo',
      nameKey: 'agent.welcome.suggestion.items.5.name',
      promptKey: 'agent.welcome.suggestion.items.5.prompt',
    },
    {
      emoji: '🌿',
      id: 'aster',
      nameKey: 'agent.welcome.suggestion.items.6.name',
      promptKey: 'agent.welcome.suggestion.items.6.prompt',
    },
  ],
  [
    {
      emoji: '🧩',
      id: 'pixel',
      nameKey: 'agent.welcome.suggestion.items.7.name',
      promptKey: 'agent.welcome.suggestion.items.7.prompt',
    },
    {
      emoji: '🎧',
      id: 'echo',
      nameKey: 'agent.welcome.suggestion.items.8.name',
      promptKey: 'agent.welcome.suggestion.items.8.prompt',
    },
    {
      emoji: '🪐',
      id: 'orbit',
      nameKey: 'agent.welcome.suggestion.items.9.name',
      promptKey: 'agent.welcome.suggestion.items.9.prompt',
    },
  ],
] as const satisfies SuggestionItem[][];

const getRandomGroupIndex = (currentIndex?: number) => {
  const nextIndex = Math.floor(Math.random() * suggestionGroups.length);

  if (currentIndex === undefined || suggestionGroups.length <= 1 || nextIndex !== currentIndex) {
    return nextIndex;
  }

  return (nextIndex + 1) % suggestionGroups.length;
};

const NameSuggestions = memo(() => {
  const { t } = useTranslation('onboarding');
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const [groupIndex, setGroupIndex] = useState(() => getRandomGroupIndex());

  const handleRefresh = useCallback(() => {
    setGroupIndex((current) => getRandomGroupIndex(current));
  }, []);

  const handleSelect = useCallback(
    async (prompt: string, emoji: string) => {
      await sendMessage({ message: `${prompt} ${emoji}` });
    },
    [sendMessage],
  );

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
        {suggestionGroups[groupIndex].map((item) => {
          const prompt = t(item.promptKey);

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
              <Flexbox gap={8} padding={16}>
                <FluentEmoji emoji={item.emoji} size={24} type={'anim'} />
                <Text fontSize={15} weight={500}>
                  {t(item.nameKey)}
                </Text>
                <Text fontSize={13} type={'secondary'}>
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
