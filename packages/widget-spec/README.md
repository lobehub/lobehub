# @lobechat/widget-spec

The authoring contract of LobeHub dashboard widgets — what a widget version may contain and what its script must print. LobeHub validates every draft with these schemas (tRPC, the agent tool and the REST API), so a draft that passes here passes there.

- **zod schemas**: `widgetVersionContentSchema`, `widgetContentSchema`, `widgetManifestSchema`, `widgetViewSchema`, `widgetLayoutSchema`, `widgetOutputSchema`, `widgetPresetSchema`
- **TypeScript types**: `WidgetManifest`, `WidgetView`, `WidgetOutput`, `WidgetLayoutNode`, … plus `z.input` types such as `WidgetVersionContentInput`
- **JSON Schema** (draft 2020-12): `@lobechat/widget-spec/schema/<name>.schema.json` for `content`, `version-content`, `manifest`, `view`, `layout`, `output`, `preset`, or `widgetJsonSchema(name)` at runtime
- **helpers**: `parseWidgetOutput` (check a script's stdout), `parseWidgetPreset`, param helpers, `BUILTIN_WIDGET_PRESETS`

```bash
pnpm add @lobechat/widget-spec zod
```

```ts
import { parseWidgetOutput, widgetVersionContentSchema } from '@lobechat/widget-spec';

const draft = widgetVersionContentSchema.parse({
  manifest: { network: { allow: ['api.github.com'] }, schedule: { pattern: '0 * * * *' } },
  outputType: 'stat',
  runtime: 'node',
  script: `const r = await fetch('https://api.github.com/repos/lobehub/lobehub');
console.log(JSON.stringify({ type: 'stat', value: (await r.json()).stargazers_count }));`,
});

parseWidgetOutput('{"type":"stat","value":42}', draft.outputType); // { ok: true, … }
```

The zod schemas are authoritative. JSON Schema carries every field, type, enum, length and pattern, but not the cross-field rules (a param named like an env requirement, a `select` param without options, duplicate series names, layout node limits); those are only enforced by zod and by LobeHub.

The full field reference, runtime rules and an example widget are in [`docs/development/widget-spec.mdx`](../../docs/development/widget-spec.mdx).

## Development

```bash
bun run --cwd packages/widget-spec generate   # rewrite schema/*.schema.json after changing a schema
bunx vitest run --silent='passed-only'         # from packages/widget-spec
pnpm --filter @lobechat/widget-spec pack       # build dist/ and pack exactly what npm would receive
```

`schema/` is committed and checked against the zod schemas by the tests and by `prepack`. Inside the monorepo the package resolves to `src/`; the packed package exports the bundled `dist/` (with the widget types inlined from the private `@lobechat/types`) through `publishConfig`, and depends only on `zod`.
