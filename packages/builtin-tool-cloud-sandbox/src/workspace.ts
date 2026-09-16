/**
 * Persistent sandbox workspace: the vocabulary LobeHub needs to ASK for one and
 * to tell the model it has one.
 *
 * The cloud sandbox is a per-topic, disposable runtime. A persistent workspace
 * is a directory on a volume mounted into it that outlives the session and is
 * shared across the user's topics. Two independent inputs decide whether a run
 * actually gets one:
 *
 * 1. **Entitlement** — LobeHub resolves the caller's plan into a signed
 *    `sandboxWorkspace` claim (`{ key, quotaBytes }` or none) on the trusted
 *    client token. LobeHub is the sole authority for the key; nothing derives
 *    it from a request body.
 * 2. **Mode** — the run asks for `'persistent'` or `'ephemeral'`. Default is
 *    ephemeral: persistence is an explicit choice per topic, not every task
 *    wants to leave files behind.
 *
 * Only the AND of the two routes to the persistent runtime. Everything after
 * that point — which volume, which mount root, how paths resolve against the
 * directory — belongs to the execution plane, NOT here. This module therefore
 * contains no path handling at all: deriving a directory on this side would
 * reintroduce exactly the combination the routing is built to make impossible,
 * an ephemeral sandbox addressed with persistent-looking absolute paths.
 */

/**
 * Whether a run wants its working directory to survive the session.
 *
 * Positive form on purpose, and ephemeral by default: the safe state is the one
 * you get by saying nothing. A negative flag (`disablePersistent…`) inverts
 * that — a caller that forgets it opts into persistence by accident.
 */
export type SandboxMode = 'ephemeral' | 'persistent';

export const DEFAULT_SANDBOX_MODE: SandboxMode = 'ephemeral';

export interface SandboxWorkspaceScope {
  userId: string;
  /** Organization workspace id when the run is workspace-scoped. */
  workspaceId?: string | null;
}

/**
 * The entitlement itself, as it travels on the trusted-client token. `null` (or
 * absent) is the free-tier shape and means "no persistent workspace".
 */
export interface SandboxWorkspaceClaim {
  /** Directory name inside the volume — see {@link deriveSandboxWorkspaceKey}. */
  key: string;
  /** Soft quota for the directory. The execution plane may cap it further, never raise it. */
  quotaBytes: number;
}

/**
 * Keys the execution plane accepts as a directory name: a word character, then
 * up to 127 more of `[A-Za-z0-9_.-]`. No separators or traversal, no leading
 * dot or dash (which would make a hidden or option-looking directory), bounded
 * length. Kept identical to the receiving end's check — a key that fails it
 * there rejects the whole token, not just the claim.
 */
const SAFE_WORKSPACE_KEY = /^\w[\w.-]{0,127}$/;

const isSafeKeySegment = (value: string): boolean => /^\w[\w.-]*$/.test(value);

/** Distinguishes an organization key from a personal one inside the shared namespace. */
const ORG_KEY_INFIX = 'org-';

/**
 * Derive the workspace key for a principal. An organization workspace shares
 * one directory across its members (`ws-org-<workspaceId>`); a personal run
 * gets `ws-<userId>`. LobeHub is the sole authority for this mapping: the
 * execution plane reads the key off the signed claim and never recomputes it
 * from an identity of its own.
 *
 * Returns `undefined` for an id that is not already a safe path segment, which
 * costs that principal persistence rather than risking the alternative.
 * SANITIZING would be worse than refusing: `user_a/b` and `user_a-b` both
 * reduce to `ws-user_a-b`, and truncating a long id aliases every id sharing
 * its prefix — in both cases two different principals silently land in ONE
 * directory and read each other's files. Every id the platform actually issues
 * (Clerk's `user_<base58>`, workspace ids) is already safe, so this rejects
 * nothing real.
 */
export const deriveSandboxWorkspaceKey = ({
  userId,
  workspaceId,
}: SandboxWorkspaceScope): string | undefined => {
  const segment = workspaceId || userId;
  if (!segment || !isSafeKeySegment(segment)) return undefined;

  // The two shapes share one namespace, so a personal id starting with `org-`
  // would address the organization directory of the same name. No id the
  // platform issues looks like that, which is exactly why it would go unnoticed.
  if (!workspaceId && userId.startsWith(ORG_KEY_INFIX)) return undefined;

  const key = workspaceId ? `ws-${ORG_KEY_INFIX}${workspaceId}` : `ws-${userId}`;
  if (!SAFE_WORKSPACE_KEY.test(key)) return undefined;

  return key;
};

/** Longest `sandboxCwd` worth sending; far past any real directory nesting. */
const MAX_SANDBOX_CWD_LENGTH = 1024;

/**
 * Whether a chosen working directory is safe to send as a relative path.
 *
 * Shared by the picker that writes it and the server that forwards it, so a
 * directory the execution plane would reject is refused at the moment the user
 * picks it rather than on every tool call afterwards.
 *
 * It REJECTS rather than repairs. Collapsing `..` lexically disagrees with the
 * filesystem as soon as a symlink is involved, so a "cleaned" path can resolve
 * somewhere other than where it was judged safe.
 *
 * Interior whitespace is fine — `my notes` is an ordinary directory. Leading or
 * trailing whitespace is not, and not as a matter of taste: the execution plane
 * strips the directory string while the shell `cd` keeps its quotes, so
 * `drafts ` would put the interpreter in `drafts` and the shell in `drafts ` and
 * the session would disagree with itself about where it is. The test is exactly
 * what would be silently rewritten.
 */
export const isSafeSandboxCwd = (value: string): boolean => {
  if (!value || value.length > MAX_SANDBOX_CWD_LENGTH) return false;
  if (value !== value.trim()) return false;
  if (value.startsWith('/') || value.startsWith('~')) return false;

  // Rejects `..` traversal, `.` no-ops, and the empty segments produced by a
  // leading, trailing or doubled slash — none of which come from the picker.
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
};

/**
 * Prompt variables the cloud-sandbox system role consumes:
 * - `sandbox_workspace` fills the `<sandbox_environment>` file-system bullets
 * - `sandbox_session_files` fills the `<session_behavior>` persistence bullet
 *
 * An ephemeral run renders the ORIGINAL wording, byte for byte, so a deployment
 * where persistence is not enabled keeps the exact prompt it had before and
 * never leaks a raw placeholder.
 *
 * The persistent wording carries no absolute path on purpose. The mount root is
 * the execution plane's to choose, the runtime already starts every call inside
 * the workspace (including `executeCode`), and a path spelled out here would be
 * a second source of truth that can only ever drift out of agreement with the
 * first one.
 */
export interface SandboxWorkspacePromptVariables {
  sandbox_session_files: string;
  sandbox_workspace: string;
}

export interface SandboxWorkspacePromptInput {
  /** Chosen subdirectory of the workspace, relative to its root. */
  cwd?: string;
  mode?: SandboxMode;
}

export const formatSandboxWorkspacePromptVariables = ({
  cwd,
  mode = DEFAULT_SANDBOX_MODE,
}: SandboxWorkspacePromptInput = {}): SandboxWorkspacePromptVariables => {
  if (mode !== 'persistent') {
    return {
      sandbox_session_files: '- Files from previous sessions may not persist',
      sandbox_workspace: [
        '- Files created here are temporary and session-specific',
        '- Each conversation topic has its own isolated session',
        '- Sessions may expire after inactivity; files will be recreated if needed',
        '- The sandbox has its own isolated file system starting at the root directory',
      ].join('\n'),
    };
  }

  // With a chosen subdirectory the model is told where it sits relative to the
  // workspace, not where either lives absolutely — the mount root stays the
  // execution plane's business. It is told the root is reachable because it is:
  // the fence keeps the session inside the workspace, not inside the chosen
  // subdirectory, and a model that discovers this by accident is likelier to
  // wander into another topic's files than one that knows the shape.
  const placement = cwd
    ? [
        `- Your working directory is \`${cwd}\`, a subdirectory of a **persistent workspace**: files written there survive session expiry and are still there in your next session.`,
        `- The workspace root is above you. Its other subdirectories belong to this user's other topics — reachable with relative paths, but do not write into them unless the user asks.`,
      ]
    : [
        '- Your working directory is a **persistent workspace**: files written there survive session expiry and are shared with the other conversation topics that use this workspace.',
        '- Keep task-specific work in its own subdirectory so unrelated topics do not overwrite each other, and reuse what is already there when the user refers to earlier work.',
      ];

  return {
    sandbox_session_files:
      '- Files in your working directory persist across sessions; anything written outside it may not',
    sandbox_workspace: [
      ...placement,
      // Deliberately does NOT send installs to `/tmp`. The workspace is network
      // storage — an order of magnitude slower for the thousands of small files
      // a package install writes — but the answer is to let them land where the
      // toolchain normally puts them, not to relocate them somewhere the
      // platform treats as scratch. Naming a directory here would also outlive
      // whatever the platform does with those files later.
      '- The workspace is network storage: fine for source files, results and notes, but slow for the thousands of small files a package install or a build writes. Install packages and build where the toolchain puts things by default, and keep the workspace for what is worth keeping.',
      '- It has a storage quota, which covers what you leave in the workspace.',
    ].join('\n'),
  };
};

/** The `{{sandbox_workspace}}` section alone — see {@link formatSandboxWorkspacePromptVariables}. */
export const formatSandboxWorkspacePrompt = (input?: SandboxWorkspacePromptInput): string =>
  formatSandboxWorkspacePromptVariables(input).sandbox_workspace;
