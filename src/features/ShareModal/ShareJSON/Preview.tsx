import { Highlighter } from '@lobehub/ui';
import { memo } from 'react';

import { previewClassName } from '../style';

const Preview = memo<{ content: string }>(({ content }) => {
  return (
    <div className={previewClassName('text')} style={{ padding: '24px 28px' }}>
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
