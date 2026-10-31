import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeDailyBrief } from '@/hooks/useHomeDailyBrief';

import GreetingLine from '../GreetingLine';
import { parseGreetingLine } from '../welcomeText';

const styles = stylex.create({
  bubble: {
    overflow: 'hidden',
    display: 'block',
    maxWidth: '100%',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '14px',
    fontSize: '14px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  line: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    minHeight: '24px',
  },
});

interface PortraitBubbleProps {
  promo?: ReactNode;
}

const PortraitBubble = memo<PortraitBubbleProps>(({ promo }) => {
  const { t } = useTranslation('home');
  const { currentPair } = useHomeDailyBrief();

  const parsed = currentPair?.welcome ? parseGreetingLine(currentPair.welcome) : undefined;

  return (
    <div {...stylex.props(styles.bubble)}>
      {promo ?? (
        <div {...stylex.props(styles.line)}>
          {parsed?.plain ? <GreetingLine parsed={parsed} /> : t('dashboard.greeting.subtitle')}
        </div>
      )}
    </div>
  );
});

export default PortraitBubble;
