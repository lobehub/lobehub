/**
 * Standing rules appended to the system prompt of an external CLI agent that
 * answers a LobeHub conversation (Claude Code `--append-system-prompt`).
 *
 * The `lh` guide (`lobeHubCliGuide`) cannot carry them. As a Claude Code skill
 * only its description stays in context, and that description fires when the
 * user's request is about LobeHub; writing a report or deploying a site is not,
 * so a rule the agent must follow on its own initiative never got read. The
 * system prompt is in context on every turn and is never shown as words the
 * user said.
 *
 * Kept to what applies to every such run, and only appended where it holds:
 * `lh work` resolves the run from its server operation (`resolveAgentWorkRun`),
 * which a desktop-local run does not have, so only `lh hetero exec` launches
 * answering a conversation append it (`spawnAgent`).
 *
 * One line on purpose: it travels as a single command-line argument, and a
 * newline is the first thing a Windows argument quoter mangles.
 */
export const lobeHubSystemPrompt =
  'You are answering inside a LobeHub conversation. When you finish something the user will open afterwards — a report or other document you wrote to a file, a generated file, a deployed site or a published link — register it with the preinstalled `lh` CLI so it shows as a card under your reply: `lh work create --file <path>` for a file (the title defaults to the file name) or `lh work create --url <url> --title <title>` for a link. Register each deliverable once it is final; registering the same file or link again adds a version. Skip scratch and intermediate files, and GitHub or Linear pull requests and issues, which register themselves. `lh man work create` lists the other flags.';
