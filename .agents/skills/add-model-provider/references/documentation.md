# Provider Documentation

This replaces the former `add-provider-doc` workflow. Use it for a new integration or a documentation-only update. Derive instructions from implemented behavior and verified public sources, not from a generic API-key template.

## Usage Guide

Create or update the corresponding pair:

- `docs/usage/providers/<provider>.mdx`
- `docs/usage/providers/<provider>.zh-CN.mdx`

Use a nearby provider with the same authentication method as the structural example. `docs/usage/providers/fal.mdx` demonstrates the MDX frontmatter, `Image`, and `Steps` components; its image-generation workflow is not a chat-provider template.

Explain:

- Where the user obtains access and which account, API key, subscription, or OAuth login is required, with real public registration/dashboard links.
- How to find the provider in LobeHub, authenticate or enter configuration, choose a supported model, and verify the connection.
- The implemented endpoint and API-mode restrictions that affect setup. Clearly distinguish an official API from a compatible third-party service.
- Relevant availability, billing model, and a link to current authoritative pricing. Do not present subscription access as per-token API billing or copy volatile prices without a source/date.
- Actionable setup errors and limitations that were actually verified.

Use concise positioning and instructions. Do not include internal deployment, private routing, credentials, or implementation details unrelated to user decisions.

## Environment and Deployment

Update applicable entries in both:

- `docs/self-hosting/environment-variables/model-provider.mdx`
- `docs/self-hosting/environment-variables/model-provider.zh-CN.mdx`

Document only variables the implementation consumes. For each, give required/optional status in the supported setup, purpose, safe example, and default or enablement behavior. Common API-key conventions include `ENABLED_<ID>`, `<ID>_API_KEY`, `<ID>_MODEL_LIST`, and `<ID>_PROXY_URL`, but provider-specific endpoint names and authentication methods can differ. OAuth-only providers do not acquire API-key variables merely to fill this list.

Explain model-list syntax only if the provider uses the shared parser; match current examples for add/hide/rename operations. Avoid labeling an API key globally required when UI configuration or another documented authentication path can supply credentials.

Inspect the current `Dockerfile` and any deployment templates that already expose neighboring providers. Extend the applicable environment block without recreating obsolete files: `Dockerfile.database` and `Dockerfile.pglite` were named by the old skill but may not exist in the checkout. Keep Docker entries, runtime configuration, and docs consistent. Add commented placeholders to the safe `.env.example` template where appropriate; never read actual `.env` files.

## Images and Discoverability

- Add a cover or screenshots when they help users complete setup, following neighboring docs. There is no fixed screenshot quota.
- Capture real, current UI with credentials, personal data, and account identifiers removed or hidden before sharing. Use unmistakable placeholders in text examples. Never fabricate dashboard screenshots or claim that a generated image is verification evidence.
- Follow the repository's existing asset workflow; current provider guides use the public CDN `hub-apac-1.lobeobjects.space`. Uploading images to an external host requires authorization for that destination; otherwise keep local reviewable assets and state the remaining publication step.
- Inspect how neighboring provider pages enter navigation or generated indexes and update those sources when required. Do not invent a sidebar file when discovery is automatic.

## Validate

Run `bun run check <changed-document-paths>` using the owning repository's path conventions, and inspect the rendered guide when layout or images change. Check both languages, public links, image references, variable names and setup steps against the implementation. Report unavailable screenshots, credentials or live access as explicit gaps rather than claiming the guide was exercised end to end.
