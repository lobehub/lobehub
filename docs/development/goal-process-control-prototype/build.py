#!/usr/bin/env python3
"""Inline src/**/*.ts(x) into one HTML; a tiny CommonJS loader compiles each module with Babel at runtime.
Usage: python3 build.py  → goal-process-control.html
Sources stay production-style TSX so they can be moved into src/features/AgentGoals/ProcessControl/."""
import os, html
ROOT = os.path.dirname(os.path.abspath(__file__))
mods = {}
for dp, _, fs in os.walk(os.path.join(ROOT, 'src')):
    for f in sorted(fs):
        if f.endswith(('.ts', '.tsx')):
            p = os.path.relpath(os.path.join(dp, f), ROOT).replace(os.sep, '/')
            mods[p] = open(os.path.join(dp, f), encoding='utf-8').read()
def tag(p, src):
    safe = src.replace("</script", "<\\/script")
    return '<script type="text/plain" data-module="' + p + '">\n' + safe + '\n</script>'
scripts = '\n'.join(tag(p, src) for p, src in sorted(mods.items()))
page = f'''<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Goal · 流程管控原型（时序回放）</title>
    <style>body{{margin:0}} #boot{{font:13px/1.6 ui-monospace,monospace;color:#888;padding:24px}}</style>
    <script src="./lobe-prototype-runtime.js"></script>
    <script src="./babel.min.js"></script>
  </head>
  <body>
    <div id="boot">booting prototype runtime…</div>
    <div id="root"></div>
    <!--
      Built by build.py from src/**/*.tsx — edit the sources, not this file.
      Runtime: bash .claude/skills/design-prototype/scripts/build-runtime.sh <this dir>
      (lobe-prototype-runtime.js + babel.min.js are generated and must not be committed.)
      Each module below is compiled with Babel (typescript + react + commonjs) on load, so the
      sources are real TSX that can move into src/features/AgentGoals/ProcessControl/ with only
      the import paths and createStyles → createStaticStyles changed.
    -->
{scripts}
    <script>
      (() => {{
        const sources = {{}};
        document.querySelectorAll('script[data-module]').forEach((el) => {{ sources[el.dataset.module] = el.textContent; }});
        const ReactNS = __PROTO_DEPS_NS__.default['react'];
        const ReactGlobal = ReactNS.default ?? ReactNS;
        const cache = {{}};
        const resolve = (from, spec) => {{
          if (!spec.startsWith('.')) return null;
          const parts = (from.split('/').slice(0, -1).join('/') + '/' + spec).split('/');
          const out = [];
          for (const p of parts) {{ if (p === '.' || p === '') continue; if (p === '..') out.pop(); else out.push(p); }}
          const base = out.join('/');
          for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) if (sources[base + ext]) return base + ext;
          throw new Error('module not found: ' + spec + ' (from ' + from + ')');
        }};
        const makeRequire = (from) => (spec) => {{
          const path = resolve(from, spec);
          if (!path) {{
            const m = __PROTO_DEPS_NS__.default[spec];
            if (!m) throw new Error('prototype runtime is missing module: ' + spec + ' — add it to entry.mjs and rebuild');
            return m;
          }}
          if (cache[path]) return cache[path].exports;
          const module = {{ exports: {{}} }};
          cache[path] = module;
          const code = Babel.transform(sources[path], {{
            filename: path,
            presets: [['typescript', {{ isTSX: path.endsWith('.tsx'), allExtensions: true }}], 'react'],
            plugins: ['transform-modules-commonjs'],
            sourceType: 'module',
          }}).code;
          new Function('require', 'module', 'exports', 'React', code)(makeRequire(path), module, module.exports, ReactGlobal);
          return module.exports;
        }};
        try {{ makeRequire('src/index.tsx')('./main'); }} catch (e) {{ console.error(e); const b = document.querySelector('#boot'); if (b) b.textContent = String(e.stack || e); throw e; }}
      }})();
    </script>
  </body>
</html>
'''
open(os.path.join(ROOT, 'goal-process-control.html'), 'w', encoding='utf-8').write(page)
print(f'built {len(mods)} modules → goal-process-control.html')
