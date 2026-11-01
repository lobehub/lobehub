import '../style.css';

import { cx, lobeStaticStylish, Markdown } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';

import { styles } from '../style';

const Preview = memo<{ content: string }>(({ content }) => {
  const isMobile = useIsMobile();

  return (
    <div
      style={{ padding: 12 }}
      className={cx(
        lobeStaticStylish.noScrollbar,
        stylex.props(styles.preview).className,
        'lobe-share-message-modal-7976a4b0-preview',
      )}
    >
      <Markdown variant={isMobile ? 'chat' : undefined}>{content}</Markdown>
    </div>
  );
});

export default Preview;
