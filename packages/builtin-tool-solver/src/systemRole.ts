/**
 * System prompt for the builtin-solver tool.
 *
 * Design notes (grounded in the formulation experiment that shaped the service):
 * - The experiment's only typed-spec failures were EXTRACTION errors (budget and
 *   constraint semantics), caught by a gold-spec verifier that does not exist at
 *   runtime. The prompt therefore drills a re-check ritual: before the first
 *   solve, after every failure, and before presenting a result.
 * - The repair loop is bounded at 3 rounds — the experiment's repairs converged
 *   within that budget; past it the model is guessing, so it should stop and
 *   surface the conflicts to the user.
 * - Pack schemas are documented inline (the service does not expose schema
 *   discovery). Keep each pack doc self-contained so adding a pack means adding
 *   one block here.
 */
export const systemPrompt = `You have access to **builtin-solver**, a constraint-solver service. It turns a natural-language request with hard constraints (budget, dates, capacity, compatibility) into an exact solution instead of an improvised one. Prefer it over mental arithmetic whenever the user states hard constraints and expects a plan that provably satisfies them.

APIs:
- **solve**: Formalize the request into the pack's typed spec and solve it. Returns one of four statuses (see below).
- **verify**: Independently re-check a plan from solve with a second code path (for travelplanner: the 13 official constraints). Always verify the plan you intend to present; never present a plan that failed verification — pick another candidate or re-solve instead.

Both APIs take a \`pack\` parameter naming the domain pack. Available packs:

### Pack \`travelplanner\` — multi-day US trip planning

\`queryId\` selects the query's reference data (real flights, restaurants, attractions, accommodations): \`<split>_<index0>\` with splits \`train\`, \`validation\`, \`test\`, e.g. \`"validation_0"\`.

\`spec\` fields (all costs in USD):
- \`origin\` (string): departure city, plain name, e.g. "Washington".
- \`destination\` ({ type: "city" | "state", name }): "city" for a single-city trip, "state" when the query tours a state.
- \`days\` (int): total trip length INCLUDING departure and return days.
- \`startDate\` ("YYYY-MM-DD"): first day of the trip.
- \`visitingCityNumber\` (int): distinct cities visited EXCLUDING the origin.
- \`peopleNumber\` (int): travelers.
- \`budget\` (number): TOTAL trip budget covering transportation + meals + accommodation for ALL travelers — not per person, not per day.
- Optional hard constraints: \`houseRule\` ("smoking" | "parties" | "children under 10" | "visitors" | "pets" — every accommodation must ALLOW it), \`roomType\` ("shared room" | "not shared room" | "private room" | "entire room" — required for every accommodation), \`cuisines\` (string[] — EACH must appear in at least one meal outside the origin city), \`transportation\` ("no flight" | "no self-driving" — applies to the whole trip).
- Optional \`soft\` preferences (preferredCuisines, minRestaurantRating, minAccommodationReviewRate): ranking only, never affect feasibility. Map "I'd prefer / ideally / if possible" to soft, never to hard.

### Extraction guard — check before you solve

Most solve failures come from spec extraction mistakes, not the solver. There is no gold-spec checker at runtime, so YOU are the checker:
1. Before the first solve, re-read the user's original words and re-check EVERY extracted field, especially: budget scope (total, all travelers, all cost categories), days vs visitingCityNumber (does the query say "3 days in one city" or "tour 3 cities"?), and constraint semantics ("no flight" means the transportation restriction, "I want Italian food" is a required cuisine only if the user insists, otherwise a soft preference).
2. After every failure (error or infeasible), re-check the spec against the request before changing anything — fix extraction errors first, relax constraints only if the extraction is faithful.
3. Before presenting a result, re-check once more that the spec you solved still matches what the user asked.

### Status handling and the repair loop

- **optimal**: all hard constraints satisfied at the provably best cost. Verify, then present.
- **feasible_timeout**: the best plan found within the time limit; optimality not proven. Verify it before presenting; if the user needs the optimum, re-solve once with a larger \`timeLimitMs\`. The effective limit is echoed in solverMeta.
- **infeasible**: \`conflicts\` lists the conflicting constraints with \`involvedFields\` (spec field paths), a human-readable \`explanation\` (for budget conflicts it names the minimum feasible cost), and \`suggestedRelaxations\`. Repair loop, AT MOST 3 rounds: re-check extraction (above), then adjust the implicated fields using the suggestions and solve again. NEVER silently drop or relax a user's hard constraint — when you present a result from a relaxed spec, state exactly which fields you relaxed and why. If still infeasible after 3 rounds, stop solving and present the conflicts and possible relaxations to the user.
- **error**: the spec failed validation; the result lists every violation. Fix the spec fields and re-solve — this also counts toward the 3 repair rounds.

Typical flow: formalize → self-check → solve → verify → present (with cost vs budget and which constraints were honored), repairing infeasible/error outcomes within the 3-round budget.`;
