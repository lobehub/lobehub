export const WebBrowsingApiName = {
  crawlMultiPages: 'crawlMultiPages',
  crawlSinglePage: 'crawlSinglePage',
  search: 'search',
} as const;

export type WebBrowsingApiNameType = (typeof WebBrowsingApiName)[keyof typeof WebBrowsingApiName];
