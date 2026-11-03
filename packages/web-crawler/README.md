# @lobechat/web-crawler

LobeHub's built-in web crawling module for intelligent extraction of web content and conversion to Markdown format.

## 📝 Introduction

`@lobechat/web-crawler` is a core component of LobeHub responsible for intelligent web content crawling and processing. It extracts valuable content from various webpages, filters out distracting elements, and generates structured Markdown text.

## 🛠️ Core Features

- **Intelligent Content Extraction**: Identifies main content based on Mozilla Readability algorithm
- **Multi-level Crawling Strategy**: Supports multiple crawling implementations including basic crawling, Jina, Search1API, and Browserless rendering
- **Custom URL Rules**: Handles specific website crawling logic through a flexible rule system

## 🤝 Contribution

Web structures are diverse and complex. We welcome community contributions for specific website crawling rules. You can participate in improvements through:

### How to Contribute URL Rules

1. Add new rules to the [urlRules.ts](https://github.com/lobehub/lobe-chat/blob/main/packages/web-crawler/src/urlRules.ts) file
2. Rule example:

```typescript
// Example: handling specific websites
const url = [
  // ... other URL matching rules
  {
    // URL matching pattern, supports regex
    urlPattern: 'https://example.com/articles/(.*)',

    // Optional: URL transformation, redirects to an easier-to-crawl version
    urlTransform: 'https://example.com/print/$1',

    // Optional: specify crawling implementation, supports 'naive', 'jina', 'search1api', and 'browserless'
    impls: ['naive', 'jina', 'search1api', 'browserless'],

    // Optional: content filtering configuration
    filterOptions: {
      // Whether to enable Readability algorithm for filtering distracting elements
      enableReadability: true,
      // Whether to convert to plain text
      pureText: false,
    },
  },
];
```

### Rule Submission Process

1. Fork the [LobeHub repository](https://github.com/lobehub/lobe-chat)
2. Add or modify URL rules
3. Submit a Pull Request describing:

- Target website characteristics
- Problems solved by the rule
- Test cases (example URLs)

## 📌 Note

This is an internal module of LobeHub (`"private": true`), designed specifically for LobeHub and not published as a standalone package.
