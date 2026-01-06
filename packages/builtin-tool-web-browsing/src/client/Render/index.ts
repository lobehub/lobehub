import { WebBrowsingApiName } from '../../types';
import CrawlMultiPages from './CrawlMultiPages';
import CrawlSinglePage from './CrawlSinglePage';
import Search from './Search';

/**
 * Web Browsing Render Components Registry
 */
export const WebBrowsingRenders = {
  [WebBrowsingApiName.crawlMultiPages]: CrawlMultiPages,
  [WebBrowsingApiName.crawlSinglePage]: CrawlSinglePage,
  [WebBrowsingApiName.search]: Search,
};

export { CrawlMultiPages, CrawlSinglePage, Search };
