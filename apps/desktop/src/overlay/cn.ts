export const cn = (...values: Array<false | null | string | undefined>): string =>
  values.filter(Boolean).join(' ');
