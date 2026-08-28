'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatIntergerNumber } from '@/utils/format';

import PageSizeSelect from './PageSizeSelect';

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
/** Pages either side of the current one that stay visible before an ellipsis. */
const SIBLINGS = 1;

const styles = createStaticStyles(({ css, cssVar }) => ({
  ellipsis: css`
    min-width: 24px;
    color: ${cssVar.colorTextQuaternary};
    text-align: center;
  `,
  root: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  total: css`
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
  `,
}));

type PageItem = number | 'ellipsis-end' | 'ellipsis-start';

/**
 * `1 … 4 5 6 … 703` — the first and last page stay reachable at any depth, with
 * a window around the current one in between.
 */
const getPageItems = (current: number, totalPages: number): PageItem[] => {
  // Everything fits without gaps: first + last + window + both ellipses.
  if (totalPages <= SIBLINGS * 2 + 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const start = Math.max(2, current - SIBLINGS);
  const end = Math.min(totalPages - 1, current + SIBLINGS);
  const items: PageItem[] = [1];

  if (start > 2) items.push('ellipsis-start');
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < totalPages - 1) items.push('ellipsis-end');
  items.push(totalPages);

  return items;
};

interface TablePaginationProps {
  className?: string;
  current: number;
  onChange: (current: number, pageSize: number) => void;
  pageSize: number;
  /** Sizes offered by the "N / page" picker. Must contain the current `pageSize`. */
  pageSizeOptions?: number[];
  total: number;
}

/**
 * Footer for data tables: the range on the left where reading starts, the
 * controls on the right where the hand already is.
 */
const TablePagination = memo<TablePaginationProps>(
  ({
    className,
    current,
    onChange,
    pageSize,
    pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
    total,
  }) => {
    const { t } = useTranslation('spend');

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(current, totalPages);
    const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = Math.min(total, page * pageSize);

    const goTo = (next: number) => {
      const clamped = Math.min(totalPages, Math.max(1, next));
      if (clamped !== page) onChange(clamped, pageSize);
    };

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={cx(styles.root, className)}
        gap={12}
        justify={'space-between'}
      >
        <span className={styles.total}>
          {t('table.pagination.range', {
            from: formatIntergerNumber(from),
            to: formatIntergerNumber(to),
            total: formatIntergerNumber(total),
          })}
        </span>
        <Flexbox horizontal align={'center'} gap={4}>
          <PageSizeSelect
            value={pageSize}
            options={pageSizeOptions.map((size) => ({
              label: t('table.pagination.perPage', { size }),
              value: size,
            }))}
            onChange={(nextSize) => {
              // Keep the first row of the current view in sight rather than
              // dropping the reader back to page one.
              const firstRow = (page - 1) * pageSize;
              onChange(Math.floor(firstRow / nextSize) + 1, nextSize);
            }}
          />
          <Button
            aria-label={t('table.pagination.prev')}
            disabled={page <= 1}
            icon={ChevronLeft}
            size={'small'}
            type={'text'}
            onClick={() => goTo(page - 1)}
          />
          {getPageItems(page, totalPages).map((item) =>
            typeof item === 'number' ? (
              <Button
                key={item}
                size={'small'}
                type={item === page ? 'fill' : 'text'}
                onClick={() => goTo(item)}
              >
                {item}
              </Button>
            ) : (
              <span className={styles.ellipsis} key={item}>
                …
              </span>
            ),
          )}
          <Button
            aria-label={t('table.pagination.next')}
            disabled={page >= totalPages}
            icon={ChevronRight}
            size={'small'}
            type={'text'}
            onClick={() => goTo(page + 1)}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

TablePagination.displayName = 'TablePagination';

export default TablePagination;
