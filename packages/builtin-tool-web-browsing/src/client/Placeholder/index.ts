import { WebBrowsingApiName } from '../../types';
import CrawlMultiPages from './CrawlMultiPages';
import CrawlSinglePage from './CrawlSinglePage';
import { Search } from './Search';

/**
 * Web Browsing Placeholder Components Registry
 */
export const WebBrowsingPlaceholders = {
  [WebBrowsingApiName.crawlMultiPages]: CrawlMultiPages,
  [WebBrowsingApiName.crawlSinglePage]: CrawlSinglePage,
  [WebBrowsingApiName.search]: Search,
};

export { CrawlMultiPages, CrawlSinglePage, Search };
