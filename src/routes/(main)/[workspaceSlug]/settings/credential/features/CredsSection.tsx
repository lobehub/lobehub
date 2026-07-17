'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type FC, type PropsWithChildren, type ReactNode } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    width: 100%;
    padding-block: 4px;
    padding-inline: 16px;
  `,
  desc: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    font-size: 16px;
    font-weight: 600;
  `,
}));

interface CredsSectionProps {
  desc: string;
  /** Rendered on the right of the section header — e.g. the create button. */
  extra?: ReactNode;
  title: string;
}

/**
 * Shared section shell for the workspace credential page: a title/description
 * header row with an optional action slot, above an outlined container that
 * groups the section's credential list — the same container treatment as the
 * agent channel detail page.
 */
const CredsSection: FC<PropsWithChildren<CredsSectionProps>> = ({
  title,
  desc,
  extra,
  children,
}) => (
  <Flexbox gap={12}>
    <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
      <Flexbox gap={4}>
        <Text className={styles.title}>{title}</Text>
        <Text className={styles.desc}>{desc}</Text>
      </Flexbox>
      {extra}
    </Flexbox>
    <Block className={styles.container} variant={'outlined'}>
      {children}
    </Block>
  </Flexbox>
);

export default CredsSection;
