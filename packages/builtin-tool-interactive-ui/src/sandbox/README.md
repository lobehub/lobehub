# Interactive UI sandbox

## Boundaries

`buildSandboxDocument(source, nonce, mode)` is a browser-only document builder.
Use a fresh random nonce per mounted frame, and mount its result with exactly
`sandbox="allow-scripts"`. Never add `allow-same-origin`, forms, popups, downloads,
or top-navigation privileges. Preview mode includes no executable script.

Generated HTML is parsed into an inert template, sanitized with a fresh DOMPurify
instance, and checked against an HTML-only tag/attribute allowlist. Resource and
navigation elements, event attributes, SVG/MathML, file/password inputs, and
reserved host element names are removed. CSS remains expressive, but CSP blocks
network resources. Closing-tag payloads cannot leave CSS or script string data.

Generated JavaScript **does not run in the iframe's Window**. The trusted nonce
bootstrap creates a Blob worker. That worker first captures its small messaging
capability and removes raw `postMessage` and worker-creation APIs from reachable
global/prototype owners. Only then does it import a separate generated-code Blob.
Never concatenate generated code with the bootstrap: declarations can hoist over
the hardening code. `script-src blob:` permits that local import; external scripts,
network connections and string evaluation remain blocked by inherited CSP.

This worker design avoids granting generated JavaScript a navigable Window.
An `allow-scripts` iframe running arbitrary generated Window code would still be
able to navigate itself; the iframe sandbox/CSP alone is not that boundary.

## Generated-code API

- `lobeUI.on(selector, 'click' | 'input' | 'change', callback)` receives only
  `{ value: string, checked: boolean }` from trusted widget input events.
- `lobeUI.setText(selector, value)` and `setValue(selector, value)` accept bounded
  string, number or boolean values.
- `lobeUI.setStyle(selector, property, value)` supports bounded visual CSS
  properties such as width, height, color, background-color, display and transform.
- `lobeUI.propose(text)` requests host review of a bounded follow-up suggestion.

Selectors are restricted to descendants of the widget root. No HTML insertion,
arbitrary attributes, native DOM objects, host callbacks, conversation history,
credentials or application state are exposed. The host does not inject additional
private data into the frame; generated artifact source is itself untrusted input.

Proposals have no send/tool authority. Validate exact source Window, opaque origin,
mount token, version, type, bounds, sequence and request-ID deduplication, then
require a separate host confirmation. Terminal statuses use a separate fixed-enum
validator and should be localized/rendered outside generated CSS.

## Budgets and limitations

Both sides bound messages before DOM work, and the worker bounds scalar values
before structured cloning. The frame caps selector matches, bindings, updates and
proposals. A responsiveness watchdog stops a stalled worker after roughly five
seconds; every run expires after five minutes and requires an explicit restart.

These are defense-in-depth budgets, not a memory or CPU denial-of-service proof.
Untrusted JavaScript can still allocate within its worker, and adversarial CSS or
selectors can be expensive. The browser's implementation of opaque origins, Blob
worker CSP inheritance and its own security boundaries remains part of the trust
base. Do not put secrets into a widget or treat its content as trusted application
UI. Unsupported Worker/CSP environments must fail closed to the host fallback.

## Verification

The Vitest tests cover pure bridge validation, jsdom sanitization/document parsing,
and a VM simulation of separate script parsing and pre-clone budgets. They do not
prove browser CSP behavior. DOMPurify tests deliberately use jsdom; happy-dom is
not a suitable security model for this sanitizer.

A separate Chromium fixture check must exercise actual opaque iframes/Blob workers:
local control updates, review-only proposals, inert preview, blocked fetch and
external imports/eval, absent Window/document, hoisted declarations, inherited
native-send/Worker access, oversized payloads, flood termination and stalled-worker
termination. Product acceptance additionally needs the real chat tool card,
streaming/reload behavior and host confirmation flow. Firefox/WebKit and Electron
need their own checks; a standalone Chromium fixture is not full-app acceptance.
