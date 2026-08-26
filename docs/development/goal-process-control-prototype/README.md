# Goal process-control prototype

Interactive replay of one real Goal (nanoGPT on M5 Max, `tpc_XUh2GbVp3UVM`) through 18 steps, rendered with the real design system.

```bash
# once: build the design-system runtime next to the HTML (generated files are git-ignored)
bash .claude/skills/design-prototype/scripts/build-runtime.sh docs/development/goal-process-control-prototype
# once: bundle @xyflow/react (react-flow) for the graph and copy its stylesheet
cd docs/development/goal-process-control-prototype && npm i --no-save --prefix rf @xyflow/react@12
npx esbuild rf/entry.mjs --bundle --format=iife --global-name=__RF_NS__ \
  --define:process.env.NODE_ENV='"production"' \
  --alias:react=./rf/shim-react.js --alias:react/jsx-runtime=./rf/shim-jsx.js --alias:react-dom=./rf/shim-dom.js \
  --outfile=rf-runtime.js && cp rf/node_modules/@xyflow/react/dist/style.css xyflow.css
# after editing src/**: regenerate the single-file HTML
python3 docs/development/goal-process-control-prototype/build.py
open docs/development/goal-process-control-prototype/goal-process-control.html
```

`src/` is production-style TSX (`createStyles`, `@lobehub/ui`, typed props) split the way it would land in `src/features/AgentGoals/ProcessControl/`:

| File                                   | Role                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `types.ts`                             | view types mirroring `packages/types/src/goal.ts` + execution projection |
| `model/frontier.ts`                    | frontier projection, plain-word states, liveness                         |
| `model/format.ts`                      | time / money formatting; `clock.now` is the replayed step's time         |
| `data/steps.ts`                        | the 18-step timeline (each step mutates state; narration per step)       |
| `components/GoalHeader.tsx`            | title · run/pause action · properties column (TaskDetailPage top)        |
| `components/Frontier/FrontierList.tsx` | "接下来" — Task-list-style rows, decisions with inline buttons           |
| `components/Graph/Graph.tsx`           | exploration graph (kind = color, state = stroke, authority badges)       |
| `components/Graph/NodeDetail.tsx`      | node panel: source / attempts / edges; editor for not-yet-started Work   |
| `components/Findings.tsx`              | latest findings                                                          |
| `components/Contract.tsx`              | requirement + goal-level checks + budgets                                |
| `components/Activity.tsx`              | Linear-style activity feed with node chips                               |
| `GoalDetailPage.tsx`                   | page body + local actions (the piece that becomes the route's feature)   |
| `App.tsx`, `main.tsx`                  | prototype harness: step bar + NavHeader chrome                           |

Everything the business cannot back today carries a `NEW` tag on the mock (see the design spec §6).
