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
 *    `sandboxStorage` claim (`{ key, quotaBytes }` or none) on the trusted
 *    client token. LobeHub is the sole authority for the key; nothing derives
 *    it from a request body.
 * 2. **Mode** — the run asks for `'drive'`, `'persistent'` or `'ephemeral'`.
 *    Default is ephemeral: persistence is an explicit choice per topic, made by
 *    picking a folder, not every task wants to leave files behind.
 *
 * Only the AND of the two routes to the persistent runtime. Everything after
 * that point — which volume, which mount root, how paths resolve against the
 * directory — belongs to the execution plane, NOT here. This module therefore
 * contains no path handling at all: deriving a directory on this side would
 * reintroduce exactly the combination the routing is built to make impossible,
 * an ephemeral sandbox addressed with persistent-looking absolute paths.
 */

/**
 * Whether a run wants its working directory to survive the session, and how.
 *
 * - `ephemeral` — a throwaway box; nothing survives.
 * - `drive` — a folder on the persistent volume, used as a network drive: the
 *   session works in it and restores or captures nothing else, so any number
 *   of conversations can share one drive at once.
 * - `persistent` — an environment directory (an instance): the folder plus the
 *   packages its build installed, restored and captured with the session.
 *
 * Positive form on purpose, and ephemeral by default: the safe state is the one
 * you get by saying nothing. A negative flag (`disablePersistent…`) inverts
 * that — a caller that forgets it opts into persistence by accident.
 */
export type SandboxMode = 'drive' | 'ephemeral' | 'persistent';

/** Whether a mode keeps its working directory on the persistent volume. */
export const isPersistentSandboxMode = (mode: SandboxMode | undefined): boolean =>
  mode === 'drive' || mode === 'persistent';

/**
 * How a topic names the drive's root as its folder. A choice of its own rather
 * than "no folder", which means the temporary sandbox. Never sent to the
 * execution plane: a drive call without a folder already works at the root.
 */
export const SANDBOX_DRIVE_ROOT = '.';

export const DEFAULT_SANDBOX_MODE: SandboxMode = 'ephemeral';

/**
 * Which of a workspace's two drives a run or a request addresses:
 *
 * - `public` — the workspace's shared drive (`ws-org-<workspaceId>`), which
 *   every member browses and works in;
 * - `personal` — the member's own drive inside the workspace
 *   (`ws-mem-<workspaceId>-<userId>`), which only they can reach.
 *
 * A personal account has one drive (`ws-<userId>`) and ignores this. Both of a
 * workspace's drives draw on the workspace plan's one quota pool.
 */
export type SandboxDrive = 'personal' | 'public';

export const SANDBOX_DRIVES = ['public', 'personal'] as const satisfies readonly SandboxDrive[];

/**
 * The drive a workspace run uses when nothing chose one: the shared drive,
 * which is the only one there was before members had drives of their own — so
 * every topic that picked a folder before then keeps meaning the same folder.
 */
export const DEFAULT_SANDBOX_DRIVE: SandboxDrive = 'public';

export interface SandboxStorageScope {
  /**
   * Which workspace drive; ignored without {@link workspaceId}, defaulting to
   * {@link DEFAULT_SANDBOX_DRIVE}.
   */
  drive?: SandboxDrive;
  userId: string;
  /** Organization workspace id when the run is workspace-scoped. */
  workspaceId?: string | null;
}

/**
 * The entitlement itself, as it travels on the trusted-client token. `null` (or
 * absent) is the free-tier shape and means "no persistent workspace".
 */
export interface SandboxStorageClaim {
  /** Directory name inside the volume — see {@link deriveSandboxStorageKey}. */
  key: string;
  /**
   * Whether this subject may write past {@link quotaBytes} and be billed for
   * what it goes over, the way file storage already works.
   *
   * The decision belongs to LobeHub because only LobeHub knows it: it turns on
   * a plan, a consent, a payment method and a monthly cap. The execution plane
   * knows none of those, so it is told the answer rather than the inputs.
   *
   * Absent means no — an old token, or a deployment that has not adopted this,
   * enforces the quota as a hard limit, which is the behaviour that cannot
   * charge anyone by mistake.
   */
  overageAllowed?: boolean;
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

/** Distinguishes a workspace member's own drive from a personal account's. */
const MEMBER_KEY_INFIX = 'mem-';

/**
 * A workspace id a member key can carry: word characters only, which is every
 * id the platform issues. It is what makes the first `-` after the infix an
 * unambiguous separator — user ids may contain dashes, so a workspace id that
 * did too could split two ways and name another member's drive.
 */
const MEMBER_KEY_WORKSPACE_ID = /^\w+$/;

/**
 * Derive the drive key for a principal:
 *
 * - personal account — `ws-<userId>`;
 * - workspace, public drive — `ws-org-<workspaceId>`, shared by every member;
 * - workspace, personal drive — `ws-mem-<workspaceId>-<userId>`, the member's
 *   own, billed to the workspace's pool like the public one.
 *
 * LobeHub is the sole authority for this mapping: the execution plane reads
 * the key off the signed claim and never recomputes it from an identity of its
 * own.
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
export const deriveSandboxStorageKey = ({
  drive = DEFAULT_SANDBOX_DRIVE,
  userId,
  workspaceId,
}: SandboxStorageScope): string | undefined => {
  if (!userId || !isSafeKeySegment(userId)) return undefined;
  if (workspaceId && !isSafeKeySegment(workspaceId)) return undefined;

  let key: string;
  if (!workspaceId) {
    // The three shapes share one namespace, so a personal id starting with
    // `org-` or `mem-` would address a workspace's drive of the same name. No
    // id the platform issues looks like that, which is exactly why it would go
    // unnoticed.
    if (userId.startsWith(ORG_KEY_INFIX) || userId.startsWith(MEMBER_KEY_INFIX)) return undefined;
    key = `ws-${userId}`;
  } else if (drive === 'personal') {
    if (!MEMBER_KEY_WORKSPACE_ID.test(workspaceId)) return undefined;
    key = `ws-${MEMBER_KEY_INFIX}${workspaceId}-${userId}`;
  } else {
    key = `ws-${ORG_KEY_INFIX}${workspaceId}`;
  }

  if (!SAFE_WORKSPACE_KEY.test(key)) return undefined;

  return key;
};

/**
 * Which drive a key names, from the caller's own point of view: `public` for
 * the workspace's shared drive, `personal` for the caller's own (in a workspace
 * or a personal account), `undefined` for a drive that is neither — another
 * member's, or another workspace's.
 */
export const sandboxDriveOfKey = (
  key: string,
  scope: Omit<SandboxStorageScope, 'drive'>,
): SandboxDrive | undefined => {
  if (!scope.workspaceId) return key === deriveSandboxStorageKey(scope) ? 'personal' : undefined;

  for (const drive of SANDBOX_DRIVES) {
    if (key === deriveSandboxStorageKey({ ...scope, drive })) return drive;
  }

  return undefined;
};

/** Workspace subtree the platform reserves for its own state. */
const RESERVED_WORKSPACE_DIR = '.sandbox';

/**
 * Where a built instance's checkout lives in the sandbox: on the machine's own
 * disk, not the volume, because installs cannot run on the volume. The
 * instance's directory on the volume is this tree's saved copy.
 */
export const SANDBOX_LOCAL_WORK_ROOT = '/root/work';

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
  // The platform keeps its own state inside the workspace (environment
  // snapshots live under `.sandbox/`). Listing APIs hide it, but hiding is not
  // the same as refusing: a working directory pointed here would put an agent
  // inside the store its own environment is restored from, and a delete would
  // take every environment this user has with it. Only the top level is
  // reserved — a `.sandbox` the user made deeper in their own tree is theirs.
  if (value === RESERVED_WORKSPACE_DIR || value.startsWith(`${RESERVED_WORKSPACE_DIR}/`)) {
    return false;
  }

  // Rejects `..` traversal, `.` no-ops, and the empty segments produced by a
  // leading, trailing or doubled slash — none of which come from the picker.
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
};

/**
 * Identifiers the execution plane accepts for a named environment: a leading
 * alphanumeric, then `[A-Za-z0-9._-]`, at most 64 characters.
 *
 * Deliberately stricter than the workspace key's rule, and checked on this side
 * as well as the far one, because of WHERE the far one fails: a session runs to
 * completion and the snapshot is refused at the end, so the work is done and
 * there is nowhere to put it. Refusing at the point the identifier is chosen
 * costs nothing by comparison.
 */
const SAFE_ENVIRONMENT_ID = /^[A-Z0-9][\w.-]{0,63}$/i;

export const isSafeSandboxEnvironmentId = (value: string): boolean =>
  SAFE_ENVIRONMENT_ID.test(value);

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
export interface SandboxStoragePromptVariables {
  sandbox_session_files: string;
  sandbox_workspace: string;
}

export interface SandboxStoragePromptInput {
  /**
   * The folder the run works in, relative to the drive's root; absent on a
   * drive run at the root itself.
   */
  cwd?: string;
  mode?: SandboxMode;
  /**
   * Where commands actually start when that is not {@link cwd}: the checkout
   * on the machine's own disk, for an instance built from a repository. The
   * model is told this one absolutely because it can read it back from `pwd`;
   * describing that session as sitting in `cwd` makes the prompt disagree with
   * the shell, and a model that catches the prompt being wrong goes looking
   * for the "real" directory instead of working where it is.
   */
  workingDir?: string;
}

export const formatSandboxStoragePromptVariables = ({
  cwd,
  mode = DEFAULT_SANDBOX_MODE,
  workingDir,
}: SandboxStoragePromptInput = {}): SandboxStoragePromptVariables => {
  if (!isPersistentSandboxMode(mode)) {
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

  // Where the run is, in the words the user picked it by: a folder on their
  // drive, or an environment directory. The mount root stays the execution
  // plane's business, so neither names an absolute path on the volume.
  //
  // A drive keeps files and nothing else — the machine itself starts fresh
  // every session — so the model is told that installs do not carry over,
  // rather than discovering it when the next session's import fails.
  //
  // A built environment directory runs in its checkout on local disk, which
  // the session saves into the directory on the volume — so persistence is
  // real there too, but through a copy rather than by being the volume. Saying
  // so is what keeps a model from "fixing" the discrepancy it can see between
  // `pwd` and the path it can also see.
  const placement =
    mode === 'drive'
      ? [
          cwd
            ? `- Your working directory is \`${cwd}\`, a folder on the user's **network drive**: files written there survive session expiry, are still there in your next session, and are what the user sees when they browse the drive.`
            : "- Your working directory is the root of the user's **network drive**: files written there survive session expiry, are still there in your next session, and are what the user sees when they browse the drive.",
          cwd
            ? '- Other conversations may use other folders on the same drive at the same time. Keep to this folder unless the user asks otherwise.'
            : '- Other conversations may use the same drive at the same time. Keep task-specific work in its own subfolder so unrelated tasks do not overwrite each other, and reuse what is already there when the user refers to earlier work.',
          '- Only files on the drive persist. The machine itself starts fresh every session: packages you install and anything outside the drive are gone next time, so reinstall what a task needs rather than assuming it is still there.',
        ]
      : workingDir
        ? [
            `- You start in \`${workingDir}\`, this environment's checkout on the machine's own disk. The session saves it continuously into ${cwd ? `\`${cwd}\`, ` : ''}the **environment directory** on the user's drive, so what you leave here is what you find in your next session, and it is what the user sees when they browse the drive.`,
            `- The drive is also mounted, and you may read from it, but that mounted path is the saved copy — not where this session works. Do not move the task there.`,
            '- Packages installed by the environment are restored with it each session.',
          ]
        : [
            `- Your working directory is ${cwd ? `\`${cwd}\`, ` : ''}an **environment directory** on the user's drive: its files and the packages its setup installed survive session expiry and are restored in your next session.`,
            '- Other folders on the drive belong to other work. Do not write into them unless the user asks.',
          ];

  return {
    sandbox_session_files:
      '- Files in your working directory persist across sessions; anything written outside it may not',
    sandbox_workspace: [
      ...placement,
      // A model left to choose freely will sometimes clone or generate into a
      // scratch directory of its own — reasonable in a disposable sandbox,
      // wrong here: the result is thrown away with the session and the user
      // never sees it when browsing the drive, which reads this directory.
      // Said once, positively, rather than as a list of directories to avoid.
      '- Every call starts you in that directory, and it is where the work belongs: checkouts, generated files and notes written anywhere else — `/root`, `/tmp`, a scratch directory of your own — are lost with the session and never appear on the user’s drive. Stay where you start; if a step genuinely needs scratch space, say where you put it.',
      // Deliberately does NOT send installs to `/tmp`. The drive is network
      // storage — an order of magnitude slower for the thousands of small files
      // a package install writes — but the answer is to let them land where the
      // toolchain normally puts them, not to relocate them somewhere the
      // platform treats as scratch.
      '- The drive is network storage: fine for source files, results and notes, but slow for the thousands of small files a package install or a build writes. Install packages and build where the toolchain puts things by default, and keep the drive for what is worth keeping.',
      '- It has a storage quota, which covers what you leave on the drive.',
    ].join('\n'),
  };
};

/** The `{{sandbox_workspace}}` section alone — see {@link formatSandboxStoragePromptVariables}. */
export const formatSandboxStoragePrompt = (input?: SandboxStoragePromptInput): string =>
  formatSandboxStoragePromptVariables(input).sandbox_workspace;
