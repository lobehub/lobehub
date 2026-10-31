import { cx, lobeStaticStylish, Markdown } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';

import { styles } from '../style';
import previewStyles from '../style.module.css';

const Preview = memo<{ content: string }>(({ content }) => {
  const isMobile = useIsMobile();

  return (
    <div
      style={{ padding: 12 }}
      className={cx(
        lobeStaticStylish.noScrollbar,
        stylex.props(styles.preview).className,
        previewStyles.preview,
      )}
    >
      <Markdown variant={isMobile ? 'chat' : undefined}>{content}</Markdown>
    </div>
  );
});

export default Preview;
