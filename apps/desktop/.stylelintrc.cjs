const config = require('@lobehub/lint').stylelint;

module.exports = {
  ...config,
  rules: {
    'selector-id-pattern': null,
    ...config.rules,
  },
};
