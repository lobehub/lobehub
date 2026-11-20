import { cx, Highlighter } from '@lobehub/ui';
import { memo } from 'react';

import { containerStyles } from '../style';

const Preview = memo<{ content: string }>(({ content }) => {
  return (
    <div
      className={cx(containerStyles.preview, containerStyles.previewText)}
      style={{ padding: '24px 28px' }}
    >
      <Highlighter
        wrap
        language={'json'}
        variant={'borderless'}
        style={{
          fontSize: 12,
        }}
      >
        {content}
      </Highlighter>
    </div>
  );
});

export default Preview;
