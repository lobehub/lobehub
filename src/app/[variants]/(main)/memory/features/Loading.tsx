import { Flexbox, Grid, Skeleton } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { type ViewMode } from './ViewModeSwitcher';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
}));

const Loading = memo<{ rows?: number; viewMode?: ViewMode }>(({ viewMode, rows = 3 }) => {
  if (viewMode === 'timeline') {
    return (
      <Flexbox gap={24} paddingBlock={24} style={{ paddingLeft: 32 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Flexbox gap={8} key={i}>
            <Skeleton.Title active fontSize={18} lineHeight={1.4} width={'30%'} />
            <Skeleton.Paragraph active rows={4} style={{ marginBottom: 0 }} />
          </Flexbox>
        ))}
      </Flexbox>
    );
  }

  return (
    <Grid gap={12} maxItemWidth={240} paddingBlock={8} rows={rows}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Flexbox className={styles.card} key={i}>
          <Skeleton.Title active fontSize={16} lineHeight={1.4} width={'80%'} />
          <Skeleton.Paragraph active rows={5} style={{ marginBottom: 0 }} />
          <Flexbox horizontal gap={8}>
            <Skeleton.Button active size={'small'} style={{ height: 20, width: 60 }} />
            <Skeleton.Button active size={'small'} style={{ height: 20, width: 50 }} />
          </Flexbox>
        </Flexbox>
      ))}
    </Grid>
  );
});

export default Loading;
