import { Markdown } from '@lobehub/ui';
import { memo } from 'react';

import { previewClassName } from '../style';

const Preview = memo<{ content: string }>(({ content }) => {
  return (
    <div className={previewClassName('text')} style={{ padding: '24px 28px' }}>
      <Markdown variant={'chat'}>{content}</Markdown>
    </div>
  );
});

export default Preview;
