# Computer Use builtin tool

Provides `lobe-computer-use/runCommand` for typed native computer commands on the active desktop device.

## Activation

Computer Use is available on demand through an active desktop device. By default it is not loaded in the initial tool set.
Explicit user pins and tools already activated in the conversation retain their existing behavior.
When a task needs native application controls, mouse/keyboard input, or screen capture,
the agent calls `lobe-activator.activateTools` with `identifiers: ["lobe-computer-use"]`
and a short `reason`. The next model call receives the API schema and operation guidance.
Ordinary conversation, web research, and file or shell work do not need this tool.

Web conversations can activate Computer Use when their execution target is a connected
desktop that reports support. A browser alone cannot execute native commands. Both the
Gateway route and direct Electron client execution retain their existing device gates.
Tool activation does not activate an application or verify a UI operation.

## Usage

Pass CLI arguments after the executable name, for example:

```json
{ "argv": ["invoke", "display.list"], "reasoning": "Find the screen to inspect" }
```

`reasoning` is an optional, brief purpose in the user's language. It is displayed in the
inspector and is never a CLI argument.
The desktop service owns the AUV connection and executes the command over private IPC.
Use `invoke --help` to discover commands. Image artifact paths can be opened with Local System
`readFile`.

The package root exports the manifest and types. The `/client` entry exports the inspector;
`/client/executor` exports desktop execution wiring. The inspector uses the shared command header
and accepts both final and streaming arguments. The enclosing chat header handles execution status. Mouse, keyboard, text, capture,
inspection, help, and dry-run calls get action-specific icons and labels. Active calls use
progress wording; completed and failed calls use neutral action labels, without claiming
that the intended UI effect was verified. Reasoning takes precedence over the command chip;
full argv remains in tool details. Computer Use and image-reading inspectors also
render in collapsed chat rows so their action labels are visible by default.

## When to use

Use Computer Use for native display, application, window, and input operations supported by the active device.
Preview command headers and lifecycle states in the Dev Dock's Render Gallery under Computer Use.

## When not to use

Use Local System for shell commands or file operations. AUV does not accept shell syntax and needs
a desktop client that supports its runtime.

The public identifier is `lobe-computer-use`; the private package and desktop service keep
the AUV backend name. Client, server, and Gateway routing use the new identifier. A read-only inspector
alias preserves historical `lobe-auv` messages; it does not enable old execution requests. Local
System image reads have a separate viewing label, including screenshot artifacts. They
are called images because the read-file result does not identify screenshot provenance.

## Runtime and compatibility

Desktop ships matching `@auv-js/cli` and `@auv-js/sdk` 0.0.16. The existing device
system-info response advertises `supportedTools: ['lobe-computer-use']`; the server
filters discovery/activation and checks again before forwarding a call. Older
Gateway clients omit this field and do not receive Computer Use. Standalone Electron
retains its existing in-process client execution path. Capability-query failures
also disable it. No gateway protocol migration or database migration is required.

`runCommand` returns `{ argv, exitCode, output, stderr? }`. `output` preserves AUV's
parsed JSON, including structured failures and artifacts on nonzero exits; help or
non-JSON diagnostics remain text. Both local and Gateway tool results set `success`
from `exitCode === 0`. Spawn and timeout errors remain host execution errors.
An exit code of zero does not verify the intended UI effect: preserve AUV's
`succeeded`, `verified`, and focus metadata and inspect the resulting application
state when semantic completion matters. The host does not retry input operations.
