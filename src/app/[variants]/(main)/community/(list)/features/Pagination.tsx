'use client';

import { Pagination as Page } from 'antd';
import { createStaticStyles, useResponsive } from 'antd-style';
import { memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { SCROLL_PARENT_ID } from '@/app/[variants]/(main)/community/features/const';
import { useQuery } from '@/hooks/useQuery';
import { type DiscoverTab } from '@/types/discover';

const SCROLL_CONTAINER_ID = 'lobe-mobile-scroll-container';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    page: css`
      .${prefixCls}-pagination-item-active {
        border-color: ${cssVar.colorFillSecondary};
        background: ${cssVar.colorFillSecondary};

        &:hover {
          border-color: ${cssVar.colorFill};
          background: ${cssVar.colorFill};
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
  const { page } = useQuery();
  const navigate = useNavigate();
  const location = useLocation();
  const { mobile } = useResponsive();

  const handlePageChange = (newPage: number) => {
    const searchParams = new URLSearchParams(location.search);
    searchParams.set('page', String(newPage));
    navigate(`/community/${tab}?${searchParams.toString()}`);

    const scrollContainerId = mobile ? SCROLL_CONTAINER_ID : SCROLL_PARENT_ID;
    const scrollableElement = document?.querySelector(`#${scrollContainerId}`);
    if (!scrollableElement) return;
    scrollableElement.scrollTo({ behavior: 'smooth', top: 0 });
  };

  return (
    <Page
      className={styles.page}
      current={page ? Number(page) : currentPage}
      data-testid="pagination"
      pageSize={pageSize}
      showSizeChanger={false}
      total={total}
      style={{
        alignSelf: 'flex-end',
      }}
      onChange={handlePageChange}
    />
  );
});

export default Pagination;
