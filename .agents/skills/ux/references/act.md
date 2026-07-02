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

An **optimistic mutation** — a create / rename / duplicate that shows its result
immediately, before the server confirms — owes the same done/error honesty. If the write
fails, the caller must **catch and tell the user**; a store action fired without a `.catch`
(or whose only failure handling is a silent rollback + `console.error`) makes the failure
invisible — the user watches their new item appear and then vanish with no idea why, worse
than a plain error because the optimistic UI first _promised_ success. Optimistic ≠
fire-and-forget: the rollback still needs a toast.

A **terminal status screen** (a success / error result page — often an `antd Result`) is
still an action surface: it must carry a way onward. An **error** terminal needs an escape
hatch (retry / back to sign-in / home); a **success** terminal needs a close / go-to-result
affordance. A bare `Result` with no `extra` action strands the user — worst when the page
assumed a popup context (`window.opener`) that isn't there. And any **"auto-closing in Ns"**
copy must be gated on the close actually being able to fire — a countdown that never
triggers is a lie the user waits on.

> ✅ After moving topics: primary = "Go to «target»", secondary = "Done".
> ❌ OAuth terminal screens render an `antd Result` with **no `extra`**: the social-callback
> **error** state has no button (stranded when there's no `window.opener`); the success
> callback shows "Auto-closing in 3s…" that never fires when `window.opener` is null; the
> consent `ClientError` (409 / 400 / network) offers no retry or back-to-sign-in
> (`OAuthCallback/Social.tsx`, `OAuthCallback/Success.tsx`, `OAuthConsent/ClientError.tsx`).
> ✅ Mirror `MarketAuthCallback`: an `extra` **Close** button on the error state, a real
> loading / success / error machine, countdown copy only on the path that auto-closes.
> ❌ The Pages sidebar fires `createNewPage` / `renamePage` / `duplicatePage` as
> fire-and-forget store actions; on failure the store rolls the optimistic item back (or
> only `console.error`s) with **no toast**, so create / rename / duplicate all fail
> invisibly — the new page flashes in and disappears (`AddButton.tsx`,
> `PageLayout/Body/List/Item/Editing.tsx`, `Item/useDropdownMenu.tsx`). ✅ The same editor's
> **Header** duplicate does it right: `try/await/catch` with a success + error `message`.

**Checklist**

- [ ] Action leads forward; doesn't just stop. _(Meaningful)_
- [ ] Optimistic mutation (create / rename / duplicate) surfaces failure — the caller catches and toasts; a silent rollback that just removes the item is fire-and-forget. _(Meaningful・Certainty)_
- [ ] Success = primary "go to result", secondary "Done". _(Meaningful・Natural)_
- [ ] Terminal status screen (success / error `Result`) carries an action: error → escape hatch (retry / back to sign-in), success → close / go-to-result; no bare `Result` without `extra`. _(Meaningful・Certainty)_
- [ ] "Auto-closing / redirecting in Ns" copy only when the close / redirect can actually fire (e.g. `window.opener` present); otherwise show a manual action. _(Certainty)_
- [ ] Bulk ⇄ single-item parity (toolbar action also on the item, and vice versa). _(Certainty)_
- [ ] Bulk / irreversible / async: confirm → in-progress (locked) → done/error, one surface. _(Certainty・Meaningful)_

## 3.2 One primary button, and it's the visually dominant one・Certainty

The single primary CTA tells the user the core action; everything else is secondary /
tertiary. Never a pile of primary buttons competing for attention. Just as important, the
**primary action must be the most prominent element on the surface** — a back / cancel /
secondary action must never carry more visual weight (size, fill, full-width) than the
primary. "Exactly one primary" is not satisfied by merely tinting one button: check the
_rendered_ hierarchy — which control does the eye land on first, and is it the primary
intent? When the biggest button performs a **backward** or secondary action while the real
primary is shrunk into an icon / input-suffix, the weight is inverted and the surface reads
as "the main thing to do here is go back". This is a mechanical-vs-semantic trap (see the
interaction principle): a `variant="filled"` on a tiny control passes a code-level "has a
primary button" check while failing the user.

> ❌ The sign-in **password step**: submit is a tiny `>` chevron tucked inside the
> password input's suffix, while **"返回修改邮箱" (back)** is a full-width `size="large"`
> button — the most prominent affordance on the screen performs the _backward_ action
> (`SignInPasswordStep.tsx`). ✅ Make submit the full-width primary; demote "back" to a
> quiet link / text button.

**Checklist**

- [ ] Exactly one primary button per surface. _(Certainty)_
- [ ] The primary action is the visually dominant control; back / cancel / secondary never out-weighs it (size / fill / width) — verified on the rendered screen, not from `variant` alone. _(Certainty)_

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

A **protective marker** on an entity — a pin / keep / lock / "don't auto-clean" toggle —
is a **promise the user relies on**, so it must be honored by **every** removal path: bulk
close, "clear idle / inactive", auto-cleanup, TTL eviction. A marker that only toggles an
icon and gates nothing is a decorative no-op — a "keep this" that keeps nothing — and it's
actively worse when a bulk action (a "close idle") ignores it and closes the very item the
user pinned. Either wire the marker into all removal predicates, or don't ship the
affordance; a half-wired protection is a broken promise.

> ❌ The Fleet board's column **pin** (`AgentColumn` pin icon, titled "keep this column") only
> toggles `pinnedKeys` and highlights the icon — **no path gates on it**: `syncRunningColumns`
> is append-only and `getIdleColumnKeys` never consults pins, so "close idle columns" closes a
> **pinned-but-idle** column, contradicting the store's own "deliberate keep-this marker"
> comment (`Fleet/idleColumns.ts`, `Fleet/store.ts`). ✅ Exclude `pinnedKeys` from every
> removal predicate, or drop the pin.

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
- [ ] A protective marker (pin / keep / lock) is honored by **every** removal path (bulk close, clear-idle, auto-cleanup) — a marker that gates nothing is a decorative no-op / broken promise. _(Meaningful・Certainty)_

## 3.5 A result that changes the next step needs a persistent state, not just a toast・Meaningful・Certainty

A one-shot toast is an **ephemeral acknowledgement, not a state**. When an async
operation's outcome **changes what the user should do next** — "we emailed you a magic
link / a reset link / a verification email", "sign-in failed, fix your password", "invite
sent, waiting on them" — the result must land in a **persistent surface**: a dedicated
confirmation screen (naming the destination + the next step + a resend / retry), or an
inline message anchored in the flow. A toast that vanishes in \~3s leaves the user staring
at the **unchanged form**, unsure whether anything happened and with no path forward —
especially bad when the next step happens off-app (check your inbox). Keep toasts for
**reversible, no-next-step** acknowledgements ("copied", "saved") where nothing about the
user's next move depends on the message.

> ❌ Sign-in: entering an unregistered-for-password email fires a `message.success`
> ("magic link sent") but **stays on the same email form** with no "check your inbox"
> screen; a wrong password fires a `message.error` toast and leaves the password field with
> no inline error (`SignIn/useSignIn.ts`). ✅ Route to a persistent "We sent a link to
> `x@y.com`" state with resend / change-email; hang the wrong-password error inline on the
> field.

**Checklist**

- [ ] An async result that changes the user's next step lands in a persistent state (dedicated screen or inline), not just a transient toast. _(Meaningful)_
- [ ] "Email / link sent" states name the destination and offer resend / change; failures keep context and offer retry. _(Certainty)_
- [ ] Toast reserved for reversible, no-next-step acknowledgements (copied / saved). _(Natural)_

## 3.6 An identity-bearing action must let the user see _and change_ the acting identity・Certainty・Meaningful

When an action commits **as a specific identity** — authorizing an OAuth app, sending as an
account, publishing to a workspace — showing _which_ identity is not enough; the surface
must also let the user **switch to a different one**. A screen that displays the current
account and offers only Accept / Deny silently assumes the logged-in identity is the right
one. For a user with more than one account this is a real trap: they authorize a third-party
app, or act, **as the wrong identity** and can't tell until after the fact — a trust and
security failure, not a cosmetic one. This is the identity-level form of the Escape Hatch:
the way out isn't "go back", it's "not this account — use another". Mirror the mature
convention (GitHub / Google): _"Signed in as **X** — switch account"_ right next to the
confirm.

> ❌ The OIDC consent / login step shows the current session's avatar + name in a block with
> a single "Continue" primary and **no switch-account / sign-out-and-re-auth** path — once
> you land logged in as X you can only authorize as X (`OAuthConsent/Login.tsx`). ✅ Add a
> "not you? / switch account" affordance that re-authenticates, so the user picks the
> identity they're granting access as.

**Checklist**

- [ ] An action that commits as a specific identity shows the identity **and** a switch-account / re-authenticate path — never lock the user to the currently-logged-in one. _(Certainty・Meaningful)_

## 3.7 Irreversible / high-blast-radius actions need elevated confirmation・Certainty・Meaningful

A plain confirm modal (one danger button) is right for a reversible or scoped delete. It is
**under-protected for an unrecoverable, wide-blast action** — "clear all data", "delete
account", "wipe workspace", "reset everything". Scale the friction to the stakes: for an
action that cannot be undone and destroys a lot, require an **explicit deliberate gesture** —
type the resource name / a confirm token, or tick an "I understand this can't be undone"
checkbox — so it can't fire on a stray click. And because these actions are exactly where a
partial failure is worst, wrap the work in try/catch: a multi-step wipe that rejects halfway
must **report what failed** (not leave half-deleted data behind a silently-cleared modal),
per Feedback §4.2 and §3.1's confirm → in-progress(locked) → done/**error** machine.

> ✅ "Delete account" requires typing the account email before the button enables.
> ❌ Settings **Storage "clear all data"** (agents / files / messages / skills — unrecoverable)
> sits behind a single one-click danger confirm with no type-to-confirm, and `handleClear`
> awaits six store wipes with **no try/catch** (`settings/storage/features/Advanced.tsx`), so a
> partial failure leaves half-deleted data, a still-open modal, and zero feedback.

**Checklist**

- [ ] Unrecoverable / wide-blast action requires an explicit deliberate gesture (type-to-confirm / checkbox), not a one-click danger button. _(Certainty)_
- [ ] The destructive run is wrapped so a partial failure is reported (what failed), never silent half-completion. _(Meaningful・Certainty)_

## 3.8 Secrets are revealed once, stored hashed, masked thereafter・Certainty・Meaningful

A surface that mints a **secret** — an API key, a personal access token, a webhook signing
secret — carries a security-shaped class norm every mature product follows (GitHub / OpenAI /
Stripe / AWS): show the **full value exactly once**, at creation, with a prominent Copy and a
"store it now, you won't see it again" warning; store only a **hash** at rest; and forever
after show a **masked prefix** (`lb-abcd…wxyz`), never the plaintext. The failure mode is
inverting this: persisting the secret reversibly and re-revealing it in a list on demand. That
turns every session (and every DB read) into a plaintext-exfiltration path, and — because the
key stays viewable — hides the missing one-time-reveal screen (the create result feels fine
only because the secret is wrongly re-viewable). The one-time reveal is also a §3.5
persistent-result state, not a toast: the user must be able to copy before dismissing.

> ❌ Settings **API Key**: `ApiKeyModel.query()` decrypts and returns the **full plaintext** on
> every list fetch (`packages/database/src/models/apiKey.ts`), the table masks client-side only
> with an eye-toggle that re-reveals at will, and create just closes the modal (result discarded)
> — no one-time reveal. ✅ Hash at rest; return plaintext only from `createApiKey`; list returns
> a masked prefix; on create, show a persistent reveal panel (full key + Copy + warning).

**Checklist**

- [ ] A minted secret is shown in full exactly once at creation (persistent reveal + Copy + "won't see again"), not a toast. _(Meaningful・Certainty)_
- [ ] Secret stored hashed at rest; list / detail return a masked prefix, never re-reveal plaintext. _(Certainty)_
