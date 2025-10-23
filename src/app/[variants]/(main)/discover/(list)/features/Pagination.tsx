'use client';

import { Pagination as Page } from 'antd';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { SCROLL_PARENT_ID } from '@/app/[variants]/(main)/discover/features/const';
import { useQuery } from '@/hooks/useQuery';
import { DiscoverTab } from '@/types/discover';

const useStyles = createStyles(({ css, token, prefixCls }) => {
  return {
    page: css`
      .${prefixCls}-pagination-item-active {
        border-color: ${token.colorFillSecondary};
        background: ${token.colorFillSecondary};

        &:hover {
          border-color: ${token.colorFill};
          background: ${token.colorFill};
        }
      }
    `,
  };
});

interface PaginationProps {
  currentPage: number;
  pageSize: number;
  tab: DiscoverTab;
  total: number;
}

const Pagination = memo<PaginationProps>(({ tab, currentPage, total, pageSize }) => {
  const { styles } = useStyles();
  const { page } = useQuery();
  const navigate = useNavigate();
  const location = useLocation();

  const handlePageChange = (newPage: number) => {
    const searchParams = new URLSearchParams(location.search);
    searchParams.set('page', String(newPage));
    navigate(`/${tab}?${searchParams.toString()}`);

    const scrollableElement = document?.querySelector(`#${SCROLL_PARENT_ID}`);
    if (!scrollableElement) return;
    scrollableElement.scrollTo({ behavior: 'smooth', top: 0 });
  };

  return (
    <Page
      className={styles.page}
      current={page ? Number(page) : currentPage}
      onChange={handlePageChange}
      pageSize={pageSize}
      showSizeChanger={false}
      style={{
        alignSelf: 'flex-end',
      }}
      total={total}
    />
  );
});

export default Pagination;
