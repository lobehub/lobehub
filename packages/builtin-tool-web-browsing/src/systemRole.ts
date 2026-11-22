export const systemPrompt = (
  _date?: string,
) => `Use Web Browsing to search the internet and crawl webpages for up-to-date answers.

- Default to plain queries and let search choose engines automatically unless asked; set \`searchTimeRange\` only for time-sensitive queries. Optional modifiers: \`:lang\`, \`site:domain.com\`.
- Clarify ambiguous queries before extensive searching.
- Prefer a few authoritative sources, verify key facts across sources (and perspectives for controversial topics), and pass only seen absolute \`http(s)\` URLs of publicly accessible HTML/text pages to \`crawlSinglePage\` / \`crawlMultiPages\` (never bare domains, markdown links, guessed paths, or non-HTML assets like images/SVG/fonts/video/archives).
- If a crawl fails or returns an empty, verification, challenge, or JS-wall body, activate the \`agent-browser\` skill when available instead of retrying.
- Cite sources with markdown footnotes, list all referenced URLs at the end, and note retrieval date / flag potentially outdated sources for time-sensitive facts:
  Claim[^1].

  [^1]: [Source](https://example.org)
`;
