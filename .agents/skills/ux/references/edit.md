# Edit — entering & changing content

Any surface where the user **types or edits**. Input is expensive effort; the
overriding rule is **never lose it**.

Part of the **ux** skill — see [`../SKILL.md`](../SKILL.md). Each checklist item is
tagged with the design value(s) it serves.

## 2.1 Protect in-progress edits・Certainty・Meaningful

Typed / edited content is real user effort; losing it is one of the most infuriating
outcomes a product can produce. Whenever an editor holds unsaved input, assume the exit
can be **accidental** — a misclick, refresh, crash, navigation, or failed save — and
build a safety net. Back the draft up locally as the user types (localStorage /
IndexedDB / store) so nothing vaporizes it, and auto-restore (or offer to restore) it on
return rather than showing a blank field. Guard destructive exits: closing, navigating,
or switching items away from a dirty editor warns or auto-saves, never silently discards.
Survive a failed save by keeping the content in the field for retry. Scope the draft to
its target (per topic / message / item id) so drafts don't bleed across entities or
resurrect on the wrong item. "Backed up locally" means it survives a **reload** — an
in-memory store alone doesn't count.

> ❌ The home composer holds its input in an in-memory store (no `persist`), so a reload on
> the app's highest-traffic entry point vaporizes a typed task description.
> ✅ The agent chat composer is the model to copy: `useChatInputDraft` backs each topic's input
> to `localStorage` **keyed per context** (`draftKey` = agent+topic+thread), debounced-saves on
> every keystroke and flushes on blur (`ChatInput/InputEditor/index.tsx:570,567`), restores into
> an empty editor on mount (`useChatInputDraft.ts:32-43`), flushes on unmount (`:30`), and
> **removes** the draft on send (`ChatInput/store/action.ts:85`) — durable across reload/crash,
> scoped per topic so drafts never bleed, with 50-entry LRU eviction (`draftStorage.ts:108-126`).
> ❌ **Channel** (`/agent/:aid/channel`) is the **master-detail** form of this trap: the detail
> credential form is an in-memory antd `Form`, and selecting another platform in the list runs
> `form.resetFields()` (`channel/detail/index.tsx:77,245-251`) with **no dirty-guard and no
> persistence** — pasting a bot token + app secret then clicking a sibling platform (or reloading)
> **silently wipes** it. Worst-case content, too: secrets copied from a third-party console, the
> least recreatable input there is. A shared form instance reset on the active-item change is the
> common shape — the switch that _looks_ like navigation-within is a destructive exit for the
> editor. ✅ Warn on a dirty switch/exit, or back the draft to storage keyed by `agentId+platform`.

**Checklist**

- [ ] Draft backed up to durable storage as the user types (localStorage / IndexedDB), surviving a reload — not an in-memory store only. _(Certainty)_
- [ ] Unsaved draft auto-restored (or offered) on return, not a blank field. _(Meaningful)_
- [ ] Destructive exits (close / navigate / switch) warn or auto-save. _(Certainty)_
- [ ] Failed save keeps the content for retry, never clears it. _(Meaningful)_
- [ ] Draft scoped to its target id so it doesn't bleed across entities. _(Certainty)_

## 2.2 Input affordances stay stable & retrievable・Certainty・Natural

The controls _around_ input — placeholder, hints, helper text — are read once and relied
on. Keep them **stable**: a placeholder that rotates on a timer, or that carries content
the user might want back, fails them, because a placeholder is ephemeral (it vanishes the
moment they type) and inert (its text isn't selectable or clickable). Anything the user
might **act on or return to** — a link, an example they want to copy, a tip that matters —
belongs in persistent chrome (helper text below the field, a hint row, a popover), not
smuggled into the placeholder. Rotating "delight" copy in a placeholder is a double miss:
seen-once-can't-retrieve, and any `[label](url)` in it isn't clickable.

> ❌ The home composer pipes a rotating, markdown-linked daily hint into the placeholder —
> the links aren't clickable and a hint the user glimpsed can't be brought back. ✅ Keep a
> stable placeholder; surface the rotating hint as a dismissible row / affordance beside
> the input where its links work.

**Checklist**

- [ ] Placeholder is static — not rotating/animated content the user can't retrieve. _(Certainty)_
- [ ] No clickable / copy-worthy content hidden in a placeholder; it lives in persistent chrome. _(Meaningful)_
