import { stylelint } from '@lobehub/lint';

export default {
  ...stylelint,
  rules: {
    ...stylelint.rules,
    // Review rule: no all-caps labels ("这个为什么要这样大写？不应该有这样的展示，全都改掉").
    'declaration-property-value-disallowed-list': [
      { 'text-transform': ['uppercase'] },
      {
        message:
          'Do not set text-transform: uppercase; write the label in the case it should read.',
      },
    ],
    // Temporarily disabled for gradual migration
    'declaration-property-value-keyword-no-deprecated': null,
    'declaration-property-value-no-unknown': null,
    'selector-class-pattern': null,
    'selector-id-pattern': null,
  },
};
