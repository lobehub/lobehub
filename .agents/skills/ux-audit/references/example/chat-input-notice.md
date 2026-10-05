# UX Audit — Chat Input Notice stacking

**Layers:** L1 static/code ✅ · L2 desktop + mobile visual ✅ · L3 disclosure interaction ✅.

**Surface class:** contextual capability and restriction feedback inside a persistent chat composer. The closest norms are inline validation/capability warnings, progressive disclosure, and non-blocking status display. The composer must remain the dominant action surface; routine warnings should explain state without taking over the conversation.

## Patterns in use

| Pattern                        | Rating | Evidence                                                                                                                                                       |
| ------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contextual capability feedback | ✅     | Notices stay beside the controls they affect; unresolved runtime state remains silent (`useChatInputNotice.ts:87-109,254-263`).                                |
| Progressive disclosure         | ✅     | Any non-empty notice set collapses to one consistent count entry, then expands on demand (`Content.tsx`).                                                      |
| Status summary + detail        | ✅     | Compact warning count opens an ordered list of full Alert rows (`Content.tsx:165-195`).                                                                        |
| Responsive disclosure          | ✅     | Desktop accepts hover/click; mobile uses click, and the list width/height are viewport-bounded (`Content.tsx:53-58,173-175`).                                  |
| Recovery action                | ✅     | Existing per-notice action, permission-disabled reason, loading state, and error toast remain intact (`Content.tsx:105-140`; `useChatInputNotice.ts:265-324`). |

## Strengths / good cases

- **✅ One disclosure model for every count.** Single and multiple notices use the same compact count entry and the same upward Popover, so the composer no longer changes layout strategy when a second condition appears.
- **✅ Routine states no longer compete with the composer.** The summary occupies one compact toolbar slot, while the complete content floats above the input on demand. This applies Grow §5.1 progressive disclosure without hiding the existence or count of warnings.
- **✅ Long warnings stay readable.** Expanded notice titles use normal wrapping plus `overflow-wrap: anywhere`; the viewport-bounded list scrolls as a whole instead of truncating actionable copy.
- **✅ Priority remains semantic, not arrival-based.** Resource-level view-only state is inserted before narrower model configuration state, so the expanded list leads with the broad blocker (`useChatInputNotice.ts:75-109`). The legacy singular resolver still returns that first item (`:120-133`).
- **✅ Cold-load false warnings stay suppressed.** Model warnings wait for both model configuration and effective selection resolution (`useChatInputNotice.ts:87-101,254-263`), validating Feedback §4.3 capability gating.
- **✅ The component uses existing primitives and tokens.** `Alert`, text `Button`, `Popover`, responsive hook, semantic warning color, and current i18n/action paths are reused rather than introducing a parallel notice system (`Content.tsx`). Warning color identifies the state without adding a second elevation system.

## Experience gaps found and resolved

1. 🟡 **The collapsed summary was styled as a raised warning card.** L2 showed a strong warning border plus a two-layer yellow `box-shadow`, making a secondary toolbar affordance compete with the composer. The decoration had no system precedent: `DESIGN.md` reserves semantic color for meaning and standard elevation for surfaces that genuinely float. Fixed by using the canonical text-button hierarchy, keeping only the warning icon/text color, and deleting the colored border and decorative shadow (`Content.tsx`).
2. 🟡 **Wrapped warning icons were centered against the whole paragraph.** `align-items: center` made the second row's icon float between lines instead of identifying the first line. Fixed with first-line alignment (`align-items: flex-start` plus a 1px optical inset), confirmed on the real `/tasks` Task Agent panel at 1600×1000.
3. 🟠 **The first implementation used two disclosure models.** One notice rendered inline while two notices switched to a count Popover, making the composer change shape as state accumulated. Follow-up feedback selected consistency over immediate single-item detail, so every non-empty set now uses the same count-and-expand interaction.
4. 🟠 **Prototype-only notice injection leaked into application logic.** A development environment flag fabricated a second warning. Removed; production resolution is now entirely state-derived, while acceptance uses a temporary harness at the presentation boundary.
5. 🟡 **The default locale source lacked the new count key.** Adding only generated JSON would be overwritten by locale generation. Fixed in `packages/locales/src/default/chat.ts` and preview JSON for English and Simplified Chinese.
6. 🟡 **Mobile disclosure initially inherited hover semantics.** Fixed by selecting click-only on mobile while keeping hover plus click on desktop (`Content.tsx`). L2 at an iPhone 14 viewport confirmed the 360px-bounded list fits without horizontal clipping.

## L2 / L3 evidence

- Desktop single notice: the composer shows a compact count of 1; activation opens the full warning above it.
- Desktop long notice: the complete controlled warning wraps to two lines inside the production Popover without ellipsis.
- Desktop multiple collapsed: one compact warning icon/count is visible; the composer, model selector, and send button remain present.
- Desktop multiple expanded: the Popover opens upward and shows the view-only notice before the unavailable-model notice.
- Real Task Agent refinement at 1600×1000: collapsed summary has no border or colored shadow; expanded rows use the standard neutral Popover elevation, and the two-line model warning icon aligns with its first line.
- Mobile multiple expanded: the list remains within the 390px viewport and the summary stays anchored inside the composer.
- Interaction: the controlled production-component harness changed the trigger from `aria-expanded=false` to `true` after activation; source selects click-only when `useIsMobile()` is true.

## Skill feedback

- The findings validate existing `ux` rules: Feedback §4.3 for capability-gated state, Grow §5.1 for progressive disclosure, and the persistent-composer guidance in Read §1.11.
- **New generalizable gap landed in Feedback §4.3.** Collapsed guardrail summaries must remain subordinate to their action surface: semantic color may identify state, but strong warning outlines or decorative colored elevation must not turn the trigger into a competing card.
- **New generalizable alignment rule landed in Feedback §4.3.** Icons in wrapped guardrail rows align to the first line of copy rather than the vertical center of the full paragraph.
