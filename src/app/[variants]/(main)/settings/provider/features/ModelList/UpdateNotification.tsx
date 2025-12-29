import { Typography } from 'antd';
import { useTheme } from 'antd-style';
import { ReactNode, memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

const MAX_VISIBLE_MODELS = 5;
export const NOTIFICATION_DURATION = 6;

interface UpdateNotificationProps {
  added: string[];
  builtinNotInRemote?: string[];
  removedButBuiltin?: string[];
  removedFromList?: string[];
}

interface UpdateNotificationContentProps extends UpdateNotificationProps {
  duration?: number;
  onAutoClose: () => void;
}

const ModelList = ({ models, title }: { models: string[] | undefined; title?: ReactNode }) => {
  const { t } = useTranslation('modelProvider');
  const [expanded, setExpanded] = useState(false);

  if (!models || models.length === 0) return null;

  const visibleModels = models.slice(0, MAX_VISIBLE_MODELS);
  const hiddenModels = models.slice(MAX_VISIBLE_MODELS);
  const hasMore = hiddenModels.length > 0;

  return (
    <Flexbox gap={4}>
      {title && (
        <Typography.Text style={{ fontSize: 13, fontWeight: 600 }}>{title}</Typography.Text>
      )}
      <Flexbox gap={4} style={{ paddingLeft: 4 }}>
        {visibleModels.map((model) => (
          <Typography.Text code key={model} style={{ fontSize: 12 }}>
            {model}
          </Typography.Text>
        ))}
        {expanded &&
          hiddenModels.map((model) => (
            <Typography.Text code key={model} style={{ fontSize: 12 }}>
              {model}
            </Typography.Text>
          ))}
        {hasMore && (
          <Typography.Link onClick={() => setExpanded(!expanded)} style={{ fontSize: 12 }}>
            {expanded
              ? t('providerModels.list.fetcher.updateResult.collapse')
              : t('providerModels.list.fetcher.updateResult.showMore', {
                  count: hiddenModels.length,
                })}
          </Typography.Link>
        )}
      </Flexbox>
    </Flexbox>
  );
};

const TimeoutProgress = ({ percent }: { percent: number }) => {
  const theme = useTheme();

  return (
    <div
      style={{
        background: theme.colorFillSecondary,
        bottom: 0,
        height: 4,
        left: 0,
        position: 'absolute',
        right: 0,
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: theme.colorPrimary,
          height: '100%',
          transition: 'width 100ms linear',
          width: `${percent}%`,
        }}
      />
    </div>
  );
};

export const UpdateNotificationContent = memo(
  ({
    added,
    builtinNotInRemote,
    duration = NOTIFICATION_DURATION,
    onAutoClose,
    removedButBuiltin,
    removedFromList,
  }: UpdateNotificationContentProps) => {
    const { t } = useTranslation('modelProvider');
    const [isHovered, setIsHovered] = useState(false);
    const [percent, setPercent] = useState(100);
    const durationMs = duration * 1000;
    const remainingTimeRef = useRef(durationMs);
    const timerRef = useRef<number | null>(null);
    const autoClosedRef = useRef(false);

    useEffect(() => {
      remainingTimeRef.current = durationMs;
      autoClosedRef.current = false;
      setPercent(100);
    }, [durationMs]);

    useEffect(() => {
      if (isHovered) {
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return;
      }

      let lastTick = Date.now();
      timerRef.current = window.setInterval(() => {
        const now = Date.now();
        const delta = now - lastTick;
        lastTick = now;

        remainingTimeRef.current = Math.max(0, remainingTimeRef.current - delta);
        const nextPercent = (remainingTimeRef.current / durationMs) * 100;
        setPercent(nextPercent);

        if (remainingTimeRef.current <= 0 && !autoClosedRef.current) {
          autoClosedRef.current = true;
          if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          onAutoClose();
        }
      }, 100);

      return () => {
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
    }, [durationMs, isHovered, onAutoClose]);

    return (
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ paddingBottom: 12, position: 'relative' }}
      >
        <Flexbox gap={12} style={{ maxHeight: '70vh', overflowY: 'auto', paddingBottom: 24 }}>
          <ModelList
            models={added}
            title={
              added.length > 0 &&
              t('providerModels.list.fetcher.updateResult.added', { count: added.length })
            }
          />
          <ModelList
            models={removedFromList}
            title={
              removedFromList &&
              removedFromList.length > 0 &&
              t('providerModels.list.fetcher.updateResult.removed', {
                count: removedFromList.length,
              })
            }
          />
          <ModelList
            models={removedButBuiltin}
            title={
              removedButBuiltin &&
              removedButBuiltin.length > 0 &&
              t('providerModels.list.fetcher.updateResult.removedButBuiltin', {
                count: removedButBuiltin.length,
              })
            }
          />
          <ModelList
            models={builtinNotInRemote}
            title={
              builtinNotInRemote &&
              builtinNotInRemote.length > 0 &&
              t('providerModels.list.fetcher.updateResult.builtinNotInRemote', {
                count: builtinNotInRemote.length,
              })
            }
          />
        </Flexbox>
        <TimeoutProgress percent={percent} />
      </div>
    );
  },
);
UpdateNotificationContent.displayName = 'UpdateNotificationContent';
