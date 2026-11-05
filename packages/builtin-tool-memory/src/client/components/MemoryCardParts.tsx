'use client';

import { Accordion, Flexbox, Tag, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { memo } from 'react';

import { highlightTextStyles } from '@/styles';

import type { MemoryEntity } from './memoryArgs';
import { ENTITY_ICONS, FALLBACK_ENTITY_ICON } from './memoryArgs';

/**
 * Layout shared by the context / activity / identity memory cards, so a memory
 * reads the same whichever layer it was written to.
 */
export const memoryCardStyles = stylex.create({
  chip: {
    paddingBlock: '4px',
    paddingInline: '8px',
    borderRadius: '6px',
    fontSize: '12px',
    lineHeight: 1.4,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  chipType: {
    color: cssVar.colorTextQuaternary,
  },
  container: {
    overflow: 'hidden',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  content: {
    paddingBlock: '12px',
    paddingInline: '16px',
  },
  detail: {
    fontSize: '13px',
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
  },
  header: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  section: {
    paddingBlock: '4px',
    paddingInline: '4px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  sectionBody: {
    fontSize: '14px',
    lineHeight: 1.6,
    color: cssVar.colorText,
  },
  summary: {
    fontSize: '14px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
  tags: {
    paddingBlockStart: '8px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'dashed',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 1,
    fontWeight: 500,
    color: cssVar.colorText,
  },
});

interface MemorySectionProps {
  children: ReactNode;
  title: string;
  /** Which highlight underline the label wears. */
  tone?: 'gold' | 'info' | 'primary' | 'warning';
}

/** A labelled block below the header, e.g. `Description`, `Narrative`, `Evidence`. */
export const MemorySection = memo<MemorySectionProps>(({ children, title, tone = 'primary' }) => (
  <Flexbox
    className={stylex.props(memoryCardStyles.section).className}
    gap={8}
    style={{ paddingBlock: 16, paddingInline: 12 }}
  >
    <Text fontSize={12} weight={500}>
      <span className={highlightTextStyles[tone]}>{title}</span>
    </Text>
    {children}
  </Flexbox>
));

MemorySection.displayName = 'MemorySection';

interface EntityChipsProps {
  entities: MemoryEntity[];
}

/** People, places, and things involved in a memory, as compact chips. */
export const EntityChips = memo<EntityChipsProps>(({ entities }) => (
  <Flexbox horizontal gap={8} wrap={'wrap'}>
    {entities.map((entity, index) => {
      const chip = (
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(memoryCardStyles.chip).className}
          gap={6}
          key={index}
        >
          <span>{(entity.type && ENTITY_ICONS[entity.type]) || FALLBACK_ENTITY_ICON}</span>
          <span>{entity.name}</span>
          {entity.type && <span {...stylex.props(memoryCardStyles.chipType)}>{entity.type}</span>}
        </Flexbox>
      );

      // `extra` is raw JSON metadata — keep it out of the chip, on hover only
      return entity.extra ? (
        <Tooltip key={index} title={entity.extra}>
          {chip}
        </Tooltip>
      ) : (
        chip
      );
    })}
  </Flexbox>
));

EntityChips.displayName = 'EntityChips';

interface SummaryAccordionProps {
  details?: string;
  summary?: string;
  tags: string[];
}

/**
 * The summary/details/tags block, collapsed by default. Used when the card has
 * richer layer-specific content to lead with instead.
 */
export const SummaryAccordion = memo<SummaryAccordionProps>(({ details, summary, tags }) => {
  if (!summary && tags.length === 0) return null;

  return (
    <Accordion
      gap={0}
      items={[
        {
          children: (
            <Flexbox gap={8} paddingBlock={'8px 12px'} paddingInline={8}>
              {summary && <div {...stylex.props(memoryCardStyles.summary)}>{summary}</div>}
              {details && <div {...stylex.props(memoryCardStyles.detail)}>{details}</div>}
              {tags.length > 0 && (
                <Flexbox
                  horizontal
                  className={stylex.props(memoryCardStyles.tags).className}
                  gap={8}
                  wrap={'wrap'}
                >
                  {tags.map((tag, index) => (
                    <Tag key={index}>{tag}</Tag>
                  ))}
                </Flexbox>
              )}
            </Flexbox>
          ),
          key: 'summary',
          title: (
            <Text fontSize={12} type={'secondary'} weight={500}>
              Summary
            </Text>
          ),
        },
      ]}
      styles={{
        item: { marginBlock: 4, marginInline: 4 },
      }}
    />
  );
});

SummaryAccordion.displayName = 'SummaryAccordion';
