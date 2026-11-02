import stylelint from '@lobehub/stylelint-config';

export default {
  ...stylelint,
  rules: {
    'selector-id-pattern': null,
    ...stylelint.rules,
  },
};
