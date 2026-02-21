import { stylelint } from '@lobehub/lint';

export default {
  ...stylelint,
  rules: {
    'selector-id-pattern': null,
    ...stylelint.rules,
  },
};
