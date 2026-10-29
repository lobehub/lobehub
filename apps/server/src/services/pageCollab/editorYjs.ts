import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface EditorYjsModules {
  IYjsService: any;
  YjsPlugin: any;
}

let modules: Promise<EditorYjsModules> | undefined;

const EDITOR_PACKAGE = ['@lobehub', 'editor', 'package.json'].join('/');

// @lobehub/editor exposes the Yjs plugin only from its browser entry, which
// imports JSON without import attributes and fails under Node ESM; the plugin
// modules themselves are Node-safe, so load them by file URL. The specifier is
// built at runtime so the server bundler does not rewrite it into an external id.
export const loadEditorYjs = () =>
  (modules ??= (async () => {
    const require = createRequire(path.join(process.cwd(), 'package.json'));
    const root = path.dirname(require.resolve(EDITOR_PACKAGE));
    const load = (file: string) =>
      import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(path.join(root, file))
          .href
      );
    const [plugin, service] = await Promise.all([
      load('es/plugins/yjs/plugin/index.js'),
      load('es/plugins/yjs/service/index.js'),
    ]);
    return { IYjsService: service.IYjsService, YjsPlugin: plugin.YjsPlugin };
  })());
