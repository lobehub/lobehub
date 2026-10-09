# Agent Share gate: builtin allowlist evidence

Reviewer record for `AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS` (`@lobechat/builtin-tools`). Update it whenever an identifier is added to or kept out of that allowlist.

## Denied builtins

Rationale for every registered builtin identifier that is DENIED — i.e.
absent from `AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS`. Under a denylist an
identifier had to be explicitly proven dangerous to be blocked; under the
allowlist an identifier has to be explicitly proven safe to be exposed, so
this block exists purely to record the evidence trail for reviewers — the
denial itself needs no code beyond "not in the Set".

Confirmed leak paths (a concrete visitor→creator-data route was found):

- `lobe-agent-management`: `agentManagementRuntime` is scoped by `userId`
  (the creator — the run executes as the creator), but `agentId` is a
  free-form model argument on nearly every API. `searchAgent` enumerates the
  creator's whole workspace; `getAgentDetail` returns any creator-owned
  agent's full config (system prompt included) for an arbitrary id;
  `createAgent` / `updateAgent` / `updatePrompt` / `duplicateAgent` /
  `installPlugin` persistently mutate the creator's agent collection.

- `agent-signal-review`: `listManagedSkills` / `getManagedSkill` prefer an
  optional model-supplied `agentId` over the context-bound one, letting a
  visitor read ANY other agent's private managed-skill catalog under the
  same creator. `writeMemory` / `createSkillIfAbsent` /
  `replaceSkillContentCAS` are unconditional creator-scoped mutations, and
  share grants are `none`/`read` only.

- `lobe-skill-maintainer` / `agent-signal-skill-management`: hidden,
  system-only tools whose every API WRITES agent-document rows under the
  creator's account. No write grant exists to honor.

- `lobe-task` / `lobe-goal`: `TaskModel`/`taskRouter` are scoped only by
  `userId`/`workspaceId` — the CREATOR's. Every mutating and single-task-read
  API takes a model-supplied identifier resolved with no topic/conversation
  check, letting a visitor read, edit, delete, reschedule or RUN (spending
  the creator's budget) any task in the workspace. `listTasks`'s `scope:
'allAgents'` makes the breadth explicit.

- `lobe-creds`: `injectCreds` takes a free-form `keys: string[]` and decrypts
  matching entries out of the creator's ENTIRE saved credential store.

- `lobe-message`: every bot-management API resolves `botId` straight from
  model args with no check against `context.agentId`; the messenger APIs act
  on the creator's whole personal messenger account.

- `lobe-skill-store`: the `importFrom*` family fetches attacker-chosen
  remote code/zip content and persists it into the creator's skill catalog.

- `lobe-agent-builder`: `updateConfig`/`updatePrompt` overwrite the shared
  agent's own `systemRole`/config wholesale — a visitor rewriting the
  creator's live agent. `installPlugin` installs an arbitrary market MCP
  plugin onto it as the creator, with no consent step.

- `lobe-brief`: `createBrief` unconditionally persists a row via
  `BriefModel.create` under `context.userId` (the creator) from
  model-supplied content, with no intervention marker to gate it.

- `lobe-group-agent-builder` / `lobe-group-management`: group-orchestration
  tools operating on the creator's group-agent collection and membership,
  with no share-run scoping designed in — same risk class as
  `lobe-agent-management`.

- `lobe-topic-reference`: `topicReferenceRuntime.getTopicContext`
  (`apps/server/src/services/toolExecution/serverRuntimes/topicReference.ts`)
  resolves a free-form model-supplied `topicId` via
  `TopicModel.findOwnTopicById`, scoped only to the creator's `userId` — not
  to this share or agent — letting a visitor's model read the summary or
  recent messages of ANY other topic the creator owns by guessing/enumerating
  ids. `DATA_TOOL_ACCESS_RULES` has no entry for it (it isn't a
  memory/knowledge-base/agent-documents style store), so nothing narrows the
  allowlist grant. The automatic `<refer_topic>` injection path
  (`serverCallLlmContextBuilder.ts`) is separately share-scoped via
  `isTopicVisibleToRun` and is unaffected by this denial — only the
  model-invokable tool-call path is unsafe.

Denied for lack of positive safety evidence (no confirmed exploit was
required to withhold access — the point of default-deny is that an unproven
tool does not ship):

- `lobe-local-system` / `lobe-browser` / `lobe-remote-device`: these proxy
  through `deviceGateway` to the creator's own registered physical
  device(s). A visitor executing arbitrary commands or driving a live
  browser session on the CREATOR's own machine is a far larger blast radius
  than any single data store.

- `lobe-web-onboarding`: reads and WRITES the creator's own onboarding
  `SOUL.md` document and persona.

- `lobe-self-feedback-intent` / `agent-signal-reflection` /
  `agent-signal-feedback-intent`: hidden, system-only self-iteration tools
  whose write paths were never audited for share safety.

- `lobe-page-agent`: not unsafe — genuinely unreachable for a share
  visitor's run (`execAgent` strips it whenever `appContext?.scope !==
'page'`, and the share visitor path never sets `scope`), so allowlisting
  it would only let the owner-facing tool picker confirm a grant no visitor
  conversation can ever exercise.

- `lobe-user-interaction` / `lobe-activator`: originally denied because
  share runs were forced headless, so neither could ever honestly complete.
  Share runs now honor the visitor's approval flow, but both stay denied
  until audited on their own: `lobe-activator` can widen the run's tool
  surface at runtime, which must be proven not to escape the share grant.

- Device-only MCP servers (stdio, or an HTTP endpoint on localhost / a
  private network): not builtin identifiers, so the allowlist above never
  sees them, but a visitor run must still never reach them — the server can
  only call them by tunneling to the creator's online desktop app (or, with
  no device gateway, by spawning the binary on the server itself).
  `applyShareGateToToolSet` drops them regardless of `toolGrants`, and
  `ToolExecutionService.executeMCPTool` refuses the dispatch.

## Allowed builtins with general reach

Positive evidence for builtin identifiers that WERE added to
`AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS` despite reaching outside a single
data store — recorded here, rather than left implicit, because their
general-purpose reach needs an explicit safety argument instead of just the
absence of a known exploit.

- `lobe-cloud-sandbox`: general-purpose shell/script execution, but a share
  visitor's run gets a fresh, isolated per-topic sandbox session — never
  the creator's own sandbox state. The `lh` CLI's JWT credential shim
  (`preprocessLhCommand.ts`) that would otherwise mint a creator-scoped
  token inside a shell the visitor controls is skipped entirely for
  `agentShareVisitor` runs (`serverRuntimes/cloudSandbox.ts`), and
  `lobe-creds` stays denied above so nothing ever writes `~/.creds/env`
  into that session either. No creator credential or JWT is therefore
  reachable from inside a visitor's sandbox command.

- `lobe-skills`: the tool DOES resolve skills out of the creator's personal
  catalog — that is what it is for, and it was denied for exactly that reason
  until the catalog stopped being the unit of authorization. What changed is
  that the creator now names individual skills (`shareConfig.skillGrants`),
  so the reachable set is an explicit allowlist instead of "everything the
  creator owns minus an opt-out `disabledSkillIds` set". Three things make
  that allowlist the real boundary rather than a UI suggestion:

  1. the operation's skill pool is intersected with it at assembly
     (`filterSkillsByShareGate`, applied in `operationPrep`);
  2. `activateSkill` resolves a MODEL-SUPPLIED name, so assembly alone would
     be bypassable — the skill runtime re-checks the allowlist at load time,
     on every path that opens skill content (name/id resolution AND the
     archive/resource loads that `execScript` and `readReference` reach
     through). A name outside the grant fails there even if the model
     invents it;
  3. only `activateSkill` / `readReference` survive at all
     (`AGENT_SHARE_SKILL_API_NAMES`, enforced by the rule above): both are
     pure reads of granted skill content. The exec-class APIs, which are what
     would turn a granted skill into arbitrary code running as the creator,
     stay blocked.

  The grant deliberately carries whatever the granted skill itself does —
  a creator who opens a skill opens that skill's instructions, and that is
  the premise of Agent Share, not a hole in it. The gate's job is to execute
  the grant exactly, not to second-guess which skills a creator should share.
