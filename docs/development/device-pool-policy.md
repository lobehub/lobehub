# Device pool policies

Device pools collect registered devices and delegate their use permissions to pool
policies. A device can join multiple pools. The device owner must authorize each
membership; the pool creator can edit policy or remove members. This initial version
does not introduce configurable management roles.

## Rollout status

This Labs experiment provides configuration and policy evaluation, but is not yet a complete
security boundary. The following design cases remain open:

- Sandbox CLI credentials currently authenticate as the storage user. A new run or
  direct device RPC can lose its original Bot provenance. Trusted provenance must
  be carried by the credential and enforced at every entry point before rollout.
- TaskRunner does not pass the initiating operation into a Task run. Conversely,
  blindly inheriting a parent context would retain Chat/Bot rules instead of also
  checking Task rules. Task execution needs a verified acting identity and an
  authorization boundary that cannot grow when the trigger changes.
- Personal pools currently select only the owner's Agents and devices. Granting
  a colleague's personal Agent access to one's own device is not implemented.
- This prototype separates personal and workspace devices strictly, including
  removal of the previous workspace Agent's explicit personal-device fallback.
  With Labs disabled, the previous explicit personal-device fallback remains intact.
  The Labs-enabled compatibility change needs resolution before broader rollout.

Configuration UI and Labs on/off behavior have been verified in the real application.
Actual device/Bot/Task execution still needs end-to-end verification after the provenance
gaps above are closed; unit and integration tests do not establish adversarial isolation.

## Storage

| Table                        | Purpose                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `device_pools`               | Creator, personal/workspace scope, name, default permission matrix and hard trigger restrictions |
| `device_pool_devices`        | Unique device registry ID × pool membership                                                      |
| `agent_device_pool_policies` | Unique Agent × pool override matrix                                                              |

The existing `devices.pool_managed` flag records whether pool policies have taken
over authorization. Removing the last membership or deleting its pool must not
restore the previous public-device grant. Rejoining an allowed pool explicitly
restores access. Existing devices retain their prior owner/public Chat and Task
behavior until enrolled; Bot use requires an explicit pool grant.

The additive migration is applied by the existing migration pipeline. The additive schema must land before the application change. The schema rollout is
reviewed separately from the default-off Labs feature.

## Configuration

Personal and workspace device settings separate device registration from the device-pool list.
Pool cards show device counts; opening a card presents Devices, Permissions, and Settings tabs. Settings owns the name and deletion. Name edits save on blur or Enter using a name-only
partial update; permission saves cannot overwrite the name.
The Devices heading always offers a plus action. Empty pools show a My Devices-style hero with a large Add Device button; both open the same picker dialog. Existing rows use a red removal icon; removing membership preserves device registration.
Permissions use an identity selector (Workspace members, Everyone, or a named member) and three explained
entry controls. Identity transitions reuse the panel motion timing, respect elegant/agile/disabled
user settings, and suppress motion under the OS reduced-motion preference. The Bot entry is
labelled Channel in the interface; the persisted trigger key remains `bot`.
Policy cells save immediately through the same save-state indicator as Appearance. Writes
are serialized while controls are pending; rejected edits roll back and expose Retry.
There is no Save policy button, extra fallback control, or hard-limit editor. Legacy
fallback and hard restrictions still participate in evaluation and appear in a warning
when non-default, so editing identity rules never silently removes existing restrictions.

The Agent profile header has a separate Devices route, alongside Profile and
Channels. It lists available pools and opens the Agent-specific identity editor. Overrides
save automatically; Restore synchronization removes the Agent override. Device settings
have no Agent selector, and the profile tools area remains dedicated to tools.

A pool exposes device-owner enrollment and revocation, including membership in multiple
pools, and Chat, Channel, Task rules for Everyone / Workspace member. Only the pool creator
may change pool grants and Agent overrides; using a pool does not grant administration.

The built-in subjects are Workspace members and Everyone, displayed in that order. Named overrides use `user:<id>` keys in the existing JSON rule matrix; no additional table is required. The picker lists current workspace members. Both pool and Agent writes reject users outside the workspace, and runtime matching only adds the verified user key while that user remains a current member. Personal pools do not offer the workspace member picker.

Everyone includes workspace callers
and Bot senders, including unlinked identities. Personal pools omit Workspace member. Subject
matching is separate from the pure evaluator so future roles can be added without
embedding role management in the execution path.

Every cell is Allow, Deny, or Inherit. Evaluation checks:

1. A pool hard trigger restriction.
2. The exact Agent override, in subject order named person → Workspace member → Everyone.
3. Pool rules in the same subject order.
4. The pool fallback.
5. If every layer inherits, the verified device owner receives Chat/Task access; Bot and
   other callers are denied. Pool creation never confers device ownership. Explicit denies
   and hard restrictions override this system default.

This prototype replaces the previous unshipped Me schema. Existing prototype policies with
Me must be explicitly replaced before reuse; the strict schema rejects them at dispatch.
Do not promote Me grants to Everyone during rollout.

Inherit skips a cell. One complete allowed pool path authorizes the device; a denial
in another pool does not cancel it. Rules from different pools are never combined.

## Execution identity

The server writes `devicePoolContext` into operation metadata before dispatch.
It preserves the original Agent, trigger, authenticated actor, and resource scope.
Sub-agent calls carrying a parent operation inherit that context. Task and sandbox
CLI entry points still have the provenance gaps listed above; this is not yet a
guarantee across all descendants.

Interactive calls use the authenticated caller. Entries explicitly identified as execution Tasks use the Task trigger and the
execution service's authenticated principal. The TaskRunner propagation gap above
still needs to be closed before relying on that policy across all task entry points.
Bot callers match Everyone unless account-link routing supplies a verified internal
sender. Messenger routing supplies that mapping; a configured external Bot owner
string alone does not establish an internal user identity. Share visitors remain
blocked by the existing entry restriction.

Discovery and each subsequent dispatch re-read current grants and membership.
Missing operation provenance fails closed at operation-based dispatch. Direct
authenticated device RPCs currently use interactive Chat context and cannot supply
an Agent override or actor identity. Treating sandbox credentials as interactive
authentication is an unresolved gap.
Workspace and personal device scopes stay separate.

## Validation

The evaluator tests cover precedence, inheritance, hard restrictions, and defaults.
Database tests execute real migrations and queries in PGlite, covering ownership,
scope, multi-pool grants, revocation, membership changes, and durable run identity.
Service tests cover gateway filtering and authorization before dispatch. Product
acceptance must separately verify the configuration surfaces and actual Bot/Task
and device entry points; these tests do not establish end-to-end gateway delivery.

## Labs rollout

Device pools is a user-scoped, opt-in Labs experiment (`preference.lab.enableDevicePools`), disabled when absent. Personal and workspace settings and Agent Devices are hidden until enabled; direct Agent routes redirect to Profile and configuration APIs reject disabled callers. Schemas, migrations and saved pool configurations remain available in storage.

The authenticated configuration caller and the server execution principal each use their own persisted opt-in. With Labs disabled, existing device visibility, personal transient discovery, owner/Bot eligibility and bound personal-device compatibility are retained. No pool policies are evaluated on that path. With Labs enabled, discovery and dispatch use pool policies and durable operation provenance. Disabling Labs keeps saved pools and overrides for subsequent re-enablement; Labs is a rollout preference, not a workspace-wide enforcement switch.
