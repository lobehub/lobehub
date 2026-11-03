import type { CrawlUrlRule } from '../type';

export const applyUrlRules = (
  url: string,
  urlRules: CrawlUrlRule[],
): {
  filterOptions?: CrawlUrlRule['filterOptions'];
  impls?: string[];
  transformedUrl: string;
} => {
  for (const rule of urlRules) {
    // Convert to regular expression
    const regex = new RegExp(rule.urlPattern);
    const match = url.match(regex);

    if (match) {
      if (rule.urlTransform) {
        // If there is a transformation rule, perform URL transformation
        // Replace placeholders like $1, $2 with capture group content
        const transformedUrl = rule.urlTransform.replaceAll(
          /\$(\d+)/g,
          (_, index) => match[parseInt(index)] || '',
        );

        return {
          filterOptions: rule.filterOptions,
          impls: rule.impls,
          transformedUrl,
        };
      } else {
        // No transformation rule but pattern matched, only return filter options
        return {
          filterOptions: rule.filterOptions,
          impls: rule.impls,
          transformedUrl: url,
        };
      }
    }
  }

  // No rule matched, return original URL
  return { transformedUrl: url };
};
