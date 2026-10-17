import { cx, Markdown } from '@lobehub/ui';
import { memo } from 'react';

import { containerStyles } from '../style';

const Preview = memo<{ content: string }>(({ content }) => {
  return (
    <div
      className={cx(containerStyles.preview, containerStyles.previewText)}
      style={{ padding: '24px 28px' }}
    >
      <Markdown variant={'chat'}>{content}</Markdown>
    </div>
  );
});

export default Preview;
