import { createStaticStyles } from 'antd-style';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeDailyBrief } from '@/hooks/useHomeDailyBrief';

import GreetingLine from '../GreetingLine';
import { parseGreetingLine } from '../welcomeText';

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Prose, not a row of chips: a flex container would make the brief's entity
  // links their own flex items and break the sentence into side-by-side columns.
  bubble: css`
    overflow: hidden;
    display: block;

    max-width: 100%;
    padding-block: 6px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 14px;

    font-size: 14px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  /**
   * Match the 24px action row when a brief replaces an announcement. Limit
   * prose to two lines so optional content cannot push the composer far down.
   */
  line: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    min-height: 24px;
  `,
}));

interface PortraitBubbleProps {
  promo?: ReactNode;
}

const PortraitBubble = memo<PortraitBubbleProps>(({ promo }) => {
  const { t } = useTranslation('home');
  const { currentPair } = useHomeDailyBrief();

  const parsed = currentPair?.welcome ? parseGreetingLine(currentPair.welcome) : undefined;

  return (
    <div className={styles.bubble}>
      {promo ?? (
        <div className={styles.line}>
          {parsed?.plain ? <GreetingLine parsed={parsed} /> : t('dashboard.greeting.subtitle')}
        </div>
      )}
    </div>
  );
});

export default PortraitBubble;
