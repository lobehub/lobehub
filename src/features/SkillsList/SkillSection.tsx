import { Accordion, AccordionItem, Center, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, type ReactNode, useState } from 'react';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

export interface SkillSectionHeader {
  /** Wrap the section in a collapsible Accordion. Defaults to true. */
  collapsible?: boolean;
  count?: number;
  /** Initial expansion state when collapsible. Defaults to true. */
  defaultExpanded?: boolean;
  title: string;
}

export interface SkillSectionProps {
  children?: ReactNode;
  emptyText?: string;
  isEmpty?: boolean;
  isLoading?: boolean;
  /**
   * When provided, wraps content in a header + optional Accordion. Omit to
   * render `children` flat (the caller controls layout entirely).
   */
  sectionHeader?: SkillSectionHeader;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  count: css`
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  empty: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  flatHeader: css`
    padding-inline: 4px;
  `,
  label: css`
    font-size: 12px;
    font-weight: 500;
  `,
}));

const ITEM_KEY = 'skill-section';

interface HeaderRowProps {
  count?: number;
  title: string;
}

const HeaderRow = memo<HeaderRowProps>(({ count, title }) => (
  <Flexbox horizontal align={'center'} gap={6}>
    <Text className={styles.label} type={'secondary'}>
      {title}
    </Text>
    {typeof count === 'number' && count > 0 && <span className={styles.count}>{count}</span>}
  </Flexbox>
));

HeaderRow.displayName = 'SkillSectionHeaderRow';

interface BodyProps {
  children?: ReactNode;
  emptyText?: string;
  isEmpty?: boolean;
  isLoading?: boolean;
}

const Body = memo<BodyProps>(({ children, emptyText, isEmpty, isLoading }) => {
  if (isLoading) {
    return (
      <Center paddingBlock={12}>
        <NeuralNetworkLoading size={24} />
      </Center>
    );
  }
  if (isEmpty) {
    return (
      <Center paddingBlock={8}>
        <Text className={styles.empty}>{emptyText}</Text>
      </Center>
    );
  }
  return <>{children}</>;
});

Body.displayName = 'SkillSectionBody';

const SkillSection = memo<SkillSectionProps>(
  ({ children, emptyText, isEmpty, isLoading, sectionHeader }) => {
    // Hook always runs regardless of whether sectionHeader is provided.
    const [expanded, setExpanded] = useState(sectionHeader?.defaultExpanded ?? true);

    const body = (
      <Body emptyText={emptyText} isEmpty={isEmpty} isLoading={isLoading}>
        {children}
      </Body>
    );

    if (!sectionHeader) return body;

    const { collapsible = true, count, title } = sectionHeader;

    if (!collapsible) {
      return (
        <Flexbox gap={4}>
          <div className={styles.flatHeader}>
            <HeaderRow count={count} title={title} />
          </div>
          {body}
        </Flexbox>
      );
    }

    return (
      <Accordion
        expandedKeys={expanded ? [ITEM_KEY] : []}
        gap={4}
        onExpandedChange={(keys) => setExpanded(keys.length > 0)}
      >
        <AccordionItem
          itemKey={ITEM_KEY}
          paddingBlock={2}
          paddingInline={4}
          title={<HeaderRow count={count} title={title} />}
        >
          {body}
        </AccordionItem>
      </Accordion>
    );
  },
);

SkillSection.displayName = 'SkillSection';

export default SkillSection;
