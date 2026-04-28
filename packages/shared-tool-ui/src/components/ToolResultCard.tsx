'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: 8px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  header: css`
    padding-inline: 4px;
    color: ${cssVar.colorTextSecondary};
  `,
  previewBox: css`
    overflow: hidden;
    padding: 8px;
    border-radius: 8px;
    background: ${cssVar.colorBgContainer};
  `,
}));

interface ToolResultCardProps {
  children?: ReactNode;
  header: ReactNode;
  icon: LucideIcon;
  wrapHeader?: boolean;
}

export const ToolResultCard = memo<ToolResultCardProps>(
  ({ icon, header, children, wrapHeader }) => (
    <Flexbox className={styles.container} gap={8}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.header}
        gap={8}
        wrap={wrapHeader ? 'wrap' : undefined}
      >
        <Icon icon={icon} size={'small'} />
        {header}
      </Flexbox>
      {children && <Flexbox className={styles.previewBox}>{children}</Flexbox>}
    </Flexbox>
  ),
);

ToolResultCard.displayName = 'ToolResultCard';
