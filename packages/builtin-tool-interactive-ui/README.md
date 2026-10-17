# Interactive UI (experimental)

An opt-in `lobe-interactive-ui` builtin with one `renderUI` API. The main path is a **native interactive answer**: the model describes bounded components, state and pure calculations; LobeHub renders and links them. It uses the existing agent/tool/message pipeline, not a separate visualization service.

## Try it

1. Use **Agent** mode (Chinese: **智能**) and a tool-capable model.
2. In the chat input, choose **+ → Skills → Add skills… → LobeHub**. Search **Interactive UI** (Chinese: **交互界面**) and **Install**. This experiment is not installed or enabled for every agent by default. Existing accounts may already have it installed.
3. Return to **+ → Skills**. Under **Auto**, find the skill, open its **…** menu and choose **Pin**. It moves to **Pinned**. Pinning makes it available to that agent; there is no separate UI-builder page.
4. Ask for an interactive answer. It appears directly in the conversation when `renderUI` is called. Chat mode and shared-agent visitors do not gain this tool by default.

Example prompt:

> Use the Interactive UI tool to build a native interactive comparison of illustrative monthly plans A = 0.12 × quantity, B = 20 + 0.06 × quantity, C = 50 + 0.03 × quantity. Start at 500. Use a slider and number field, a line chart with the current quantity and intersection markers, selectable plan rows with current prices, and a follow-up proposal containing my selection. Keep chart and input ranges consistent. Do not return a code block.

`examples/native-plan-comparison.json` is a complete deterministic v2 tool-argument fixture: 500 gives 60 / 50 / 65; 1000 gives 120 / 80 / 80. `examples/native-curve-explorer.json` independently composes a quadratic curve with adjustable scale, offset and position. Neither is a hard-coded renderer template. These are controlled model-boundary fixtures, not separate demo products or proof of full-stack acceptance.

## Native contract

Version 2: `{version, title, fallback, state, derived, body}`. The runtime accepts v2 only; the model-facing manifest and prompt no longer advertise HTML/CSS/JavaScript.

- A registry composes **stack, grid, text, metric, slider, number, select, choices, chart and action** nodes from LobeHub primitives. Fonts, spacing, theme, focus and selected states belong to the host. There is no iframe, arbitrary prop spreading, generated markup or generated styling in this path.
- `state` declares finite numbers (required min/max, optional positive step), bounded strings (optional enumerated choices), and booleans. Controls bind to named fields. Multiple controls, prices, choices and charts read the same local state without a model round trip.
- `derived` expressions use scalar literals, exact `state.*`/`derived.*` references and a finite operation set: arithmetic, comparisons, conditional selection, string concatenation and fixed-point number formatting. `x` is only a bounded chart sampling variable. No eval, functions, imports, prototype/property traversal, recursion or general loops are exposed. Unknown references and derived cycles are rejected.
- Components, nesting, expressions, options, strings, state fields, series, samples and total UTF-8 document bytes are bounded. Invalid math produces a missing value rather than NaN/Infinity. Chart discontinuities stay gaps.
- Charts without a live cursor reuse `@lobehub/charts`. Its current API does not expose reference-line/dot hooks, so live-cursor charts use a trusted native SVG component with bounded geometry. Model strings never become SVG markup or attributes. The cursor and intersection dots use exact current values, even between sampled points.
- Streaming shows a quiet native skeleton until a complete validated snapshot is available. Preview controls remain disabled. Incomplete JSON never receives actions or persistence.
- `renderUI` stays outside completed-process/workflow folds, including mixed tool calls. Other process steps still fold. The answer has one title and content surface, without the execution accordion/header or legacy restart/close warning shell.

See `src/native/types.ts`, `schema.ts` and `engine.ts` for the complete contract, and `src/systemRole.ts` for model instructions.

## State and refresh

The full document remains in persisted tool arguments. Result state is `{status:'ready', version:2, values:{...}}`, containing only declared scalar controls; derived values are recomputed.

Host controls autosave through the existing authenticated tool-message state endpoint. Writes are serialized and rapid changes coalesce to the newest snapshot. Acknowledged values restore on refresh/reopening; restoration never sends a message or writes automatically. Unknown or corrupt saved values are discarded/normalized against the document. There is no new database table.

A subtle saving/saved status describes confirmation. Failed saves leave the local selection visible and offer explicit retry. The browser warns before leaving while values are unsaved. Abrupt tab/process termination can still lose unconfirmed changes, and concurrent tabs use last-write-wins; this is not collaborative conflict resolution. Draft follow-up text and send request IDs are not persisted. Read-only surfaces cannot change saved values.

## Follow-ups and permissions

The only action is **propose**: a trusted user click evaluates bounded text and opens a host-owned editable review. A second explicit **Send to this conversation** click sends it. A proposal is frozen until dismissed, even if values change underneath it.

The host rechecks the current writable composer, original conversation key, source tool identity, busy/read-only state and trusted event at send time. A document cannot choose a destination, invoke tools, fetch a URL or grant permissions. The existing conversation action and server authorization preserve composer drafts and add source-tool attribution. In-flight duplicates are suppressed; uncertain sends never replay automatically. This is not persistent cross-device send idempotency. State saves likewise use the source tool message and original conversation, with server creator/permission checks.

## Historical sandbox compatibility

Existing version-1 artifacts still reopen through the isolated legacy renderer; new tool execution rejects version 1. The legacy source has the original opaque-origin iframe + Worker, restrictive CSP/DOM sanitizer, bounded authenticated bridge, explicit host send, watchdog and resource limits. See `src/sandbox/README.md`. Its arbitrary JS state still resets on reopen; native scalar persistence does not migrate old JavaScript memory.

Legacy browser isolation is defense in depth, not a security proof. It does not become the default fallback for a rejected native document: rejection produces a useful plain-text alternative. General browser apps, external resources, network access, canvas, arbitrary host actions and cross-turn patching remain out of scope.

## Inspiration and license

The initial artifact/streaming-preview approach was informed by [CopilotKit/OpenIntelligentUI](https://github.com/CopilotKit/OpenIntelligentUI) (reviewed at [`f6e4388b26a64b9a0714943b08a1ce622b924eec`](https://github.com/CopilotKit/OpenIntelligentUI/tree/f6e4388b26a64b9a0714943b08a1ce622b924eec), [MIT license](https://github.com/CopilotKit/OpenIntelligentUI/blob/f6e4388b26a64b9a0714943b08a1ce622b924eec/LICENSE)). This implementation is original; no upstream source was copied or vendored. Its renderer, CDN policy, CopilotKit/Python/AG-UI stack and Jev routing are not imported. Native v2 is an original host-controlled registry and finite expression interpreter.

## Verification

The Draft PR reports programmatic gates, independent light review and browser/full-stack acceptance separately. Pure formula/geometry tests and isolated renderers do not establish installation/discovery, real tool execution, persisted chat history, actual follow-up authorization or whole-answer layout. Those need the delivered branch's real chat surface. A production debug proxy or an older Vercel head never counts as acceptance for a new revision. Legacy sanitizer tests use jsdom rather than happy-dom.
