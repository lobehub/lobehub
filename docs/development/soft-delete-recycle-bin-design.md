# Soft Delete & Recycle Bin

## Summary

Until this change every user-facing delete in LobeHub was a hard `DELETE` that relied on FK
cascades: removing an agent took its sessions, topics, messages, threads and comments with it in
one statement, and the S3 objects behind trashed files were dropped in the same request. Nothing
was recoverable.

This document records the audit of that state, the design chosen for soft delete, and how the
recycle bin (`/settings/trash`) is built on top of it.

The one-line contract:

> A user-facing delete **stamps** `deleted_at` on the row (and the rows its hard delete would have
> cascaded through) and **registers** the root in `trash_items`. Every ownership-scoped read
> filters the stamp out. Restore clears the stamp. The FK cascade and the storage cleanup only run
> at **purge** — on demand from the bin, or from a cron sweep after 30 days.

## 0. Phasing

The mechanism is generic, but it lands one layer — and then one entity — at a time, so each step is
small enough to verify on its own:

| Step | Scope                                                                                              | Where                            |
| ---- | -------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1    | Schema: `trash_items` + `is_deleted` / `deleted_at` on 19 content tables                           | merged (`0152`)                  |
| 2    | Read side: every ownership-scoped read hides stamped rows                                          | `feat/soft-delete-schema`        |
| 3    | **Topics** end to end — stamp, register, restore, purge, sweep — plus the recycle-bin UI           | `feat/trash-topic` (this branch) |
| 4    | Agents (cascading to their topics) and messages (tree rewrite)                                     | `feat/soft-delete-mvp`           |
| 5    | Chat groups, Pages / documents, files, knowledge bases, projects, tasks + goals, generation topics | `feat/soft-delete-recycle-bin`   |

Step 3 is the smallest slice that is useful on its own: deleting a conversation is the most frequent
destructive action in the product, and a topic's cascade is the simplest one (messages and threads
are hidden by their parent and hard-cascade at purge, so nothing below the topic needs a stamp).

While only topics are trashable, a few edges stay deliberately simple:

- `removeTopic({ removeFiles })` no longer deletes attachments at delete time — the flag is
  remembered on the registry row and the still-exclusive attachments are removed when the topic is
  **purged**. Files have no stamp yet, so they stay visible in the meantime.
- The restore path has no parent-in-bin check: a topic's containers (agent, chat group) cannot be
  trashed yet, so they can never be sitting in the bin. The check arrives with the agent handler.
- Bulk "clear conversation" sweeps (`removeMessagesByAssistant/ByGroup`) and every non-topic delete
  remain hard deletes.

## 1. Audit — what deletion looked like before

### 1.1 Existing soft-delete-ish mechanisms (all entity-local, none reusable as a bin)

| Table               | Column(s)                                                         | Semantics                                                                      |
| ------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `agent_documents`   | `deleted_at`, `deleted_by_user_id`, `deleted_by_agent_id`, reason | Full soft delete + restore + purge, exposed only through path-based tool APIs  |
| `topic_comments`    | `deleted_at` (+ `moderated_at` / `moderation_expires_at`)         | Tombstone when replies exist; moderation window is a separate recoverable axis |
| `workspace_members` | `deleted_at`                                                      | Membership tombstone, no restore                                               |
| `projects`          | `archived_at` + `status = 'archived'`                             | Archive, not delete                                                            |
| `notifications`     | `is_archived`                                                     | Archive                                                                        |
| `agent_labels`      | `archived`                                                        | Archive; unique indexes are partial on `archived = false`                      |
| `expertise_*`       | `retired_at` / `status = 'dismissed'`                             | Never hard-deleted                                                             |

Three vocabularies (`deleted_at`, `archived_at`, `retired_at`) with three different read rules. None
of them index across entities, none of them expire, and only `agent_documents` restores.

### 1.2 Hard-delete cascade trees (what a single `DELETE` destroyed)

- **`agents`** — the dangerous node. `topics.agent_id`, `agents_to_sessions`, `agents_files`,
  `agents_knowledge_bases`, `agent_documents`, `chat_groups_agents`, `agent_cron_jobs`,
  `agent_shares`, `messages.agent_id`, … all cascade. `projects.coordinator_agent_id` is the only
  `RESTRICT` in the schema.
- **`sessions`** (legacy 1:1 shell of an agent) — `topics.session_id`, `messages.session_id`,
  `files_to_sessions` cascade. `SessionModel.delete` additionally hard-deletes the orphaned agent.
- **`topics`** — `messages`, `threads`, `message_groups`, `topic_documents`, `topic_shares`,
  `topic_comments`, `task_topics`, eval/history job junctions cascade. `agent_operations`,
  `tasks.current_topic_id`, `works.origin_topic_id` are `SET NULL`.
- **`chat_groups`** — `topics.group_id`, `threads`, `chat_groups_agents` cascade; the model also
  hard-deletes the group-owned virtual member agents (no FK — done in code).
- **`documents`** — `document_histories`, `document_shares`, `document_chunks`, `task_documents`,
  `topic_documents` cascade; `documents.parent_id` self-FK is `SET NULL` (folder delete orphans
  children to root at the DB level — the service layer recursed manually).
- **`files`** — `messages_files`, `knowledge_base_files`, `generations.file_id`, chunk tables
  cascade. `global_files` refcount and S3 deletion are manual, in the router.
- **`knowledge_bases`** — only junctions cascade; the model deletes "exclusive" files (linked to
  this KB only) in code.
- **`projects`** — `project_agents/chat_groups/knowledge_bases` cascade; **`tasks.project_id` and
  `goals.project_id` are `SET NULL`** (tasks survive project deletion). Model also deletes the
  coordinator agent.
- **`tasks`** — `task_dependencies`, `task_documents`, `task_topics`, `briefs`, `task_comments`
  cascade; `tasks.parent_task_id` self-FK is `SET NULL`; `goals` (polymorphic, no FK) and
  `acceptances` are swept in code.
- **`generation_topics`** — `generation_batches` → `generations` cascade; asset URLs collected and
  deleted from S3 in the router.

### 1.3 Delete flow inventory (per entity: model → router → client)

Every entity had a `Model.delete*` (plain `db.delete` + FK cascade), a lambda-router procedure that
ran permission checks (`withScopedPermission('<x>:delete')`, `assertWorkspaceRowManageable`,
`assertCanPerformResourceAction`, non-owner `transferHasForeignRows` gate) and then called the
model, and a client service + store action that awaited it and refreshed. Only `messages`,
`page.removePage`, `file/document.removeDocument` and `task.deleteTask` were optimistic.

External side effects that a restore could never undo, and therefore had to move to purge time:
S3 object deletion (`FileService.deleteFiles`), `global_files` refcount collapse,
`ResourcePermissionModel.removeAll` (sharing grants), IndexedDB message-cache eviction.

### 1.4 Horizontal reads

Rows are read from far more places than their own model: `HomeRepository` (sidebar),
`SearchRepository`, `RecentModel`, `KnowledgeRepo`, `AgentGroupRepository`, usage / memory / expertise
services, and dozens of `db.query.*` joins in services. Almost all of them scope through
`buildWorkspaceWhere(ctx, table)` — 237 call sites at the time of writing. That single funnel is what
made a systemic soft-delete filter feasible.

## 2. Design

### 2.1 Options considered

| Option                                              | Verdict                                                                                                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. `deleted_at` per table only, UNION for the bin   | Filtering works, but the bin needs a UNION over N tables per page, cascades can only be inferred by matching timestamps, and expiry has no single clock.                                                                        |
| B. Central `trash_items` only (move rows to JSON)   | Restore has to re-insert rows across FKs in the right order; every entity needs a serializer/deserializer; children (messages, chunks) would have to be moved too. Far too invasive.                                            |
| **C. `deleted_at` per table + `trash_items` index** | Rows stay in place (restore is one `UPDATE`), FK cascades still do the heavy lifting at purge, and the registry gives the bin a single indexed list, explicit cascade membership (`root_id`), and one expiry clock. **Chosen.** |

### 2.2 Data model

**Source tables** — every user-content table gets the same pair via `softDeleteColumns()` in
`schemas/_helpers.ts`, added up front in one migration even though only phase-1 kinds are trashable
today:

| column       | type                             | role                                                                                                           |
| ------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `is_deleted` | `boolean NOT NULL DEFAULT false` | the flag every ownership-scoped read filters on (`is_deleted = false`); cheap to index, unambiguous in raw SQL |
| `deleted_at` | `timestamptz NULL`               | when the row was trashed; drives the retention clock and the "deleted 3 days ago" copy                         |

The two are written together by `trashStamp()` / `restoreStamp()` (`utils/softDelete.ts`) —
`is_deleted = (deleted_at IS NOT NULL)` is an invariant enforced in code, not by a CHECK (a
CHECK would full-scan `messages` at migration time).

Which tables carry them — the rule is _user-visible content with its own delete action and an
independent lifecycle_:

| Group                                                | Tables                                                                                                                                                                                                            | Reason                                                                                                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat                                                 | `agents`, `session_groups`, `chat_groups`, `topics`, `threads`, `messages`                                                                                                                                        | phase-1 kinds plus their siblings a user deletes one by one                                                                                                              |
| Knowledge / Pages                                    | `documents`, `files`, `knowledge_bases`                                                                                                                                                                           | phase-2 kinds                                                                                                                                                            |
| Work management                                      | `projects`, `tasks`, `goals`, `works`                                                                                                                                                                             | phase-2 kinds; `works` because `deleteTaskWork` is a user action                                                                                                         |
| Generation                                           | `generation_topics`, `generation_batches`, `generations`                                                                                                                                                          | each level is deletable on its own in the image/video UI                                                                                                                 |
| Agent config the user authors                        | `agent_skills`, `agent_cron_jobs`, `user_memories`                                                                                                                                                                | user-created, user-deleted, worth a second chance                                                                                                                        |
| **Deliberately without** (junctions)                 | `agents_to_sessions`, `agents_files`, `chat_groups_agents`, `knowledge_base_files`, `messages_files`, `task_*`, `project_*`, `file_chunks`, `topic_documents`, …                                                  | no lifecycle of their own — they hide with their parent and cascade at purge                                                                                             |
| **Deliberately without** (children)                  | `message_plugins/tts/translates/queries`, `document_histories/shares/chunks`, `chunks/embeddings`, `briefs`, `task_comments`, `verify_*`, `acceptances`, `expertise_*`, `user_memories_*`                         | hidden by their parent; a "restore" never targets them individually                                                                                                      |
| **Deliberately without** (deprecated)                | `sessions`                                                                                                                                                                                                        | legacy 1:1 shell of an agent (`@deprecated`); the agent is the restorable unit — the legacy list hides shells whose agent is in the bin, purge drops them with the agent |
| **Deliberately without** (own rules)                 | `agent_documents`, `topic_comments`, `workspace_members`, `notifications`, `agent_labels`                                                                                                                         | already carry `deleted_at` / `archived` with tombstone or archive semantics that must not change                                                                         |
| **Deliberately without** (config / security / infra) | `api_keys`, `devices`, `user_connectors`, `user_installed_plugins`, `ai_providers/models`, `oidc_*`, `rbac_*`, `auth_*`, `push_tokens`, `resource_permissions`, `*_jobs`, `*_tracing`, `workspace_*`, eval tables | revoke / audit / cache semantics — a hard delete is the right behaviour, and nothing to "restore"                                                                        |

No new indexes: hot list queries already hit `(user_id | workspace_id, …)` indexes and the extra
`is_deleted = false` predicate is a cheap filter on the matched rows; the bin never scans source
tables. Adding `is_deleted … DEFAULT false NOT NULL` is metadata-only in Postgres 11+, so the
migration is instant even on `messages`.

**`trash_items`** (`schemas/trash.ts`):

| column                     | role                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `resource_type/_id`        | polymorphic pointer (`TrashResourceType` in `@lobechat/types`); unique together                  |
| `title`, `meta`            | denormalised display data (avatar, kind, size, `childCount`) so the list renders without joins   |
| `root_id`                  | NULL = the row the user deleted; set = cascaded child. `ON DELETE CASCADE` on the root           |
| `user_id/workspace_id`     | same compat scope as content tables                                                              |
| `deleted_by_user_id`       | actor (differs from `user_id` when an owner tidies a member's rows)                              |
| `deleted_at`, `expires_at` | the stamp shared by the whole cascade, and the purge clock (`deleted_at + TRASH_RETENTION_DAYS`) |

Indexes: `(resource_type, resource_id)` unique; `(user_id, workspace_id, deleted_at) WHERE root_id IS NULL`
for listing; `(expires_at) WHERE root_id IS NULL` for the sweep; `(root_id)`.

### 2.3 Cascade rules — what goes into the bin with what

The soft-delete cascade mirrors the hard-delete cascade **one level down**, and stops where the hard
delete stopped:

| Root              | Stamped + registered as children                                                      | Stamped, not registered (restored by parent key)   | Hidden by parent only (no stamp)                                                                            |
| ----------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `topic`           | — (phase 2: attachments only this topic references, when `removeFiles`)               | —                                                  | messages, threads, comments, topic\_documents                                                               |
| `agent`           | topics (via `agent_id` and via legacy `session_id`)                                   | —                                                  | everything under topics; the legacy `sessions` shell (hidden through the agent join, hard-deleted at purge) |
| `message`         | tool-result companions of a trashed assistant turn                                    | —                                                  | plugins / tts / translate rows                                                                              |
| `chatGroup`       | topics (group + owned virtual member agents)                                          | owned virtual member agents                        | —                                                                                                           |
| `document`        | descendant documents, files anchored under them, the mirror file of a file-backed doc | —                                                  | histories, shares, chunks                                                                                   |
| `file`            | —                                                                                     | BM25 mirror `documents` row (`source_type='file'`) | chunks, embeddings, junctions                                                                               |
| `knowledgeBase`   | files linked to this KB only                                                          | —                                                  | junctions                                                                                                   |
| `project`         | —                                                                                     | coordinator agent                                  | tasks/goals are **not** cascaded (hard delete `SET NULL`)                                                   |
| `task`            | descendants (only for the goal-root delete, `subtree: true`)                          | goals rows carried by the stamped tasks            | briefs, comments, dependencies                                                                              |
| `generationTopic` | —                                                                                     | —                                                  | batches, generations                                                                                        |

Messages are the one kind whose hard delete rewrote the tree (children re-parented onto the nearest
surviving ancestor, active-branch pointer reconciled, topic usage recomputed). The soft delete does
exactly the same rewrite, remembers `{ parentId, childIds }` in `meta.messageTree`, and a restore
splices the row back by re-parenting those children onto it again (best effort — a child that has
since moved is left alone).

Two invariants:

- **A child trashed earlier keeps its own root row.** `register` uses `ON CONFLICT DO NOTHING` for
  children, so a topic deleted last week stays in the bin after its agent (deleted today) is
  restored.
- **A root cannot be restored into a trashed container.** Restoring a topic whose agent/group is in
  the bin, a document/file whose parent folder is in the bin, or a subtask whose parent task is in
  the bin fails with `parentTrashed`; the UI tells the user to restore the container first.

### 2.4 Read-side filtering — one funnel, not 250 patches

`buildWorkspaceWhere(ctx, cols)` now appends `is_deleted = false` whenever `cols.isDeleted` is the
flag of a table in `TRASH_AWARE_TABLES` (matched by table name — the nineteen tables above;
`agent_documents`, `topic_comments`, `workspace_members` never carry `is_deleted` and are therefore
never matched). Passing the whole table object — the dominant style — opts in automatically; the few
explicit `{ userId, workspaceId, visibility }` call sites (agents, chat groups, tasks, goals, works,
session groups …) were given an `isDeleted` entry. Raw-SQL scopes (`TaskModel.ownershipSql`, chat-group member
`EXISTS`) were patched by hand.

Restore / purge internals pass `includeTrashed: true`. Each trash-aware model exposes a `scope()`
(no filter) next to its `ownership()` (filter) so those internals are explicit and greppable.

Consequence to keep in mind: a relational query that reuses another table's predicate
(`db.query.sessionGroups.findMany({ where: sessionsPredicate })`) now fails loudly instead of
silently rebinding — one such case in `SessionModel.queryWithGroups` was fixed.

### 2.5 Server architecture

```
apps/server/src/services/trash/
  index.ts              TrashService — trashXxx() / list / restore / purge / emptyTrash / static sweepExpired
  handlers/<type>.ts    one TrashHandler per TrashResourceType: softDelete cascade, restore, purge (incl. S3, permission grants)
apps/server/src/routers/lambda/trash.ts        list / countByType / restore / purge / emptyTrash
apps/server/src/router-hono/workflows/trash/   POST /api/workflows/trash/purge (QStash schedule)
packages/database/src/models/trash.ts          TrashModel — registry reads/writes, listExpiredRoots, pruneOrphans
```

- `TrashService.trashXxx` runs the handler's stamping and the registry insert **in one
  transaction**, so rows can never end up hidden but unlisted.
- Every user-facing delete procedure in scope (phase 1: `topic.removeTopic`/`batchDelete*`/
  `removeAllTopics`, `agent.removeAgent`, `session.removeSession`, `message.removeMessage(s)` via
  `MessageService`; phase 2 adds `group.deleteGroup`, `document.deleteDocument(s)`,
  `notebook.deleteDocument`, `file.removeFile(s)`, `knowledgeBase.removeKnowledgeBase`,
  `project.delete`, `task.delete`/`deleteGoal`, `generationTopic.deleteTopic`) keeps its permission
  gates and calls the trash service instead of the model. Model `delete*` methods are unchanged and
  still used by internal cleanups and by purge.
- Sharing grants (`resource_permissions`) are kept while a row sits in the bin and removed by the
  purge handler, so a restore is whole.
- Pre-flight guards that protected the hard delete (`AGENT_TRANSFER_IN_PROGRESS`,
  `AGENT_COPY_IN_PROGRESS`, non-owner `transferHasForeignRows`) run before the stamp.
- Purge = model `purge()` / `deleteMany(..., { includeTrashed })` keyed on `scope()`, then
  `FileService.deleteFiles` for storage, then the registry rows. Not transactional across S3 by
  nature; a failing purge leaves the root listed and the sweep retries.
- Sweep (`TrashService.sweepExpired`) walks expired roots across users under each owner's scope,
  then `pruneOrphans` drops registry rows whose resource vanished through a non-trash path.

### 2.6 Permissions

- List: same scope as the content (own rows in personal mode, workspace-wide in team mode).
- Restore / purge / empty: the member who trashed the row or any workspace owner
  (`assertWorkspaceRowManageable` on `deleted_by_user_id`); a non-owner "empty trash" only purges
  their own roots.
- The trash procedures don't need a new RBAC scope: reaching them already required the
  corresponding `<x>:delete` scope at delete time, and the row-level rule above governs the rest.

### 2.7 Client

- `src/services/trash.ts` → `src/store/trash` (`useFetchTrash`, `restore`, `purge`, `emptyTrash`,
  keyset `loadMore`, per-row `loadingIds`). A restore revalidates every mounted SWR key under the
  affected namespaces (`agent:`, `topic:`, `document:`, `file:`, `task:`, …) so lists pick the row up
  without a reload.
- `Settings → System → Trash` (`src/features/Settings/trash`): type filter with counts, `LiteTable`
  (name/avatar, type, deleted-ago, auto-deletes-in, Restore / Delete forever), "Empty trash" with a
  danger confirm, load-more paging. Empty state explains the retention window.
- Delete-confirm copy across topics / agents / pages / tasks / goals / generation topics now says
  "moved to the trash, restorable within 30 days" instead of "cannot be undone".

## 3. Rollout

- Migration `0151_recycle_bin`: `CREATE TABLE IF NOT EXISTS trash_items` + `is_deleted` /
  `deleted_at` on all nineteen tables above (metadata-only, no rewrite). No backfill. Phase 2 needs
  no further schema change — only handlers.
- Register a QStash schedule (e.g. hourly) → `POST /api/workflows/trash/purge`. Until it exists,
  nothing is purged automatically; the bin still works and users can purge manually.
- Retention is `TRASH_RETENTION_DAYS = 30` in `@lobechat/const`.

## 4. Known trade-offs / follow-ups

- **Scope-unique names stay reserved while trashed.** `agents.slug`, `documents.slug`,
  `projects.identifier`, `tasks.identifier` unique indexes are not partial on `deleted_at`, so a
  trashed row still holds its slug. This is what makes restore collision-free; the cost is that a
  user cannot reuse the exact slug of something in the bin. If that becomes a complaint, add
  `AND deleted_at IS NULL` to those partial indexes and resolve collisions on restore (the
  `agent_labels` precedent).
- **`updated_at` bumps on stamp/restore** (`$onUpdate`). Restored rows surface at the top of
  updated-at ordered lists — acceptable, arguably desirable.
- **Message attachments of a trashed file** stay attached (`messages_files` is not filtered) until
  purge, since the storage object is intentionally still there. Restore therefore round-trips
  perfectly; the cost is that a trashed file is still viewable from an old message for up to 30 days.
- **Not routed through the bin (still hard delete):** bulk conversation clears
  (`removeMessagesByAssistant/ByGroup`), threads, session groups
  (folders — deleting one re-parents, never destroys), plugins/skills, API keys, devices,
  notifications, `knowledgeBase.removeAllKnowledgeBases`, `task.clearAll`, transient
  `file.removeUnreferencedFile`, and workspace deletion. Each is either non-content, already
  non-destructive, or a deliberate "wipe" whose semantics shouldn't change silently.
- **Background analytics** (usage, memory extraction, expertise ingestion, nightly review) read
  through the same funnel and therefore skip trashed rows. If a job must see them it should build
  its predicate with `includeTrashed: true` explicitly.
- **Bulk sweeps produce one root per topic**, like a multi-select delete in a file manager. A
  "clear 400 topics" lands 400 rows in the bin; the list is keyset-paged so this is fine, but a
  grouped "batch" root is a possible refinement.
