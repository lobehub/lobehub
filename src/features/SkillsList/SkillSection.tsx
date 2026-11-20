import {
  Accordion,
  Center,
  createStaticStyles,
  Empty,
  Flexbox,
  Icon,
  Spin,
  Text,
} from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { ChevronDownIcon } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';

import AsyncError from '@/components/AsyncError';
import { SkeletonList } from '@/components/Skeleton/NavPanel/List';
import { sidebarRow } from '@/styles/density.stylex';

export interface SkillSectionHeader {
  /** Independent header action, outside the accordion's collapse trigger. */
  action?: ReactNode;
  /** Wrap the section in a collapsible Accordion. Defaults to true. */
  collapsible?: boolean;
  count?: number;
  /** Initial expansion state when collapsible. Defaults to true. */
  defaultExpanded?: boolean;
  title: string;
}

export interface SkillSectionProps {
  children?: ReactNode;
  /** The WorkingSidebar row system: section header, tertiary label, hover-revealed action and chevron. */
  compact?: boolean;
  emptyText?: string;
  /**
   * A failed fetch. When set (and there's no data), the body renders a failure +
   * Retry instead of the empty placeholder — a failed scan must not read as
   * "no skills" (ux Read §1.1).
   */
  error?: unknown;
  isEmpty?: boolean;
  isLoading?: boolean;
  /** Retry the failed fetch (SWR `mutate`). */
  onRetry?: () => void;
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
  compactHeader: css`
    display: flex;
    gap: 4px;
    align-items: center;

    height: ${sidebarRow.sectionHeaderHeight};
    padding-inline: ${sidebarRow.paddingInline};

    [data-section-action] {
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
    }

    &:hover [data-section-action],
    &:focus-within [data-section-action] {
      pointer-events: auto;
      opacity: 1;
    }

    [data-section-chevron] {
      display: flex;
      opacity: 0;
      transition:
        opacity 0.15s,
        transform 0.15s;
    }

    &:hover [data-section-chevron],
    &:focus-within [data-section-chevron],
    [aria-expanded='false'] [data-section-chevron] {
      opacity: 1;
    }

    [aria-expanded='false'] [data-section-chevron] {
      transform: rotate(-90deg);
    }
  `,
  compactLabel: css`
    display: flex;
    flex: 1;
    gap: 4px;
    align-items: center;

    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 4px;

    font: inherit;
    font-size: ${sidebarRow.labelFontSize};
    font-weight: ${sidebarRow.labelFontWeight};
    line-height: ${sidebarRow.textLineHeight};
    color: ${cssVar.colorTextTertiary};
    text-align: start;

    background: none;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  compactLabelButton: css`
    cursor: pointer;
  `,
  compactTitle: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  compactCount: css`
    flex-shrink: 0;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
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
  compact?: boolean;
  emptyText?: string;
  error?: unknown;
  isEmpty?: boolean;
  isLoading?: boolean;
  onRetry?: () => void;
}

const CompactBody = memo<Omit<BodyProps, 'compact'>>(
  ({ children, emptyText, error, isEmpty, isLoading, onRetry }) => {
    if (error && isEmpty) {
      return (
        <Flexbox paddingBlock={4} paddingInline={4}>
          <AsyncError align={'start'} error={error} variant={'inline'} onRetry={onRetry} />
        </Flexbox>
      );
    }
    if (isLoading) return <SkeletonList compact rows={3} />;
    if (isEmpty) {
      return (
        <Center paddingBlock={24}>
          <Empty description={emptyText} icon={SkillsIcon} />
        </Center>
      );
    }
    return <>{children}</>;
  },
);

CompactBody.displayName = 'SkillSectionCompactBody';

const Body = memo<BodyProps>(
  ({ children, compact, emptyText, error, isEmpty, isLoading, onRetry }) => {
    if (compact)
      return (
        <CompactBody
          emptyText={emptyText}
          error={error}
          isEmpty={isEmpty}
          isLoading={isLoading}
          onRetry={onRetry}
        >
          {children}
        </CompactBody>
      );
    // Error before empty: a failed scan gets its own state, never a "no skills".
    if (error && isEmpty) {
      return (
        <Flexbox paddingBlock={4} paddingInline={4}>
          <AsyncError error={error} variant={'inline'} onRetry={onRetry} />
        </Flexbox>
      );
    }
    if (isLoading) {
      return (
        <Center paddingBlock={12}>
          <Spin size="middle" />
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
  },
);

Body.displayName = 'SkillSectionBody';

const SkillSection = memo<SkillSectionProps>(
  ({ children, compact, emptyText, error, isEmpty, isLoading, onRetry, sectionHeader }) => {
    // Hook always runs regardless of whether sectionHeader is provided.
    const [expanded, setExpanded] = useState(sectionHeader?.defaultExpanded ?? true);

    const body = (
      <Body
        compact={compact}
        emptyText={emptyText}
        error={error}
        isEmpty={isEmpty}
        isLoading={isLoading}
        onRetry={onRetry}
      >
        {children}
      </Body>
    );

    if (!sectionHeader) return body;

    const { action, collapsible = true, count, title } = sectionHeader;

    if (compact) {
      const label = (
        <>
          <span className={styles.compactTitle}>{title}</span>
          {typeof count === 'number' && count > 0 && (
            <span className={styles.compactCount}>{count}</span>
          )}
        </>
      );
      return (
        <Flexbox gap={1}>
          <div className={styles.compactHeader}>
            {collapsible ? (
              <button
                aria-expanded={expanded}
                className={`${styles.compactLabel} ${styles.compactLabelButton}`}
                type={'button'}
                onClick={() => setExpanded((value) => !value)}
              >
                {label}
                <span data-section-chevron>
                  <Icon icon={ChevronDownIcon} size={12} />
                </span>
              </button>
            ) : (
              <div className={styles.compactLabel}>{label}</div>
            )}
            {action && <div data-section-action>{action}</div>}
          </div>
          {(!collapsible || expanded) && body}
        </Flexbox>
      );
    }

    if (!collapsible) {
      return (
        <Flexbox gap={4}>
          <Flexbox horizontal align="center" className={styles.flatHeader} justify="space-between">
            <HeaderRow count={count} title={title} />
            {action}
          </Flexbox>
          {body}
        </Flexbox>
      );
    }

    return (
      <Accordion
        gap={4}
        indicatorPlacement="inline"
        styles={{ trigger: { paddingBlock: 2, paddingInline: 4 } }}
        value={expanded ? [ITEM_KEY] : []}
        items={[
          {
            action,
            alwaysShowAction: true,
            key: ITEM_KEY,
            title: <HeaderRow count={count} title={title} />,
            children: body,
          },
        ]}
        onValueChange={(keys) => setExpanded(keys.length > 0)}
      />
    );
  },
);

SkillSection.displayName = 'SkillSection';

export default SkillSection;
