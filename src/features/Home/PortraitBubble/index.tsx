import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeDailyBrief } from '@/hooks/useHomeDailyBrief';

import GreetingLine from '../GreetingLine';
import { parseGreetingLine } from '../welcomeText';

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Prose, not a row of chips: a flex container would make the brief's entity
  // links their own flex items and break the sentence into side-by-side columns.
  bubble: css`
    position: relative;

    overflow: hidden;
    display: block;

    max-width: 100%;
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 14px;

    font-size: 14px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowTertiary};

    /* The tail is what makes this read as the agent's line rather than one more
       toolbar chip, so the layout switches it off via --home-bubble-tail wherever
       it parks the bubble below the greeting instead of beside him. */
    &::after {
      content: '';

      position: absolute;
      inset-block-start: 50%;
      inset-inline-end: -5px;
      transform: translateY(-50%) rotate(45deg);

      display: var(--home-bubble-tail, none);

      width: 9px;
      height: 9px;
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
      border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

      background: ${cssVar.colorBgContainer};
    }

    &:dir(rtl)::after {
      inset-inline: -5px auto;
      transform: translateY(-50%) rotate(225deg);
    }
  `,
  // The bubble is anchored by its bottom edge, so an unbounded line grows
  // upward into the toolbar row.
  line: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  `,
}));

const PortraitBubble = memo(() => {
  const { t } = useTranslation('home');
  const { currentPair } = useHomeDailyBrief();

  const parsed = currentPair?.welcome ? parseGreetingLine(currentPair.welcome) : undefined;

  return (
    <div className={styles.bubble}>
      <div className={styles.line}>
        {parsed?.plain ? <GreetingLine parsed={parsed} /> : t('dashboard.greeting.subtitle')}
      </div>
    </div>
  );
});

export default PortraitBubble;
