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
