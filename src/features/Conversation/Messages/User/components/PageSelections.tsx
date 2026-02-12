import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { type PageSelection } from '@/types/index';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    cursor: pointer;
    position: relative;
    border-radius: 8px;

    :hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  content: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    white-space: pre-wrap;
  `,
  quote: css`
    inset-block-start: 2px;
    inset-inline-start: 0;

    font-family: Georgia, serif;
    font-size: 28px;
    line-height: 1;
    color: ${cssVar.colorTextQuaternary};
  `,
  wrapper: css``,
}));

interface PageSelectionsProps {
  selections: PageSelection[];
}

const PageSelections = memo<PageSelectionsProps>(({ selections }) => {
  if (!selections || selections.length === 0) return null;

  return (
    <Flexbox gap={8}>
      {selections.map((selection) => (
        <Flexbox className={styles.container} key={selection.id}>
          <Flexbox horizontal className={styles.wrapper} gap={4} padding={4}>
            {}
            <span className={styles.quote}>"</span>
            <div className={styles.content}>{selection.content}</div>
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

export default PageSelections;
