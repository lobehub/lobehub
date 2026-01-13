import { WebBrowsingApiName } from '../../types';
import { CrawlMultiPagesInspector } from './CrawlMultiPages';
import { CrawlSinglePageInspector } from './CrawlSinglePage';
import { SearchInspector } from './Search';

/**
 * Web Browsing Inspector Components Registry
 */
export const WebBrowsingInspectors = {
  [WebBrowsingApiName.crawlMultiPages]: CrawlMultiPagesInspector,
  [WebBrowsingApiName.crawlSinglePage]: CrawlSinglePageInspector,
  [WebBrowsingApiName.search]: SearchInspector,
};
