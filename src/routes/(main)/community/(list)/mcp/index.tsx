import { McpMarketplace } from '@/features/CommunityMcp/McpMarketplace';
import { DiscoverTab } from '@/types/discover';

import Pagination from '../features/Pagination';
import SortButton from '../features/SortButton';

const McpPage = () => (
  <McpMarketplace
    sortControl={<SortButton />}
    renderPagination={(data) => (
      <Pagination
        currentPage={data.currentPage}
        pageSize={data.pageSize}
        tab={DiscoverTab.Mcp}
        total={data.totalCount}
      />
    )}
  />
);

export default McpPage;
