import { prettier } from '@lobehub/lint';

export default {
  ...prettier,
  overrides: [
    ...prettier.overrides,
    {
      /**
       * Leave shell code blocks in docs untouched. prettier-plugin-sh parses command synopses such as
       * `lh model view <id> [--json]` as real shell and rewrites `<id>` into a redirection and
       * `[--json]` into a glob. Standalone `.sh` files keep the shell formatter.
       */
      files: ['*.md', '*.mdx'],
      options: { plugins: prettier.plugins.filter((plugin) => plugin !== 'prettier-plugin-sh') },
    },
  ],
};
