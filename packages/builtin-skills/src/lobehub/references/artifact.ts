const content = `# lh artifact - Publish local HTML and Canvas

## Commands

- \`lh artifact guide canvas\`: read the shared Canvas component and generation rules before authoring a Canvas.
- \`lh artifact publish <file> [--type html|canvas] [--root <dir>] [--title <title>] [--slug <name>] [--new | --deployment <id>] [--json]\`: publish a public artifact.

Ordinary HTML is the default for unbound files and bundles local resources allowed
by --root. Canvas requires --type canvas on its first publish and accepts a
self-contained HTML file with inline CSS, JS and data. Follow the guide; the
server validates Canvas content and injects its runtime. Do not add the runtime
script yourself. Both formats support --slug for a new deployment's readable
prefix; Market appends an eight-character suffix. Updating a deployment keeps
its existing address. JSON publicUrl is the direct hosting address, shareUrl
is the product share page, and subdomainLabel is the actual assigned label.

The existing project .lobehub/artifacts.json remembers the content type, Canvas
identity and deployment. Later publishes of the same path update the same result.
--new creates and rebinds; --deployment targets only this run and keeps the
canonical binding. They cannot be combined. A content type change needs --new.

After failure, retry the same command with the same content and options. The CLI
persists the operation before saving and resumes the saved version before
publishing. Do not delete recovery state or generate a new request ID on a retry.
If input changed while an operation is pending, restore the original first.
If the server explicitly rejects the save (for example invalid HTML or a stale
version), pending state is released: fix the input or inspect the latest version
and retry. Corrupt recovery data is rejected without silently creating a new site.
Canvas JSON failures include the saved canvasId, workId and version when known;
an unsuccessful publish must never be reported as successful. Only a successful
publish returns a publicUrl. A Canvas is also saved as a Work with version history;
it does not require a topic or agent and uses the current authenticated scope.
`;

export const artifact = content;
