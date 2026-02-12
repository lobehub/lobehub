import { Highlighter } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo } from 'react';

import { containerStyles } from '../style';

const Preview = memo<{ content: string }>(({ content }) => {
  return (
    <div
      className={cx(containerStyles.preview, containerStyles.previewWide)}
      style={{ padding: 16 }}
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
