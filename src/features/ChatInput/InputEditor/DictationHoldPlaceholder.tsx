import { Flexbox } from '@lobehub/ui';
import type { ReactNode } from 'react';
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputStore } from '../store';
import { DICTATION_HOLD_HINT_GAP, getDictationHoldHintGap } from './dictationHoldHint';

/**
 * Adds the hold-to-dictate hint after the host placeholder while the gesture is
 * usable, and swaps in the hold / release coaching while a hold is in progress.
 */
const DictationHoldPlaceholder = memo<{ children: ReactNode }>(({ children }) => {
  const { t } = useTranslation('chat');
  const dictationHold = useChatInputStore((s) => s.dictationHold);
  const hintRef = useRef<HTMLSpanElement>(null);
  const [gap, setGap] = useState(DICTATION_HOLD_HINT_GAP);

  // The host placeholder is arbitrary content, so read how it ends once rendered.
  useLayoutEffect(() => {
    const hint = hintRef.current;
    if (!hint) return;
    let leadingText = '';
    for (let node = hint.previousSibling; node; node = node.previousSibling) {
      leadingText = (node.textContent ?? '') + leadingText;
    }
    setGap(getDictationHoldHintGap(leadingText));
  }, [children, dictationHold, t]);

  if (dictationHold === 'holding') {
    return (
      <Flexbox horizontal as={'span'} data-testid="dictation-hold-placeholder" gap={16}>
        <span>{t('voiceDictation.holdingStart')}</span>
        <span>{t('voiceDictation.holdingRelease')}</span>
      </Flexbox>
    );
  }

  if (dictationHold !== 'ready') return children;

  return (
    <Flexbox horizontal align={'center'} as={'span'} gap={gap} wrap={'wrap'}>
      {children}
      <span data-testid="dictation-hold-hint" ref={hintRef}>
        {t('voiceDictation.holdHint')}
      </span>
    </Flexbox>
  );
});

DictationHoldPlaceholder.displayName = 'DictationHoldPlaceholder';

export default DictationHoldPlaceholder;
