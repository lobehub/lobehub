'use client';

import { Pagination as Page } from '@lobehub/ui/base-ui';
import { useResponsive } from 'antd-style';
import { memo } from 'react';
import { useLocation } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useQuery } from '@/hooks/useQuery';
import { SCROLL_PARENT_ID } from '@/routes/(main)/community/features/const';
import { type DiscoverTab } from '@/types/discover';

const SCROLL_CONTAINER_ID = 'lobe-mobile-scroll-container';

interface PaginationProps {
  currentPage: number;
  pageSize: number;
  tab: DiscoverTab;
  total: number;
}

const Pagination = memo<PaginationProps>(({ tab, currentPage, total, pageSize }) => {
  const { page } = useQuery();
  const navigate = useWorkspaceAwareNavigate();
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
