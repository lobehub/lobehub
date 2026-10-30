import { builtinToolIdentifiers } from '@lobechat/builtin-tools/identifiers';

/**
 * The `plugin` key naming a pending call's tab the way its card names it: two
 * steps of one flow (a widget's dry run, then its publish) must not read as
 * one raw API name repeated. Tools that are not builtin have none and keep
 * their API name.
 */
export const interventionTabLabelKey = ({
  apiName,
  identifier,
}: {
  apiName: string;
  identifier: string;
}) =>
  builtinToolIdentifiers.includes(identifier)
    ? `builtins.${identifier}.apiName.${apiName}`
    : undefined;

/**
 * Tell apart tabs that would read the same: two calls of one action (two
 * widget dry runs) get "Dry-run widget 1" / "Dry-run widget 2"; a label that
 * appears once stays as is.
 */
export const numberDuplicateLabels = (labels: string[]) => {
  const total = new Map<string, number>();
  for (const label of labels) total.set(label, (total.get(label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return labels.map((label) => {
    if ((total.get(label) ?? 0) < 2) return label;
    const index = (seen.get(label) ?? 0) + 1;
    seen.set(label, index);
    return `${label} ${index}`;
  });
};
