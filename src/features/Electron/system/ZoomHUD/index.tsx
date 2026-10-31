'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const HUD_DURATION_MS = 1500;

const styles = stylex.create({
  caption: {
    marginBlockStart: '2px',
    fontSize: '11px',
    fontWeight: 500,
    lineHeight: 1,
    color: cssVar.colorTextTertiary,
  },
  hud: {
    pointerEvents: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    alignItems: 'center',
    justifyContent: 'center',
    width: '144px',
    height: '108px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '22px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    backdropFilter: 'blur(28px) saturate(1.6)',
    boxShadow: cssVar.boxShadowSecondary,
  },
  layer: {
    pointerEvents: 'none',
    position: 'fixed',
    zIndex: 1500,
    insetBlockStart: '28%',
    insetInline: '0',
    display: 'flex',
    justifyContent: 'center',
  },
  num: {
    fontSize: '34px',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
    color: cssVar.colorText,
    letterSpacing: '-0.02em',
  },
});

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
        <div {...stylex.props(styles.layer)}>
          <m.div
            animate={{ opacity: 1, scale: 1 }}
            aria-live="polite"
            {...stylex.props(styles.hud)}
            exit={{ opacity: 0, scale: 0.96 }}
            initial={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <span {...stylex.props(styles.num)}>{Math.round(factor * 100)}%</span>
            <span {...stylex.props(styles.caption)}>{t('zoom')}</span>
          </m.div>
        </div>
      )}
    </AnimatePresence>
  );
});

ZoomHUD.displayName = 'ZoomHUD';

export default ZoomHUD;
