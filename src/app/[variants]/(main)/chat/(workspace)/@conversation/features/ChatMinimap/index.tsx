'use client';

import { Icon } from '@lobehub/ui';
import { Popover, Tooltip } from 'antd';
import { createStyles, useTheme } from 'antd-style';
import debug from 'debug';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import {
  getVirtuosoActiveIndex,
  getVirtuosoGlobalRef,
  subscribeVirtuosoActiveIndex,
  subscribeVirtuosoGlobalRef,
} from '@/features/Conversation/components/VirtualizedList/VirtuosoContext';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

const log = debug('lobe-react:chat-minimap');

const MIN_WIDTH = 16;
const MAX_WIDTH = 30;
const MAX_CONTENT_LENGTH = 320;
const MIN_MESSAGES = 4;

const useStyles = createStyles(({ css, token }) => ({
  arrow: css`
    cursor: pointer;

    transform: translateX(4px);

    display: flex;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 6px;

    color: ${token.colorTextTertiary};

    opacity: 0;
    background: none;

    transition: opacity 0.2s ease;

    &:hover {
      color: ${token.colorText};
      background: ${token.colorFill};
    }

    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px ${token.colorPrimaryBorder};
    }
  `,
  arrowVisible: css`
    opacity: 1;
  `,
  container: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset-block: 16px 120px;
    inset-inline-end: 8px;

    width: 32px;
  `,
  indicator: css`
    cursor: pointer;

    flex-shrink: 0;

    min-width: ${MIN_WIDTH}px;
    height: 12px;
    padding-block: 4px;
    padding-inline: 4px;
    border: none;
    border-radius: 3px;

    background: none;

    transition:
      transform 0.2s ease,
      background-color 0.2s ease,
      box-shadow 0.2s ease;

    &:hover {
      transform: scaleX(1.05);
      background: ${token.colorFill};
    }

    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px ${token.colorPrimaryBorder};
    }
  `,
  indicatorActive: css`
    transform: scaleX(1.1);
    background: ${token.colorPrimary};
    box-shadow: 0 0 0 1px ${token.colorPrimaryHover};
  `,
  indicatorContent: css`
    width: 100%;
    height: 100%;
    border-radius: 3px;
    background: ${token.colorFillSecondary};
  `,
  indicatorContentActive: css`
    background: ${token.colorPrimary};
  `,
  popoverContent: css`
    max-width: 300px;
  `,
  popoverLabel: css`
    margin-block-end: 4px;
    font-size: 12px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
  `,
  popoverText: css`
    color: ${token.colorText};
    word-break: break-word;
  `,
  rail: css`
    pointer-events: auto;

    display: flex;
    flex-direction: column;
    gap: 0;
    align-items: end;
    justify-content: space-between;

    width: 100%;
    height: fit-content;
    margin-block: 0;
    margin-inline: auto;

    &:hover .arrow {
      opacity: 1;
    }
  `,
  railContent: css`
    scrollbar-width: none;

    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0;
    align-items: end;
    justify-content: space-between;

    max-height: round(down, 50vh, 12px);

    /* Hide scrollbar for IE, Edge and Firefox */
    -ms-overflow-style: none;

    /* Hide scrollbar for Chrome, Safari and Opera */
    &::-webkit-scrollbar {
      display: none;
    }
  `,
}));

const getIndicatorWidth = (content: string | undefined) => {
  if (!content) return MIN_WIDTH;

  const ratio = Math.min(content.length / MAX_CONTENT_LENGTH, 1);

  return MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * ratio;
};

const getPreviewText = (content: string | undefined) => {
  if (!content) return '';

  const normalized = content.replaceAll(/\s+/g, ' ').trim();
  if (!normalized) return '';

  return normalized.slice(0, 100) + (normalized.length > 100 ? '…' : '');
};

interface MinimapIndicator {
  id: string;
  preview: string;
  role: 'user' | 'assistant';
  virtuosoIndex: number;
  width: number;
}

const ChatMinimap = () => {
  const { t } = useTranslation('chat');
  const { styles, cx } = useStyles();
  const [isHovered, setIsHovered] = useState(false);
  const virtuosoRef = useSyncExternalStore(
    subscribeVirtuosoGlobalRef,
    getVirtuosoGlobalRef,
    () => null,
  );
  const activeIndex = useSyncExternalStore(
    subscribeVirtuosoActiveIndex,
    getVirtuosoActiveIndex,
    () => null,
  );
  const messages = useChatStore(chatSelectors.mainDisplayChats);

  const theme = useTheme();

  const indicators = useMemo<MinimapIndicator[]>(() => {
    return messages.reduce<MinimapIndicator[]>((acc, message, virtuosoIndex) => {
      if (message.role !== 'user' && message.role !== 'assistant') return acc;

      acc.push({
        id: message.id,
        preview: getPreviewText(message.content),
        role: message.role,
        virtuosoIndex,
        width: getIndicatorWidth(message.content),
      });

      return acc;
    }, []);
  }, [messages]);

  const indicatorIndexMap = useMemo(() => {
    const map = new Map<number, number>();
    indicators.forEach(({ virtuosoIndex }, position) => {
      map.set(virtuosoIndex, position);
    });
    return map;
  }, [indicators]);

  const activeIndicatorPosition = useMemo(() => {
    if (activeIndex === null) return null;

    log('> activeIndex', activeIndex);
    log('> indicatorIndexMap', indicatorIndexMap);

    return indicatorIndexMap.get(activeIndex) ?? null;
  }, [activeIndex, indicatorIndexMap]);

  const handleJump = useCallback(
    (virtIndex: number) => {
      virtuosoRef?.current?.scrollToIndex({
        align: 'start',
        behavior: 'smooth',
        index: virtIndex,
        // The current index detection will be off by 1, so we need to add 1 here
        offset: 6,
      });
    },
    [virtuosoRef],
  );

  const handleStep = useCallback(
    (direction: 'prev' | 'next') => {
      const ref = virtuosoRef?.current;
      if (!ref || indicators.length === 0) return;

      let targetPosition: number;

      if (activeIndicatorPosition !== null) {
        log('activeIndicatorPosition', activeIndicatorPosition);
        // We're on an indicator, move to prev/next
        const delta = direction === 'prev' ? -1 : 1;
        targetPosition = Math.min(
          Math.max(activeIndicatorPosition + delta, 0),
          Math.max(indicators.length - 1, 0),
        );
      } else if (activeIndex !== null) {
        // We're not on an indicator, find the nearest one in the direction
        if (direction === 'prev') {
          let matched = -1;
          for (let pos = indicators.length - 1; pos >= 0; pos -= 1) {
            if (indicators[pos].virtuosoIndex < activeIndex) {
              matched = pos;
              break;
            }
          }
          targetPosition = matched === -1 ? 0 : matched;
        } else {
          let matched = indicators.length - 1;
          for (const [pos, indicator] of indicators.entries()) {
            if (indicator.virtuosoIndex > activeIndex) {
              matched = pos;
              break;
            }
          }
          targetPosition = matched;
        }
      } else {
        // No active index, go to first/last
        targetPosition = direction === 'prev' ? indicators.length - 1 : 0;
      }

      const targetIndicator = indicators[targetPosition];

      if (!targetIndicator) return;

      ref.scrollToIndex({
        align: 'start',
        behavior: 'smooth',
        index: targetIndicator.virtuosoIndex,
        offset: 6,
      });
    },
    [activeIndex, activeIndicatorPosition, indicators, virtuosoRef],
  );

  if (indicators.length <= MIN_MESSAGES) return null;

  return (
    <Flexbox align={'center'} className={styles.container} justify={'center'}>
      <Flexbox
        className={styles.rail}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        role={'group'}
      >
        <Tooltip mouseEnterDelay={0.1} placement={'left'} title={t('minimap.previousMessage')}>
          <button
            aria-label={t('minimap.previousMessage')}
            className={cx(styles.arrow, isHovered && styles.arrowVisible)}
            onClick={() => handleStep('prev')}
            type={'button'}
          >
            <Icon color={theme.colorTextTertiary} icon={ChevronUp} size={16} />
          </button>
        </Tooltip>
        <Flexbox className={styles.railContent}>
          {indicators.map(({ id, width, preview, role, virtuosoIndex }, position) => {
            const isActive = activeIndicatorPosition === position;
            const senderLabel =
              role === 'user' ? t('minimap.senderUser') : t('minimap.senderAssistant');

            const popoverContent = preview ? (
              <div className={styles.popoverContent}>
                <div className={styles.popoverLabel}>{senderLabel}</div>
                <div className={styles.popoverText}>{preview}</div>
              </div>
            ) : undefined;

            return (
              <Popover content={popoverContent} key={id} mouseEnterDelay={0.1} placement={'left'}>
                <button
                  aria-current={isActive ? 'true' : undefined}
                  aria-label={t('minimap.jumpToMessage', { index: position + 1 })}
                  className={styles.indicator}
                  onClick={() => handleJump(virtuosoIndex)}
                  style={{
                    width,
                  }}
                  type={'button'}
                >
                  <div
                    className={cx(
                      styles.indicatorContent,
                      isActive && styles.indicatorContentActive,
                    )}
                  />
                </button>
              </Popover>
            );
          })}
        </Flexbox>
        <Tooltip mouseEnterDelay={0.1} placement={'left'} title={t('minimap.nextMessage')}>
          <button
            aria-label={t('minimap.nextMessage')}
            className={cx(styles.arrow, isHovered && styles.arrowVisible)}
            onClick={() => handleStep('next')}
            type={'button'}
          >
            <Icon icon={ChevronDown} size={16} />
          </button>
        </Tooltip>
      </Flexbox>
    </Flexbox>
  );
};

export default memo(ChatMinimap);
