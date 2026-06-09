# Diagnostic Quick-Lookup

| Symptom                                         | Surface to check                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| No header at all on the tool call               | Inspector missing from `client/Inspector/index.ts` registry                                                                           |
| Header shows the API name but no chips          | Inspector missing `args?.X \|\| partialArgs?.X` fallback                                                                              |
| Header doesn't pulse during loading             | Missing `shinyTextStyles.shinyText` on `isArgumentsStreaming \|\| isLoading`                                                          |
| Empty result card under header                  | Render returned `<div />` instead of `null` when no data                                                                              |
| Render looks "complex" / card-in-card           | Filled container (`colorFillQuaternary`) wrapping more filled boxes — flatten to single-layer, see [shared-rules.md](shared-rules.md) |
| Layout jump when result arrives                 | Placeholder dimensions don't match Render dimensions                                                                                  |
| Approval dialog never appears                   | Manifest missing `humanIntervention`, or Intervention not in registry                                                                 |
| Approval click doesn't wait for inline edit     | Missing `registerBeforeApprove(id, flushFn)`                                                                                          |
| Portal opens but blank                          | Switch in `Portal/index.tsx` doesn't cover the apiName                                                                                |
| Strings show as `builtins.lobe-foo.apiName.bar` | Missing i18n key in `src/locales/default/plugin.ts` (or not seeded in dev locale files)                                               |
| Wrong color shade on `<Text type="secondary">`  | `type='secondary'` is lighter than `colorTextSecondary` — pass via `style={{ color: cssVar.colorTextSecondary }}`                     |
