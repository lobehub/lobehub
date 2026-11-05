# Expertise Commands

Read and write self-evolving expertise: the domains an agent is bound to, the lessons it learned or was taught, and the rules filed in groups.

**Source**: `apps/cli/src/commands/expertise.ts`
**API**: `apps/server/src/routers/lambda/expertise.ts`

## Concepts

| Term   | Description                                                                  |
| ------ | ---------------------------------------------------------------------------- |
| Domain | A direction of expertise, bound to an agent or to you. A rule group is one   |
| Lesson | One thing learned or taught in a domain                                      |
| Rule   | A lesson as shown in a group. Lessons and rules share ids and the same table |

## Choosing the target

- `--agent <agentId>` or `--slug <slug>` selects an agent through `resolveAgentId`. There is no implicit default agent.
- `--domain <domainId>` selects a domain directly.
- Given both, the domain must be bound to the agent, otherwise the command fails.
- A write that targets a domain needs exactly one. If the agent has several domains, the command fails and lists them.
- Commands that take a lesson id need no agent. The server authorizes the id against the current workspace scope.
- An agent's domains include your own always-on groups, not only the ones mounted on that agent.

---

## `lh expertise domains`

```bash
lh expertise domains --agent <agentId> [--json [fields]]
lh expertise domains --slug <slug>
```

---

## `lh expertise lessons`

```bash
lh expertise lessons list (--agent <id> | --slug <slug> | --domain <id>) [--layer <layer>] [--search <text>] [--json [fields]]
lh expertise lessons view <lessonId> [--json [fields]]
lh expertise lessons teach <text> (--agent <id> | --slug <slug> | --domain <id>)
lh expertise lessons revise <lessonId> <text>
lh expertise lessons retire <lessonId> [--yes]
lh expertise lessons restore <lessonId>
```

- `list` returns active lessons only, ordered by hits within each domain.
- `teach` sends the text unchanged. One text becomes one lesson. The server rejects text over 2000 characters; the CLI does not truncate or split it.
- `revise` stores the text as a new revision. It replaces the lesson's `limits` section, so include anything from an earlier correction you want to keep.
- `retire` keeps the record and its evidence. `restore` undoes it, except for a rule that was merged into another one.

---

## `lh expertise rules`

```bash
lh expertise rules list [--agent <id> | --slug <slug>] [--domain <id>] [--include-retired] [--json [fields]]
lh expertise rules create --title <title> (--agent <id> | --slug <slug> | --domain <id>) [options]
lh expertise rules update <lessonId> [options]
lh expertise rules reorder <lessonId> (--agent <id> | --slug <slug> | --domain <id>) [--before <lessonId>]
lh expertise rules move <lessonId> (--agent <id> | --slug <slug> | --domain <id>)
lh expertise rules merge <fromId> --into <lessonId> [--yes]
```

| Option                            | Commands       | Description                      |
| --------------------------------- | -------------- | -------------------------------- |
| `--title <title>`                 | create, update | The rule title                   |
| `--rule <text>`                   | update         | The rule sentence                |
| `--why <text>`                    | create, update | Why it holds                     |
| `--how <text>`                    | create, update | How to apply it                  |
| `--limits <text>`                 | create, update | Where it stops applying          |
| `--enforcement <enforcement>`     | create, update | `block` or `remind`              |
| `--direction <direction>`         | create, update | `positive` or `negative`         |
| `--compilability <compilability>` | create, update | `compilable` or `not-compilable` |
| `--reason-kind <kind>`            | update         | `mechanism` or `taste`           |

- `list` without a target shows every group in the current scope. `--json` returns an array of groups (`domain`, `owner`, `rules`, `scopes`).
- `update --why ""` clears that section.
- `reorder` moves to the end of the group unless `--before` names an active rule of the same group; any other `--before` fails without writing.
- `move` to a group with a different reach is refused. Only active rules can move. A rule with evidence is copied, so use the id the command prints.
- `merge` retires the source and adds its counts to the target. Both must be active and share the same reach.

---

## `lh expertise ingest-history`

Starts a background workflow that learns from the agent's own past topics. It does not accept external content.

```bash
lh expertise ingest-history --agent <agentId> [--yes]
```

The prompt states how many conversations would be read. With no conversations, nothing is started. An agent with no domains fails, because there is nowhere to file what it learns.
