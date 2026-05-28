'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { createStaticStyles, cssVar } from 'antd-style';
import { AnimatePresence, m } from 'motion/react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const HUD_DURATION_MS = 1500;

const styles = createStaticStyles(({ css }) => ({
  caption: css`
    margin-block-start: 2px;

    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0.18em;
  `,
  hud: css`
    pointer-events: none;

    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
    justify-content: center;

    width: 144px;
    height: 108px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 22px;

    background: ${cssVar.colorBgElevated};
    backdrop-filter: blur(28px) saturate(1.6);
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  layer: css`
    pointer-events: none;

    position: fixed;
    z-index: 1500;
    inset-block-start: 28%;
    inset-inline: 0;

    display: flex;
    justify-content: center;
  `,
  num: css`
    font-size: 34px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: ${cssVar.colorText};
    letter-spacing: -0.02em;
  `,
}));

const ZoomHUD = memo(() => {
  const { t } = useTranslation('common');
  const [factor, setFactor] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useWatchBroadcast('zoom:changed', ({ factor: next }) => {
    setFactor(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFactor(null), HUD_DURATION_MS);
  });

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <AnimatePresence>
      {factor !== null && (
        <div className={styles.layer}>
          <m.div
            animate={{ opacity: 1, scale: 1 }}
            aria-live="polite"
            className={styles.hud}
            exit={{ opacity: 0, scale: 0.96 }}
            initial={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className={styles.num}>{Math.round(factor * 100)}%</span>
            <span className={styles.caption}>{t('zoom')}</span>
          </m.div>
        </div>
      )}
    </AnimatePresence>
  );
});

ZoomHUD.displayName = 'ZoomHUD';

export default ZoomHUD;
