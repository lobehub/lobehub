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
resurrect on the wrong item.

**Checklist**

- [ ] Draft backed up locally as the user types (localStorage / IndexedDB / store). _(Certainty)_
- [ ] Unsaved draft auto-restored (or offered) on return, not a blank field. _(Meaningful)_
- [ ] Destructive exits (close / navigate / switch) warn or auto-save. _(Certainty)_
- [ ] Failed save keeps the content for retry, never clears it. _(Meaningful)_
- [ ] Draft scoped to its target id so it doesn't bleed across entities. _(Certainty)_
