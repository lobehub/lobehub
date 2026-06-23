'use client';

import { ActionIcon, Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { RefreshCw } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import SuggestQuestions, { type SuggestMode } from '@/features/SuggestQuestions';
import Skeleton from '@/features/SuggestQuestions/Skeleton';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import { useBuilderSuggestionFeedbackStore } from './feedbackStore';
import { useBuilderContext } from './useBuilderContext';
import { useBuilderSuggestions } from './useBuilderSuggestions';

interface ChipItemProps {
  disabled?: boolean;
  index: number;
  prompt: string;
  title: string;
  tracingId?: string;
}

const ChipItem = memo<ChipItemProps>(({ title, prompt, index, tracingId, disabled }) => {
  const mainInputEditor = useChatStore((s) => s.mainInputEditor);
  const markChipClicked = useBuilderSuggestionFeedbackStore((s) => s.markChipClicked);

  const handleClick = useCallback(() => {
    if (disabled) return;
    mainInputEditor?.instance?.setDocument('markdown', prompt);
    mainInputEditor?.focus();
    if (tracingId) markChipClicked({ index, prompt, tracingId });
  }, [disabled, prompt, index, tracingId, mainInputEditor, markChipClicked]);

  return (
    <Block
      clickable={!disabled}
      variant={'outlined'}
      style={{
        borderRadius: cssVar.borderRadiusLG,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.65 : undefined,
      }}
      onClick={handleClick}
    >
      <Flexbox gap={4} paddingBlock={12} paddingInline={14}>
        <Text ellipsis fontSize={14} style={{ fontWeight: 500 }}>
          {title}
        </Text>
        <Text color={cssVar.colorTextTertiary} ellipsis={{ rows: 2 }} fontSize={12}>
          {prompt}
        </Text>
      </Flexbox>
    </Block>
  );
});

interface SuggestionChipsProps {
  /** Builtin builder agent id (drives the model + tracing `agentId`). */
  builderAgentId: string;
  count?: number;
  disabled?: boolean;
  /** `agentBuilder` | `groupBuilder` — selects the generation + fallback pool. */
  mode: SuggestMode;
}

/**
 * Context-aware opening suggestions for the Agent / Group Builder. Generates
 * build/configure-oriented chips from the current agent/group config and falls
 * back to the static curated pool while loading, on error, or when disabled.
 */
const SuggestionChips = memo<SuggestionChipsProps>(
  ({ mode, builderAgentId, count = 3, disabled }) => {
    const { t: tCommon } = useTranslation('common');
    const { contextSummary, generationMode, locale } = useBuilderContext(mode);

    const builderConfig = useAgentStore((s) =>
      agentByIdSelectors.getAgentConfigById(builderAgentId)(s),
    );
    const model = builderConfig?.model;
    const provider = builderConfig?.provider;

    const { suggestions, tracingId, isLoading, refresh } = useBuilderSuggestions({
      builderAgentId,
      contextSummary,
      enabled: !disabled && !!model && !!provider,
      locale,
      mode: generationMode,
      model: model ?? '',
      provider: provider ?? '',
    });

    // First load with nothing to show yet — skeleton (matches static layout).
    if (isLoading && suggestions.length === 0) return <Skeleton count={count} />;

    // Dynamic, context-aware chips.
    if (suggestions.length > 0) {
      return (
        <Flexbox gap={12}>
          <Flexbox gap={8}>
            {suggestions.map((item, index) => (
              <ChipItem
                disabled={disabled}
                index={index}
                key={`${item.title}-${index}`}
                prompt={item.prompt}
                title={item.title}
                tracingId={tracingId}
              />
            ))}
          </Flexbox>
          <Flexbox
            horizontal
            align={'center'}
            gap={4}
            style={{
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.65 : undefined,
            }}
            onClick={() => {
              if (disabled) return;
              refresh();
            }}
          >
            <ActionIcon disabled={disabled} icon={RefreshCw} size={'small'} />
            <Text color={cssVar.colorTextSecondary} fontSize={12}>
              {tCommon('switch')}
            </Text>
          </Flexbox>
        </Flexbox>
      );
    }

    // Fallback: error / empty / disabled / no usable model → static curated pool.
    return <SuggestQuestions count={count} disabled={disabled} mode={mode} />;
  },
);

export default SuggestionChips;
