import { Markdown } from '@lobehub/ui';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';

import { styles } from '../style';

const Preview = memo<{ content: string }>(({ content }) => {
  const isMobile = useIsMobile();

  return (
    <div className={styles.preview} style={{ padding: 12 }}>
      <Markdown variant={isMobile ? 'chat' : undefined}>{content}</Markdown>
    </div>
  );
});

export default Preview;
