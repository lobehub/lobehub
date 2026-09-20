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
 *
 * Two things it deliberately does NOT promise, because they are not true on
 * every transport:
 *
 * - **Credentials.** The cloud sandbox is handed a user-scoped JWT, and a
 *   desktop client-mode run inherits the machine's own `lh login`. But the
 *   device-dispatch paths (desktop gateway, `lh connect`) put the run's narrow
 *   `hetero-operation` token in `LOBEHUB_JWT`, and `oidcAuth` rejects that
 *   token on every user-scoped endpoint — so `lh doc`/`lh kb`/… would 401
 *   while the CLI prefers it over the saved login. Until the nested CLI gets
 *   its own user credential there, the guide states the fallback the agent can
 *   apply itself (`env -u LOBEHUB_JWT`) rather than claiming it is signed in.
 * - **`LOBEHUB_AGENT_ID`.** Only the desktop client-mode path sets it
 *   (`buildLobeHubSessionEnv`); `lh hetero exec` re-exports just the operation
 *   and topic ids, and the `lh connect` daemon strips any ambient agent id so a
 *   dispatched run cannot inherit its launcher's identity.
 */
export const lobeHubCliGuide = [
  '## LobeHub CLI (`lh`)',
  '',
  "You are running inside a LobeHub conversation, on a machine where the `lh` CLI is already installed and the run normally carries the user's credentials in its environment — never install it, and never run `lh login`.",
  '',
  '- **You already know where you are.** `LOBEHUB_TOPIC_ID` (this conversation) and `LOBEHUB_OPERATION_ID` (this run) are in your environment, and `LOBEHUB_AGENT_ID` (you) is too whenever the run carries one. They are ordinary environment variables, so every sub-shell, script or tool you spawn inherits them. Pass them straight to commands rather than listing agents or topics to find yourself; if the one you need is empty, say so instead of guessing an id.',
  '- **Look commands up, do not guess them.** `lh man <command>` (e.g. `lh man doc create`) prints the manual for the CLI actually installed here, including exactly which flags that command takes. Many commands offer `--json` for structured output, but not all of them — the manual is what says so, and an invented flag just fails the call.',
  '- **What it reaches:** `lh kb` knowledge bases · `lh doc` documents · `lh file` files · `lh artifact` artifacts · `lh topic` / `lh message` past conversations · `lh agent` agents · `lh task` / `lh project` work · `lh search` local resources and the web · `lh gen` text/image/video/TTS/ASR generation · `lh memory` user memory · `lh notify` notifications to the user · `lh model` / `lh provider` / `lh plugin` / `lh skill` platform configuration · `lh bot` chat-platform bots.',
  '- **When to use it:** whenever the user asks for something that lives in LobeHub rather than in this working directory — saving a document, recalling an earlier conversation, generating an image, or changing your own agent configuration. Say what you did and where it landed.',
  "- **If a command comes back with an authentication or permission error**, retry it once as `env -u LOBEHUB_JWT lh …`: some runs carry a narrow token scoped to this conversation, which shadows the machine's own login. If it still fails, tell the user what you were trying to do — do not work around it.",
  '- **Leave these alone:** `lh hetero` and `lh connect` run the infrastructure that is executing you. And never change the persistent workspace scope with `lh workspace use` — it silently rewrites the target of every later command in this session.',
].join('\n');
