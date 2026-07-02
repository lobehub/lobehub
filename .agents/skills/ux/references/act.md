# Act — operations, flows & buttons

Any surface where the user **performs an action** — a single op, a bulk op, or a
multi-step flow. Covers momentum, focus, and full entity lifecycle.

Part of the **ux** skill — see [`../SKILL.md`](../SKILL.md). Each checklist item is
tagged with the design value(s) it serves.

## 3.1 Flow & momentum・Natural・Meaningful

Every action chain must **push the user forward**, never dead-end or block the flow.
After any operation, lead the user to the next step instead of just stopping. A success
state makes the strong button the forward action ("go to result") and the weak /
secondary button "dismiss" / "Done". Keep bulk ⇄ single-item parity — an action on a
multi-select toolbar must also be reachable on a single item (its context menu), and
vice versa. Bulk / irreversible / async ops run as a modal state machine in one surface:
a confirm step stating exactly what happens → an in-progress view with **dismissal
locked** → a done (or error) view in the same modal. Never fire-and-forget with only a
toast; never leave a dead spinner.

> ✅ After moving topics: primary = "Go to «target»", secondary = "Done".

**Checklist**

- [ ] Action leads forward; doesn't just stop. _(Meaningful)_
- [ ] Success = primary "go to result", secondary "Done". _(Meaningful・Natural)_
- [ ] Bulk ⇄ single-item parity (toolbar action also on the item, and vice versa). _(Certainty)_
- [ ] Bulk / irreversible / async: confirm → in-progress (locked) → done/error, one surface. _(Certainty・Meaningful)_

## 3.2 One primary button per surface・Certainty

The single primary CTA tells the user the core action; everything else is secondary /
tertiary. Never a pile of primary buttons competing for attention.

**Checklist**

- [ ] Exactly one primary button per surface. _(Certainty)_

## 3.3 Pin actions & status outside the scroll region・Certainty・Meaningful

When a surface pairs a **scrollable content area** with action controls (submit / skip /
confirm) or live status (a countdown, save state, error), those controls must live in a
**fixed header / footer outside the scroll region** — never inside the scrolling content
where they slide away. A submit button that scrolls off reads as "there's no way to
proceed"; a countdown that scrolls off hides the deadline the user is racing. Scroll the
content; pin the actions. This is an easy trap because it **only shows up once the content
is tall enough to scroll** — short demo data keeps the footer on-screen and hides the bug.

Concretely: give the surface a fixed footer slot and render the action row into it (e.g.
portal the buttons into the card's footer), so loading a taller body scrolls only the body.
When the same component is embedded in a host that provides **no** fixed footer slot,
render the actions inline as a fallback — pin only when a slot exists.

> ✅ The global approval card pins the ask-user **skip / submit + countdown** in a bordered
> footer; only the question and its options scroll. ❌ The footer living inside the
> `overflow-y: auto` body, so a long option list scrolls the submit button out of view.

**Checklist**

- [ ] Scrollable content + actions/status → actions & status pinned in a fixed header/footer, not inside the scroll area. _(Certainty)_
- [ ] Verified at the tall/overflowing state, not just short demo data. _(Certainty)_
- [ ] Portal into the host's fixed slot when present; fall back to inline when the host has none. _(Meaningful)_

## 3.4 Entity lifecycle completeness・Meaningful・Certainty

The recurring trap: a feature ships only the **display** of a list, but edit / delete /
management are never built — so the user can add something and then be stuck with it. For
every entity a user can see, design its **full lifecycle**: create / read / update /
delete, plus state transitions (enable/disable, connect/disconnect, install/uninstall).
The allowed operation set depends on the entity's source / ownership — decide it
explicitly _before_ building. Each item should expose its allowed ops (hover action /
context menu / detail page) with a clear entry point to add/create; an intentionally-
absent op is a documented decision, not an oversight.

| Entity class                        | Add     | Edit      | Remove             |
| ----------------------------------- | ------- | --------- | ------------------ |
| Official / built-in (skills, tools) | —       | —         | ✗ not removable    |
| Community (installed MCP)           | install | configure | uninstall / remove |
| User-custom (custom connector)      | create  | edit      | delete             |

**Checklist**

- [ ] No display-only features: every listed entity has the CRUD / lifecycle ops that apply. _(Meaningful)_
- [ ] Op set matches source: built-in read-only; installed removable; user-created editable + deletable. _(Certainty)_
- [ ] Each item exposes its allowed ops + a clear add/create entry point. _(Natural)_
- [ ] An intentionally-absent op is documented by design, not an oversight. _(Certainty)_
