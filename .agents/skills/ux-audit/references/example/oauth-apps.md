# Worked example — OAuth Apps settings (`/settings/oauth-apps`) audit

A real run of this skill against **Settings → OAuth 应用**, 2026-10 — a developer-console
surface where a user (or workspace admin) registers OAuth clients that sign in with LobeHub:
a list of apps, a create modal (logo / name / type / description), and an app detail page
(basic info, redirect URIs for web apps, credentials + metadata, usage stats, danger zone).
Use it as a template for the output shape, not as current-state truth (the code moves;
re-verify before citing).

**Surface class:** OAuth client registration console — benchmark against **GitHub → Developer
settings → OAuth Apps**, **Google Cloud → Credentials**, **Auth0 / Okta → Applications**.
Class norms: list shows each app's type + status; create asks only for what defines the app
(name, type, logo) and lands on the app page; the app page leads with the **credentials**
(client ID, secret) and the **integration endpoints** (issuer / discovery URL, authorize /
token URLs, or a quickstart link); a new secret is shown once, inline, with Copy; rotation can
be **zero-downtime** (GitHub keeps two secrets alive at once); disable / delete explain that
they break sign-in for every user of the app.

**Layers run:** L1 (static / code) for the audit. L2 started from two user-supplied screenshots
(the create modal; a new web app's page with the secret modal open). L2 + L3 then ran in full
during the fix's acceptance round, on a local stack in zh-CN: every fixed state was rendered,
the list and detail failures were forced by fault injection, and the disable flow was checked
against the database. That pass also surfaced ⑬.

**Load-bearing files:** `routes/(main)/[workspaceSlug]/settings/oauth-apps/index.tsx`,
`features/Settings/oauth-apps/{index, appList, freshSecret, redirectUris, useLogoUpload}.ts(x)`,
`features/Settings/oauth-apps/features/{OAuthApps, CreateAppButton}.tsx`,
`features/{AppItem, AppLogo, CreateAppModal, FreshSecretCard, ClientIdDisplay}`,
`features/AppDetail/{index, BasicInfoCard, RedirectUrisCard, SectionCard}.tsx`.

## 1 — Patterns in use

| Pattern (family)                      | Where                                                                          | Rating  | Note                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------- |
| Overview + Detail (data)              | list row → `/settings/oauth-apps/:id` (`OAuthApps.tsx`)                        | ✅      | deep-linkable detail, back returns to list                    |
| Modal Panel (nav)                     | create modal (`CreateAppModal/index.tsx`)                                      | ✅ 亮点 | mask-dismiss locks once dirty (`Content.tsx:150,155`)         |
| Illustrated Choices (input)           | app-type cards with icon + desc (`Content.tsx` `TypeSelect`)                   | ✅      | immutability stated at choice time (`Content.tsx:220-221`)    |
| Same-Page / Inline Errors (input)     | redirect URI row + list validation (`RedirectUrisCard.tsx`, `redirectUris.ts`) | ✅ 亮点 | rules shared with the server via `@lobechat/utils/oauthApp`   |
| Titled Sections (layout)              | `SectionCard` basic info / redirect URIs                                       | ✅      | read-only until **Edit**, explicit Save / Cancel              |
| Empty state as next step (onboarding) | redirect URIs "not configured" + **Configure** (`RedirectUrisCard.tsx:93,183`) | ✅ 亮点 | the label switches from Edit to Configure when nothing is set |
| One-time reveal (commands)            | client secret — **was** a modal, now `FreshSecretCard`                         | ⚠️ → ✅ | gap ③                                                         |
| Empty state — list (onboarding)       | `OAuthApps.tsx`                                                                | ⚠️ → ✅ | was bare text, no CTA (gap ⑥)                                 |
| Failure + Retry (feedback)            | list fetch, detail fetch                                                       | — → ✅  | both were missing (gaps ①⑤)                                   |
| Smart Defaults (input)                | type defaults to CLI / device (`Content.tsx` `initialValues`)                  | ✅      | the most common case for this audience                        |
| Corner treatments / identity (visual) | app logo fallback                                                              | ⚠️ → ✅ | letter avatars of the name / a label (gap ④, L2)              |
| Integration endpoints (class norm)    | app detail                                                                     | — → ✅  | issuer / discovery / endpoints card (gap ⑦)                   |

**Read:** the surface is **thoughtful in its forms** — what to ask up front, what to defer,
validation that mirrors the server, a modal that won't eat a half-typed app. Its weak spots
were the usual **Feedback / Read** ones (failures that look like "empty", a silent bounce) plus
two **visual-identity** misses the code could not show but the screenshots did (the logo
fallback, the secret modal stacked on the page). The one class-norm gap left open is
**getting from "app created" to "app integrated"**: the page never says where to send users.

## 2 — Strengths / good cases (don't regress)

- **✅ 亮点 — Create modal protects its draft.** Once any value changes, a mask click no longer
  dismisses the modal; ✕ / Esc still close it (`CreateAppModal/Content.tsx:150,155,165`). A
  half-typed app can't vanish on a stray click outside — Edit §2.1 done with one line.
- **✅ 亮点 — Ask only what defines the app; defer the rest to a real next step.** Redirect URIs
  are not in the create form. The app page shows a "not configured yet" warning and the card's
  button reads **Configure** instead of Edit (`RedirectUrisCard.tsx:93,183`). The type _is_
  asked up front because it decides whether a secret exists, and the form says it can't change
  later (`Content.tsx:220-221`). This is the right split between progressive disclosure and an
  irreversible choice.
- **✅ 亮点 — Validation shared with the server.** `redirectUris.ts` maps the same
  `validateRedirectUri` the server uses to row-level messages, with a separate list-level rule
  (at least one, at most the cap). Client and server can't disagree about what's valid.
- **✅ 亮点 — Only a touched logo is sent.** `BasicInfoCard.tsx:43,73` sends `logoUri` only when the
  user changed it, so renaming an older app whose inline `data:` logo the server now rejects
  doesn't fail on a field nobody touched. `useLogoUpload` uploads to storage because the OIDC
  provider rejects `data:` URIs — both are load-bearing correctness choices.
- **Rotation confirmation names the blast radius** ("deployments still using it will fail to
  sign users in"), and the secret is masked forever after (`secret.hidden`) — Act §3.8.
- **Edit forms reset on each Edit**, so Cancel needs no cleanup and a stale half-edit never
  reappears (`BasicInfoCard.tsx` `startEditing`).
- **Permission-gated Create with a reason tooltip** (`CreateAppButton.tsx:39`), matching the
  server's Admin-or-higher rule for workspace apps.

## 3 — Experience gaps (ranked)

**① List fetch failure rendered as "No OAuth apps yet" — Read §1.1, Feedback §4.2** 🔴 _fixed_
`OAuthApps.tsx` read only `{ data, isLoading }`; on error `!apps?.length` showed the empty copy
— a failed load posing as "you have none", with no retry. Now `resolveAppListState`
(`appList.ts`) returns `error` when nothing is cached, rendered as `AsyncError` + Retry; a
cached list survives a failed revalidation. Regression test: `appList.test.ts`.

**② Every list row said "Device Flow", including web apps — Read §1.12** 🟠 _fixed_
`AppItem.tsx` hard-coded `t('oauthApp.type.deviceFlow')` in the meta line, so a web app read as
a device app. Now `appTypeLabelKey(app.applicationType)` uses the same names as the create
form ("CLI / Device" / "Web App"). Regression test: `appList.test.ts`.

**③ New secret revealed in a modal over the page the user just landed on — Act §3.8** 🟠 _fixed_ (L2)
Creating a web app navigated to its page, then opened "Your client secret" as a modal on top
(screenshot). It blocked the page the secret belongs to, ✕ destroyed the only copy with no
confirmation, and its copy said "before closing". Now `FreshSecretCard` renders inline at the
top of the app page with Copy + "I've saved it"; the warning says "once you leave this page".
The create flow hands the plaintext over through an in-memory one-shot (`freshSecret.ts`), not
router state. Rotation uses the same card. → landed as ux Act §3.8.

**④ Logo fallback rendered a label or the name as giant glyphs — Read §1.14 (new)** 🟠 _fixed_ (L2)
The create modal passed the **name field's label** as the uploader's `title`, so the empty logo
showed "名称" as two oversized glyphs (screenshot). The detail header showed a 72px "LO"
monogram, and the list fed `app.logoUri || app.name` into `Avatar`. Now one `AppLogoPlaceholder`
(app-window glyph) is used by the list, the detail header and — with a dashed outline — both
logo uploaders. The create and edit forms put the logo beside the name instead of on a row of
its own. → landed as ux Read §1.14.

**⑤ Detail load failure silently bounced back to the list — Feedback §4.2** 🟠 _fixed_
`AppDetail` called `onBack()` on **any** error, so a network blip looked like the app had
vanished. Now only a settled "not found" goes back. An error renders `AsyncError` (page) with
**Back to list**, plus **Retry** when the error is retryable.

**⑥ Empty list was a line of grey text with no CTA — Read §1.1** 🟠 _fixed_
Now `Empty` with the app glyph, the existing copy, and the **Create App** button (extracted to
`CreateAppButton.tsx` so header and empty state share the permission logic).

**⑦ No path from "created" to "integrated" — Grow §5.3, Act §3.1** 🟠 _fixed_
The app page showed the client ID (and the secret once) but never the **issuer, discovery URL or
endpoints**, so a developer had to find them elsewhere. Every comparable console puts these
beside the credentials. Now an **Integration** card (`AppDetail/IntegrationCard.tsx`) lists the
issuer, discovery URL, the flow's own first endpoint (authorization for web, device
authorization for CLI / device) and the token endpoint, each copyable. The paths come from
`libs/oidc-provider/routes.ts`, which the provider configuration now uses too, so the page can't
drift from the routes. On desktop the origin is the connected server, not the renderer.
Regression test: `integrationEndpoints.test.ts`.

**⑧ Rotation is break-then-fix, single secret — class norm** 🟡 _open: needs a server change_
Rotation invalidates the old secret immediately (the confirmation says so). GitHub lets two
client secrets coexist so a deployment can switch before the old one is revoked. Fixing it needs
a second secret column (a migration), the adapter returning both, client authentication accepting
either (oidc-provider compares a single `client_secret`), and a "revoke previous secret" action.
That is an auth-layer change with its own rollout, so it is left out of this UI pass.

**⑨ Disable had no confirmation or consequence copy — Act §3.4** 🟡 _fixed_
The detail **Enabled** switch and the list menu's **Disable** fired immediately, yet disabling
makes the provider treat the client as unknown: sign-ins and token refreshes fail for every user.
Rotation was confirmed; disabling, the wider blast radius, was not. Now both paths go through
`confirmDisableOAuthApp` with the consequence spelled out. A disabled app shows a warning banner
with **Enable** at the top of its page, and the action lives in the danger zone with a description.

**⑩ Credentials, metadata and a state toggle shared one card — principle "Layout communicates role"** 🟡 _fixed_
Client ID / type / secret, created / last used, and the **Enabled** switch were rows in one card
below the redirect URIs. Now: a **Credentials** card right after basic info; created / last used
as a quiet line under the title; enable / disable and delete as described rows in the danger zone.

**⑪ Two warning-coloured blocks stacked on a brand-new web app — principle "Review messages in page context"** 🟡 _fixed_
The one-time secret card and the "no redirect URIs yet" alert were both yellow. Only the secret is
action-blocking right now; the redirect URI is the next setup step. The empty redirect state is
now a neutral dashed block with an **Add redirect URI** primary button.

**⑫ Small consistency misses** 🟡 _fixed_
Detail timestamps used `toLocaleString()` while the list used "last used 3 days ago"; both are
now relative. The back button was a hand-rolled `span` with its own hover CSS; it is now an
`ActionIcon`.

**⑬ Found while verifying on the render (L2)** 🟡 _fixed_
Four things the code read did not show. The empty state's Create button was a second primary
next to the header's, so it is now secondary. The confirm dialogs (disable, delete, rotate) showed
an English "Cancel" because `confirmModal` was called without `cancelText`. The open-source build's
usage-stats stub renders nothing, which left an empty bordered card, now hidden with `:empty`.
The secret card printed the backticks around `client_secret` literally, so the parameter now
renders as inline code.

**⑭ Owner review of the first acceptance round** _fixed_
The owner rejected three checks, and each rejection corrected the audit itself, not just the
fix:

- **③ was only half right.** Moving the secret from a modal to a yellow inline card fixed where
  it showed, not when it was minted. A web app's secret should not exist until the owner asks
  for it. Web apps are now created without a secret. The Credentials row offers **Generate
  secret**, reveals the value once in place in neutral styling, then shows it masked with
  **Rotate**. The OIDC adapter treats a secret-less web client as not found. → refined ux Act §3.8.
- **⑥'s empty state** was still inside the list's bordered frame, titled "No OAuth apps yet" and
  sharing the screen with the header's Create. It is now unframed, its title states the outcome
  ("Create your first OAuth app"), and it owns the single primary Create while the header hides
  its own. → ux Read §1.1.
- **④'s upload placeholder** had a filled background. An upload slot is now outline-only. The
  type cards also lost the 32px right gutter that had been reserved for the check mark, which
  wrapped the description early; the check now sits in the title row.

**⑮ Owner review of the second round** _fixed_

- **The reveal surface.** The in-row reveal was rejected. The owner wants a focused modal, but
  only as the response to their own Generate / Rotate click, with neutral styling instead of the
  first version's yellow alert. → ux Act §3.8 rewritten.
- **Detail page structure.** Three tabs: Basic Info / Credentials / Advanced, with the danger
  zone under Advanced and the tab in `?tab=`. The disabled banner now heads the page above the
  title. Integration leads with a **one-prompt integration**: a ready-to-paste instruction for a
  coding agent, filled with this app's client ID and endpoints. The raw URLs follow as
  "Manual setup".
- **List rows.** The client ID no longer shows in the row (it belongs on the app page). Type and
  last-used moved right, before the ⋮ menu. The chevron was removed.
- **Fills.** The selected type card loses its fill and keeps only the border. The edit form uses
  `filled` inputs.

**⑯ Owner review of the third round** _fixed_

- The landing tab is **Overview**: basic info plus the integration (one-prompt + manual setup)
  and usage stats. The Credentials tab keeps the client ID / secret and the redirect URIs.
- Advanced splits the reversible from the irreversible. Enable / disable is a plain **Status**
  section; only Delete stays in the danger zone.

## 4 — Skill feedback

- **New rule landed — Read §1.14** (gap ④): an entity with no image falls back to a shared
  **type glyph**, never a letter avatar of its name (CJK renders two oversized glyphs), and never
  a UI label passed as `title`. The same glyph is used on every surface; upload slots add only a
  dashed outline. Mirrored into the Quick review.
- **Rule refined — Act §3.8** (gap ③): the one-time reveal now says **where** it lives. When
  creation lands on the entity's page, show it inline there (dismissed by "I've saved it" or by
  leaving), not as a modal over the page. The warning names the real boundary. The plaintext is
  handed over through memory only, never router state. Quick-review cue updated.
- **Existing rules, new instances (no rule change):** Read §1.1 / Feedback §4.2 (failed list
  load posing as empty — gap ①; detail failure as a silent bounce — gap ⑤); Read §1.12 (a row
  label that isn't true for every row — gap ②); Grow §5.3 (configuration with no path onward to
  integration — gap ⑦).
- **Good cases worth landing later as ✅ examples:** the create modal's dirty-locks-mask-dismiss
  (Edit §2.1) and the Configure-vs-Edit empty config state (Read §1.1). Neither teaches the rule
  a new distinction, so they are recorded here rather than folded in.
