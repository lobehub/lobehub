import type { AgentTextBlock } from './types';

/**
 * What an external CLI agent (Claude Code, Codex, Kimi…) is told about `lh`,
 * the LobeHub CLI.
 *
 * Those agents reach LobeHub the same way a human operator does — by running
 * `lh` in their own shell — but nothing in their native context mentions that
 * the binary exists, is already authenticated, or that the conversation they
 * are answering inside is addressable. So they fall back to what they can see:
 * the working directory. This guide closes that gap.
 *
 * It reaches the agent one of two ways:
 *
 * - **As a native skill** (`lobeHubCliSkillDescription` + this body), where the
 *   executing side can load one for the session — see `spawn/lobeHubCliPlugin`.
 *   Only the one-line description stays in context; the body is read when the
 *   request is about LobeHub. Nothing lands in the user's turn or transcript.
 * - **Inside the first user message** (`lobeHubCliGuide`) everywhere else, once
 *   per session — see `isNewSession` in `promptEngine`. That copy is tagged
 *   `LOBEHUB_CLI_GUIDE_CONTEXT`, so an executor that delivers the skill drops it
 *   even when the dispatcher is older or newer than the executor.
 *
 * In the user turn the guide sat in front of the user's real request and read
 * as the task: an agent asked about an unrelated session id opened with
 * `env | grep -i lobehub` and `lh topic list` (lobehub/lobehub#20675). Hence
 * the first bullet scopes when `lh` is relevant at all, and the topic-id shape
 * is spelled out.
 *
 * Deliberately a capability map, not a manual. Exact flags come from
 * `lh man <command>`, which renders the installed CLI's own command tree and
 * therefore cannot drift from the version actually on this machine; a
 * hand-copied flag list here would. The homogeneous runtime gets the same
 * material as `@lobechat/builtin-skills`'s `lobehub` skill.
 *
 * Two things it deliberately does NOT promise, because they are not true on
 * every transport:
 *
 * - **Credentials.** The cloud sandbox is handed a user-scoped JWT, and a
 *   desktop client-mode run inherits the machine's own `lh login`. The
 *   device-dispatch paths (desktop gateway, `lh connect`) put the run's narrow
 *   `hetero-operation` token in `LOBEHUB_JWT`, which `oidcAuth` refuses on every
 *   user-scoped endpoint. `lh topic view` reads through an operation route
 *   instead, as the run's own principal, limited to this conversation and the
 *   ones the user names in it (`topic.getTopicTranscriptOperation`) — so the
 *   most common request needs no other credential. For the rest, `lh` retries
 *   those refusals with the machine's stored login itself when that login is
 *   the same account
 *   (`apps/cli/src/api/operationTokenFallback.ts`), so the guide no longer
 *   teaches the agent to clear the variable — which also borrowed the login of
 *   whoever enrolled a shared workspace device, and was applied to errors it
 *   did not fit.
 * - **`LOBEHUB_AGENT_ID`.** Desktop client mode sets it through
 *   `buildLobeHubSessionEnv`. CLI/Desktop dispatch launchers, including
 *   OpenClaw/Hermes, clear inherited identity and inject the current dispatch's
 *   agent id when supplied; a missing id must not retain the launcher's identity.
 *   Gateway-dispatched `lh hetero exec` runs preserve that id through
 *   `spawnAgent` to the external agent. The credential fallback does not change
 *   authorship. The id is still not guaranteed on every path: `lh task comment`
 *   refuses topic/operation contexts with a missing or blank agent id rather
 *   than attributing Agent output to the user.
 */

/** Tags the in-message copy of the guide; see `AgentTextBlock.context`. */
export const LOBEHUB_CLI_GUIDE_CONTEXT = 'lobehub-cli-guide';

/**
 * When a skill-loading agent should open the guide. It is the only part such an
 * agent keeps in context, so it names the LobeHub-shaped requests and, just as
 * deliberately, says what is not one.
 */
export const lobeHubCliSkillDescription =
  "Reach the user's LobeHub — the app this conversation runs in — through the preinstalled `lh` CLI. Use when the request concerns LobeHub itself: its documents, knowledge bases, files, memory, earlier conversations (topic ids start with `tpc_`, or a `<refer_topic>` tag), agents and your own agent configuration, tasks, projects, widgets, bots, models, providers, plugins or skills, or generating images, video or speech there. Not needed for ordinary work on local files or other tools.";

const lobeHubCliGuideBody = [
  "You are running inside a LobeHub conversation, on a machine where the `lh` CLI is already installed and the run normally carries the user's credentials in its environment — never install it, and never run `lh login`.",
  '',
  '- **When to use it:** only when the user asks for something that lives in LobeHub rather than in this working directory — saving a document, recalling an earlier conversation, generating an image, or changing your own agent configuration. A request about local files, code or another tool does not need `lh`. Say what you did and where it landed.',
  "- **You already know where you are.** `LOBEHUB_TOPIC_ID` (this conversation) and `LOBEHUB_OPERATION_ID` (this run) are in your environment, and `LOBEHUB_AGENT_ID` (you) and `LOBEHUB_WORKSPACE_ID` (the workspace this conversation belongs to, which scopes every `lh` call) are too whenever the run carries them. They are ordinary environment variables, so every sub-shell, script or tool you spawn inherits them. Pass them straight to commands rather than listing agents or topics to find yourself; if the one you need is empty, say so instead of guessing an id. LobeHub topic ids start with `tpc_` — an id in the user's message without that prefix belongs to something else.",
  '- **Earlier conversations:** read one with `lh topic view <id>`. This run can always read its own conversation and the ones the user names in it (a `tpc_…` id or a `<refer_topic>` tag); for any other, ask the user to name it here.',
  '- **Talking to another conversation:** `lh topic send <tpc_id> -c "…"` delivers a message to that conversation and has its agent act on it (queued behind its current turn if it is busy). To hand work to a fresh conversation instead, `lh topic send --new -c "…"` opens one for you (or `--agent-id` another agent), optionally on a given machine with `--device <id|local>` and named with `--title`; `lh message send -c "…"` is the same thing spelled message-first: without `--topic-id` it opens a new conversation, with `--topic-id <tpc_id>` it sends to that one. Prefer these over `lh agent run` for handing off work. `lh message create` only writes a row — nobody sees or answers it. A message another agent sent you starts with an `<agent_sender>` header; answer it with `lh message reply <message_id> -c "…"`, which wakes the sender\'s conversation. Your ordinary response is not delivered to that agent.',
  '- **If `lh` is older than this app**, the shell may have found a stale global install first: `lh man` lacks a command you expect, or `lh` reports an unknown command. When `LOBEHUB_CLI` is set it is the path of the CLI this app ships — run that path instead of `lh` for the rest of the session.',
  '- **Look commands up, do not guess them.** `lh man` lists every command, and `lh man <command>` (e.g. `lh man doc create`) prints the manual for the CLI actually installed here, including exactly which flags that command takes. Many commands offer `--json` for structured output, but not all of them — the manual is what says so, and an invented flag just fails the call.',
  '- **What it reaches:** `lh kb` knowledge bases · `lh doc` documents · `lh file` files · `lh artifact` artifacts · `lh topic` / `lh message` past conversations · `lh agent` agents · `lh task` / `lh project` work · `lh widget` / `lh dashboard` monitoring widgets and dashboards · `lh search` local resources and the web · `lh recall` past messages, topics, goals and pages in a time window · `lh gen` text/image/video/TTS/ASR generation · `lh memory` user memory · `lh notify` notifications to the user · `lh model` / `lh provider` / `lh plugin` / `lh skill` platform configuration · `lh bot` chat-platform bots.',
  "- **Widgets run code with the user's credentials.** Before `lh widget dry-run` of a draft that declares connector credentials (`manifest.env`) or network hosts (`manifest.network.allow`), show the user that version id, what the script does and which credentials and hosts it uses, and wait for their explicit approval of that exact version before passing `--version <id> --yes`. Never publish (`lh widget publish`) without the user's confirmation.",
  '- **If a command fails with an authentication or permission error**, tell the user what you were trying to do — do not work around it.',
  '- **Leave these alone:** `lh hetero` and `lh connect` run the infrastructure that is executing you. And never change the persistent workspace scope with `lh workspace use` — it silently rewrites the target of every later command on this machine.',
].join('\n');

/** The guide as the body of a native skill, under its own title. */
export const lobeHubCliSkillBody = ['# LobeHub CLI (`lh`)', '', lobeHubCliGuideBody].join('\n');

/** The guide as it is attached to the first user message of a session. */
export const lobeHubCliGuide = ['## LobeHub CLI (`lh`)', '', lobeHubCliGuideBody].join('\n');

/** The tagged block `promptEngine` attaches for a new session. */
export const lobeHubCliGuideBlock: AgentTextBlock = {
  context: LOBEHUB_CLI_GUIDE_CONTEXT,
  text: lobeHubCliGuide,
  type: 'text',
};
