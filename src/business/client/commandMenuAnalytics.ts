export interface CommandMenuAnalyticsInput {
  enabled: boolean;
  hasError: boolean;
  hasResponse: boolean;
  isValidating: boolean;
  menuContext: string;
  resultCount: number;
  searchQuery: string;
  typeFilter?: string;
}

export interface CommandMenuResultClick {
  position: number;
  resultType: string;
}

const noop = () => {};
const noopInputChange = (_value: string) => {};
const noopResultClick = (_input: CommandMenuResultClick) => {};
const EMPTY_ANALYTICS = Object.freeze({
  trackFilterChange: noop,
  trackInputChange: noopInputChange,
  trackResultClick: noopResultClick,
});

/** Optional product-analytics integration for the command menu search surface. */
export const useCommandMenuAnalytics = (_input: CommandMenuAnalyticsInput) => EMPTY_ANALYTICS;
