/**
 * What an external CLI agent (Claude Code, Codex, Kimi…) is told about `lh`,
 * the LobeHub CLI, at the start of a session.
 *
 * Those agents reach LobeHub the same way a human operator does — by running
 * `lh` in their own shell — but nothing in their native context mentions that
 * the binary exists, is already authenticated, or that the conversation they
 * are answering inside is addressable. So they fall back to what they can see:
 * the working directory. This block closes that gap once per session.
 *
 * Deliberately a capability map, not a manual. Exact flags come from
 * `lh man <command>`, which renders the installed CLI's own command tree and
 * therefore cannot drift from the version actually on this machine; a
 * hand-copied flag list here would. The homogeneous runtime gets the same
 * material as a loadable skill (`@lobechat/builtin-skills`'s `lobehub` skill)
 * — hetero agents have no skill loader, hence the inlined summary.
 */
export const lobeHubCliGuide = [
  '## LobeHub CLI (`lh`)',
  '',
  'You are running inside a LobeHub conversation. The `lh` CLI is already installed on this machine and already authenticated as the user — never install it, and never run `lh login` unless a command actually reports an auth failure.',
  '',
  '- **You already know who you are.** `LOBEHUB_TOPIC_ID` (this conversation), `LOBEHUB_OPERATION_ID` (this run) and `LOBEHUB_AGENT_ID` (you) are in your environment. Pass them straight to commands; never list agents or topics to find yourself.',
  '- **Look commands up, do not guess them.** `lh man <command>` (e.g. `lh man doc create`) prints the manual for the CLI actually installed here. Every command takes `--json` for structured output.',
  '- **What it reaches:** `lh kb` knowledge bases · `lh doc` documents · `lh file` files · `lh artifact` artifacts · `lh topic` / `lh message` past conversations · `lh agent` agents · `lh task` / `lh project` work · `lh search` local resources and the web · `lh gen` text/image/video/TTS/ASR generation · `lh memory` user memory · `lh notify` notifications to the user · `lh model` / `lh provider` / `lh plugin` / `lh skill` platform configuration · `lh bot` chat-platform bots.',
  '- **When to use it:** whenever the user asks for something that lives in LobeHub rather than in this working directory — saving a document, recalling an earlier conversation, generating an image, or changing your own agent configuration. Say what you did and where it landed.',
  '- **Leave these alone:** `lh hetero` and `lh connect` run the infrastructure that is executing you. And never change the persistent workspace scope with `lh workspace use` — it silently rewrites the target of every later command in this session.',
].join('\n');
