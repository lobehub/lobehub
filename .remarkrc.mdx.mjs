import remarklint from '@lobehub/remarklint-config';

export default {
  ...remarklint,
  plugins: ['remark-mdx', ...remarklint.plugins, ['remark-lint-file-extension', false]],
};
