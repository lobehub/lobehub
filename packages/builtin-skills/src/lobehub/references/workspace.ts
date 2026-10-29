const content = `# lh workspace - Workspaces and Command Scope

A workspace is a shared team space with its own agents, topics, documents, knowledge
bases, tasks and members. Every \`lh\` command runs against exactly one scope: the
user's **personal** content, or **one workspace**. The same id can exist in one scope
and be "not found" in the other.

## "Workspace" means different things

When the user says "my workspace", work out which one they mean before reading:

| They may mean | Where it lives | How to reach it |
|---------------|----------------|-----------------|
| A team workspace | \`lh workspace\` | \`lh workspace current\` / \`lh workspace list\` |
| Your own documents | Agent documents (the documents tool, or \`lh doc\`) | Default for "my notes / my reports" |
| A task's pinned documents | \`lh task doc\` | Only inside a task run |
| The local working directory | The device shell | Only when a device is connected |

If the request fits more than one row and the first place you check has nothing
matching, say what you checked and ask. Do not report "not found" after looking in one scope.

## Commands

- \`lh workspace current [--json]\` - Show the scope commands run under, and where it came from
- \`lh workspace use <id|slug>\` / \`lh workspace use --personal\` - Switch the saved scope (restore it afterwards, see below)
- \`lh workspace list [--json]\` - List workspaces you belong to (id, name, slug, role, plan)
- \`lh workspace view [workspaceIdOrSlug] [--json]\` - View workspace detail (defaults to the active scope)
- \`lh workspace members [-w <id|slug>] [--json]\` - List workspace members
- \`lh workspace stats [-w <id|slug>] [--mine] [--json]\` - Content statistics (admin or higher; \`--mine\` works for every member)
- \`lh workspace usage [-w <id|slug>] [--since <date>] [--until <date>] [--json]\` - Credit usage for the current billing window
- \`lh workspace settings [-w <id|slug>] [--json]\` - Show the workspace settings blob
- \`lh workspace create <name> -s <slug> [-d <desc>] [--avatar <url|emoji>] [--use]\` - Create a workspace
- \`lh workspace update [-w <id|slug>] [-n <name>] [-s <slug>] [-d <desc>] [--avatar <url|emoji>]\` - Update the profile (admin or higher)
- \`lh workspace invite <email> [-w <id|slug>] [-r admin|member|viewer]\` - Invite a member (admin or higher)
- \`lh workspace invitations [-w <id|slug>]\` - List pending invitations (admin or higher)
- \`lh workspace audit-log [-w <id|slug>] [--action <a>] [--resource-type <t>] [-q <text>] [--start <date>] [--end <date>] [-L <n>]\` - Audit log (admin or higher, Business plan)

\`-w\` only changes which workspace these \`lh workspace\` subcommands read. It does not
change the scope of other modules.
A workspace slug works in place of an id for \`-w\`, \`--workspace\` and the \`view\` argument,
so there is no need to look up the id first. Resolving a slug needs \`workspace:read\`; a
credential without it (such as a workspace-bound API key) must pass the workspace id.

## Scope rules for agent runs

- Your run starts in the scope it was launched from: a workspace run in that workspace,
  a personal run in personal content. \`lh whoami\` or
  \`lh workspace current\` shows which one you are in. Check it first when something you
  expect to exist reports "not found".
- To work in another workspace, switch with \`lh workspace use\` and **always switch back**:
  1. \`lh workspace current\` - note the original scope
  2. \`lh workspace use <id|slug>\` - switch
  3. Do the work, then confirm with \`lh workspace current\`
  4. \`lh workspace use <original>\` (or \`lh workspace use --personal\`) - restore

  The saved scope is shared by every later \`lh\` command on this machine, including the
  user's own. Restore it even when the work fails partway. If \`lh workspace current\`
  does not change after \`use\`, this run's scope is fixed: tell the user instead of retrying.
- \`lh topic view <id> --workspace <id|slug>\` and \`lh topic export <id> --workspace <id|slug>\`
  read one conversation from another workspace without switching.
- Role-gated commands (admin or higher) fail with a permission error for members. Report
  that error as it is. Do not retry with other flags.
`;

export default content;
