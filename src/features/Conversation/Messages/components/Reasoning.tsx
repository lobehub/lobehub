import { type MessageContentPart, type ModelReasoning } from '@lobechat/types';
import { deserializeParts } from '@lobechat/utils';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import Thinking from '@/features/Conversation/components/Thinking';
import { cacheScope } from '@/libs/replica';
import {
  getCachedReasoningSync,
  loadMessageReasoning,
  setCachedReasoning,
} from '@/services/message/reasoningCache';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { messageStateSelectors, useConversationStore } from '../../store';
import { RichContentRenderer } from './RichContentRenderer';

/**
 * Whether a persisted reasoning object holds renderable thinking. A
 * signature-only reasoning ({ signature } without content) is protocol state
 * kept for multi-turn replay and must not render an empty "deep thought" card.
 * Multimodal reasoning streams image parts via tempDisplayContent
 * without content, so those count as renderable. Rows whose reasoning text was
 * projected away (`contentOmitted`) are also renderable and lazy-load on expand.
 */
export const hasRenderableReasoning = (reasoning?: ModelReasoning | null): boolean =>
  !!reasoning?.content?.trim() ||
  !!reasoning?.tempDisplayContent?.length ||
  !!reasoning?.contentOmitted;

interface ReasoningProps {
  content?: string;
  contentOmitted?: boolean;
  duration?: number;
  id: string;
  isMultimodal?: boolean;
  tempDisplayContent?: MessageContentPart[];
}

const Reasoning = memo<ReasoningProps>(
  ({ content = '', contentOmitted, duration, id, isMultimodal, tempDisplayContent }) => {
    const isReasoning = useConversationStore(messageStateSelectors.isMessageInReasoning(id));
    const transitionMode = useUserStore(userGeneralSettingsSelectors.transitionMode);

    const scope = cacheScope.use();
    const entryKey = `${scope}:${id}`;

    const [loadedState, setLoadedState] = useState<
      { key: string; reasoning: ModelReasoning } | undefined
    >(undefined);
    const [loadingKey, setLoadingKey] = useState<string | undefined>(undefined);
    const [errorKey, setErrorKey] = useState<string | undefined>(undefined);
    const mountedRef = useRef(true);
    const streamOriginRef = useRef<{ id: string; scope: string } | undefined>(undefined);
    const prewarmedRef = useRef<
      { content: string; isMultimodal?: boolean; key: string } | undefined
    >(undefined);

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    // Prewarm persistent cache (IndexedDB / SQLite) when a live stream settles.
    // Pin the stream's originating `(id, scope)` once when it begins reasoning:
    // if scope changes while the old message stays mounted, we never re-bind it
    // to the new scope and drop prewarming for that stream.
    useEffect(() => {
      if (isReasoning) {
        if (streamOriginRef.current?.id !== id) {
          streamOriginRef.current = { id, scope };
        }
        return;
      }

      if (
        streamOriginRef.current?.id !== id ||
        streamOriginRef.current.scope !== scope ||
        contentOmitted ||
        !content.trim()
      )
        return;
      if (
        prewarmedRef.current?.key === entryKey &&
        prewarmedRef.current.content === content &&
        prewarmedRef.current.isMultimodal === isMultimodal
      )
        return;

      prewarmedRef.current = { content, isMultimodal, key: entryKey };
      void setCachedReasoning(id, { content, duration, isMultimodal });
    }, [content, contentOmitted, duration, entryKey, id, isMultimodal, isReasoning, scope]);

    const loadedReasoning =
      loadedState?.key === entryKey
        ? loadedState.reasoning
        : contentOmitted
          ? getCachedReasoningSync(id)
          : undefined;
    const loading = loadingKey === entryKey;
    const hasError = errorKey === entryKey;

    const fetchReasoning = useCallback(() => {
      const requestScope = cacheScope.get();
      const requestKey = `${requestScope}:${id}`;
      const syncHit = getCachedReasoningSync(id);
      if (syncHit?.content) {
        setErrorKey((curr) => (curr === requestKey ? undefined : curr));
        setLoadedState({ key: requestKey, reasoning: syncHit });
        return;
      }

      setErrorKey((curr) => (curr === requestKey ? undefined : curr));
      setLoadingKey(requestKey);
      void loadMessageReasoning(id)
        .then((resolved) => {
          if (!mountedRef.current || cacheScope.get() !== requestScope) return;
          if (resolved?.content?.trim()) {
            setLoadedState({ key: requestKey, reasoning: resolved });
          } else {
            setErrorKey(requestKey);
          }
        })
        .catch((err) => {
          console.error('[Reasoning] failed to lazy-load reasoning for %s: %O', id, err);
          if (mountedRef.current && cacheScope.get() === requestScope) setErrorKey(requestKey);
        })
        .finally(() => {
          if (mountedRef.current) setLoadingKey((curr) => (curr === requestKey ? undefined : curr));
        });
    }, [id]);

    const handleOpenChange = useCallback(
      (open: boolean) => {
        if (!open || !contentOmitted || content.trim() || loadedReasoning?.content) return;
        fetchReasoning();
      },
      [content, contentOmitted, fetchReasoning, loadedReasoning?.content],
    );

    const resolvedContent = content || loadedReasoning?.content || '';
    const resolvedIsMultimodal = isMultimodal ?? loadedReasoning?.isMultimodal;
    const parts = tempDisplayContent || deserializeParts(resolvedContent);

    // If parts are provided, render multimodal content
    const thinkingContent =
      resolvedIsMultimodal && parts ? <RichContentRenderer parts={parts} /> : resolvedContent;

    return (
      <Thinking
        content={thinkingContent}
        duration={duration ?? loadedReasoning?.duration}
        error={hasError}
        loading={loading}
        thinking={isReasoning}
        thinkingAnimated={transitionMode === 'fadeIn' && isReasoning}
        onOpenChange={handleOpenChange}
        onRetry={fetchReasoning}
      />
    );
  },
);

export default Reasoning;
