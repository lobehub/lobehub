// oxlint-disable-next-line stylex-migration/no-plain-css -- the rules target every element and scrollbar inside the lobe-ui Markdown output, which has no slot or xstyle; the preview root itself must keep pointer events to scroll
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
