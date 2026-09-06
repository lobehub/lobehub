---
name: add-model-provider
description: Add an AI model provider to LobeHub, including runtime integration, model cards, configuration, branding, documentation, and acceptance. Also use for provider documentation updates; adding models to an existing provider does not require a new provider integration.
disable-model-invocation: true
argument-hint: '[provider-name]'
---

# Add a Model Provider

Deliver a provider that users can configure, recognize, and use through the supported API paths. This skill includes the documentation workflow formerly maintained in `add-provider-doc`.

Paths below are relative to the open-source repository root. In a Cloud checkout, prefix them with `lobehub/` and follow the parent repository's install and Git rules. Hosted model configuration is a separate workflow: use the deployment operator's model-onboarding process when that is the requested target. Do not copy private deployment settings or routing information into this skill or an OSS change.

For a documentation-only request, inspect the implemented configuration and follow [Provider documentation](references/documentation.md); do not add runtime code merely to satisfy this checklist.

For a model-only request on an existing provider, follow [model-bank-metadata](../model-bank-metadata/SKILL.md) for `knowledgeCutoff`, `family`, and `generation`, using its single-model guidance rather than the repo-wide sweep. Use the research and focused validation below for other model-card fields, including capabilities, pricing, and context limits. Skip new provider registration, authentication configuration, and provider-list reordering unless the requested model exposes a confirmed gap in those paths.

## Establish the Integration Contract

- Distinguish a new provider from a model added to an existing provider. Record the stable provider ID, display name, model IDs, authentication method, endpoint, and supported API modes. File/export casing may differ from the lowercase provider ID; follow actual consumers.
- Read the official announcement, API reference, model catalog, pricing, and migration notes. Record source URLs and access dates for capabilities, constraints, and pricing. Search for announcements as well as documentation: parameter changes often appear only in release notes. Use a rendered browser when a fetched page is an empty client-rendered shell.
- Verify the endpoint actually being integrated. A model's advertised capabilities do not prove that a compatible endpoint supports its search parameters, tools, images, or structured output. Do not describe a third-party endpoint or its credentials as the provider's official API.
- For local servers or desktop applications, read [Local provider integration](references/local-providers.md). Verify launch modes, installed-model discovery, browser access, and capability refresh separately; an OpenAI-compatible model list alone does not establish these behaviors.
- Compare the latest provider addition and the closest existing implementation by protocol and authentication. Read their diffs, not just file lists. [Integration map and precedents](references/integration-map.md) identifies the registration chain and contrasting examples; historical omissions are not requirements to repeat.
- Set model metadata from evidence: exact IDs, family/generation, context and output limits, release/cutoff dates when known, capabilities, extend parameters, search behavior, pricing currency and units. Distinguish API usage prices from subscription entitlements, cached input from ordinary input, and current promotions from list prices. Mark unknowns rather than inventing values; preserve existing supported models.

## Implement the Provider

Use [Integration map and precedents](references/integration-map.md) while tracing the request from settings through configuration to the runtime.

1. Register the provider ID, provider card, separate model cards, model imports/map/exports, and package subpath export. Keep `chatModels: []` on modern provider cards when the separate model bank is the source of truth.
2. Set a usable static `checkModel` when the provider guarantees that model is available. Otherwise, omit it and let the user select and persist a connection-check model from the fetched local list; do not put an arbitrary example in the card. Set accurate authentication, model-fetching, SDK-family, and browser-request settings. A static model catalog may be correct when the API has no model-list endpoint. Trace consumers of both top-level and nested browser-request flags before relying on one of them.
3. Reuse the appropriate runtime factory or adapter. Register the runtime and its public export. If the provider needs a distinct routed API adapter, wire the RouterRuntime API type and base-runtime map too; provider registration alone does not establish that path.
4. Validate protocol selection separately for streaming chat, non-streaming chat, and structured generation. Responses-only providers may need both chat and `generateObject` configuration, plus protection against a caller selecting an unsupported mode. Map tools, search, response formats, and reasoning only where supported. Never enable a capability solely because a sibling provider does.
5. Add authentication/configuration plumbing appropriate to the provider. For API-key providers, check both environment schema and runtime bindings, then the generic server configuration and runtime initialization. OAuth providers need their authorization, refresh, disconnect, and account-metadata paths instead of invented API-key variables.
6. For a new user-facing parameter, trace the model-card type, stored chat configuration, controls, request resolver, and translations. Prefer existing parameter definitions when their semantics match. If reasoning state must survive multiple turns, test serialization and replay through the real stream/non-stream paths rather than only the initial request.

Keep changes to shared factories or error handlers conditional on an observed gap. The checklist is not a mandate to modify every listed file.

## Branding, Ordering, and Documentation

- Check provider and model icons independently in `@lobehub/icons`: the provider brand and model family can require different artwork. Inspect the actual model-ID matcher, including prefixes, case variants, and collisions with existing model names. When changing a matcher, verify the new IDs and preserve the older family's matches.
- If an icon is missing, identify the missing asset/mapping and prepare an appropriate change or explicit fallback within the authorized scope. Do not silently use an unrelated brand. An external icon PR or release is a separate authorized action; verify that the consumer's installed release contains the intended mapping before claiming the UI is fixed.
- Place the provider deliberately in `DEFAULT_MODEL_PROVIDER_LIST` beside appropriate peers. This array controls default list order; import order and enum order do not. Preserve a user-specified position and existing user-customized ordering. Do not turn one provider addition into an unrelated list reordering.
- Follow [Provider documentation](references/documentation.md) for bilingual usage/setup instructions, environment references, existing Docker configuration, safe examples, and screenshots. Keep the public provider identity and actual credential/endpoint requirements consistent across UI and docs.
- Add `<provider-id>.description` to `locales/en-US/providers.json` and `locales/zh-CN/providers.json` for the provider's description. The default namespace in `packages/locales/src/default/providers.ts` is derived from provider cards; do not duplicate the description there. Follow repository conventions for other new copy and verify fallback behavior. Avoid running a repository-wide translation job for a few provider keys.

## Validate the User Path

Use the existing provider test harness (`packages/model-runtime/src/providerTestUtils.ts`) and focused package tests. Cover the supported behavior rather than asserting that registration strings exist:

- Provider/model lookup resolves the new cards and runtime; connection checking uses a supported model.
- Requests select the intended API mode and endpoint, carry the right authentication, transform supported parameters, and preserve tool calls and structured results. Exercise streaming and non-streaming paths when supported.
- Missing/invalid credentials, failed model fetching, and connection errors produce useful localized messages rather than raw codes or translation keys. Use synthetic HTTP responses for legacy/invalid wire payloads instead of casting them into a stricter current response type.
- Trigger a connection failure and expand its details: the error must remain recoverable within the settings page. A successful connection does not exercise lazy error components or their shared UI contexts.
- The provider settings page and model row display the intended name, icon, capabilities, and default order in light/dark themes. Check English and Chinese where copy changed. Inspect both provider and model icons in the real UI.
- When shared runtime errors or lazy namespaces change, check other affected surfaces such as Workbench. Its separate language bundle may need a namespace even when the main application already loads it.

Run the owning repository's quality command and relevant package tests. For an OSS PR developed inside Cloud, verify the OSS type-check/build context as well: a passing parent type-check does not establish that the standalone OSS configuration passes. Attribute workspace-resolution failures separately; do not remove valid checks to manufacture a pass.

Use the repository's acceptance workflow for authorized live checks. Do not read secret files, put credentials into logs/screenshots, invent screenshots, or claim a successful inference from mocks. If live credentials or access are unavailable, report the precise unverified path and the completed offline checks.

When delivery includes a PR, follow repository commit/PR workflows and monitor CI and deployment for the current head. Attribute failures, fix in-scope issues, validate, push, and continue until checks complete or a concrete blocker is reached. Preserve applicable independent-review gates and human-only merge rules. Report changed behavior, validation, evidence, and remaining limitations.
