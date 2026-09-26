# AnySearch integration

This document describes the LobeHub integration points for AnySearch and the maintenance contract
between LobeHub's provider-neutral web tools and AnySearch-specific capabilities.

## Architecture

The integration deliberately uses LobeHub's existing web-search abstractions:

- `SEARCH_PROVIDERS=anysearch` selects the native AnySearch implementation in
  `apps/server/src/services/search/impls/anysearch/`.
- `CRAWLER_IMPLS=anysearch` selects AnySearch Extract in
  `packages/web-crawler/src/crawImpl/anysearch.ts`.
- Advanced AnySearch capabilities that do not fit LobeHub's provider-neutral search request schema
  are available through AnySearch's remote MCP endpoint, `https://api.anysearch.com/mcp`.

This keeps ordinary Web Search and page reading provider-neutral while still exposing the complete
AnySearch capability set through LobeHub's Connector/MCP framework.

## Authentication

`ANYSEARCH_API_KEY` is optional for both native search and Extract. When it is unset or blank, the
native implementations omit the `Authorization` header and use AnySearch anonymous access. When it
is configured, requests send `Authorization: Bearer <key>`.

Do not log the key or upstream response bodies that may contain sensitive diagnostics. MCP
credentials should be stored in LobeHub Connector authentication settings rather than committed to
shared configuration.

## Native general search

The native provider calls:

```text
POST https://api.anysearch.com/v1/search
```

with `query` and `max_results`. AnySearch chooses the backing search source, so
`useAutoSearchEngineSelection` is enabled and LobeHub `searchEngines` restrictions are intentionally
not forwarded.

AnySearch results are projected into `UniformSearchResult`. LobeHub's native search result contract
requires a citeable URL, so structured AnySearch results without an absolute HTTP(S) URL are omitted
from this provider-neutral path. Their advanced structured form remains available through the MCP
tools.

## Native Extract

The crawler calls:

```text
POST https://api.anysearch.com/v1/extract
```

with the target URL. The cleaned page content, title, and canonical response URL are mapped into
`CrawlSuccessResult`, allowing the existing single-page and multi-page crawl flows to use AnySearch
without a provider-specific UI.

Existing crawler timeout, retry, HTTP-status, and dead-link semantics remain in effect.

## Vertical and parallel search

LobeHub's native `SearchParams` currently models categories, engines, and time range. It does not
have provider-neutral fields for AnySearch domain/sub-domain schemas or a multi-query batch request.
Adding those fields only for one provider would leak provider-specific semantics into the shared
Web Search contract.

LobeHub already supports remote Streamable HTTP MCP servers, so the official AnySearch MCP endpoint
is the integration path for capabilities that do not fit the native contract:

- domain and sub-domain discovery;
- vertical / parameterized search;
- parallel batch search for one to five queries;
- Extract.

The user-facing Web Search documentation contains the connection endpoint and configuration
guidance. This split should be revisited if LobeHub later adds provider-neutral vertical-search or
batch-search fields.

## Validation

Run the provider tests from the repository root:

```sh
pnpm exec vitest run --silent='passed-only' \
  apps/server/src/services/search/impls/anysearch/index.test.ts \
  apps/server/src/services/search/index.test.ts
```

Run crawler tests from its owning package:

```sh
cd packages/web-crawler
pnpm exec vitest run --silent='passed-only' src/crawImpl/__tests__/anysearch.test.ts
```

Also run the repository check/type/lint gates for the changed files before merging.

## Maintenance checklist

When AnySearch changes its API:

1. Verify the `/v1/search` and `/v1/extract` request and response envelopes.
2. Preserve anonymous behavior by omitting `Authorization` when no key is configured.
3. Keep native search output compatible with `UniformSearchResponse`.
4. Keep Extract output compatible with `CrawlSuccessResult` and existing retry semantics.
5. Re-check the MCP endpoint and exposed advanced tools before changing the documentation.
6. Update focused regression tests together with implementation changes.
