import type { SemanticShellPredicate } from '@lobechat/types';

import type { ShellSegment } from '../shellCommand';
import { parameterExpansionOperand } from '../shellCommand';
import { stripGroupingParens } from '../shellQuoting';

/**
 * Lift a family test over parameter expansions: `${Y:-/}` deletes `/` when Y
 * is unset, so an operand of that shape matches when any word of its
 * expansion operand matches (unquoted, the operand is word-split).
 */
const withExpansionOperand =
  (test: (word: string) => boolean) =>
  (word: string): boolean => {
    if (test(word)) return true;
    const operand = parameterExpansionOperand(word);
    return operand !== undefined && operand.split(/\s+/).some((member) => test(member));
  };

/** A component that expands to more than one name: `*`, `?`, `[...]`. */
const hasGlobMeta = (component: string): boolean => /[*?[]/.test(component);

/**
 * Collapse repeated trailing separators to at most one. `/home/alice//` and
 * `~//` name the same directories as their single-slash counterparts, so the
 * family tests must compare the normalized form — otherwise the exact-string
 * home comparisons and the `/?$` suffix reject a real deletion.
 */
const collapseTrailingSlashes = (operand: string): string =>
  operand.length > 1 ? operand.replace(/\/{2,}$/, '/') : operand;

/**
 * A glob component directly under root that expands to essentially the whole
 * top level: `*`, `**`, `?`, `?*`, `[a-z]*`, `.*`. Narrowing the expansion
 * with a literal name (`*.log`, `tmp*`) keeps it a subset delete and out of
 * the root family.
 */
const isRootWideGlobComponent = (component: string): boolean => {
  if (!hasGlobMeta(component)) return false;
  // Drop character classes and single-character wildcards: a remainder that is
  // empty (or only dots/colons) means no literal name narrowed the expansion.
  const remainder = component.replaceAll(/\[[^\]]*\]/g, '').replaceAll(/[*?]/g, '');
  return /^[.:]*$/.test(remainder);
};

/**
 * Root-family target: the operand IS root, normalizes to root, or is a single
 * root-wide glob directly under root (`/` + `*`, `/` + `?*`, `/` + `[a-z]*`).
 * Such an expansion covers the top-level entries and `rm -rf` deletes them
 * all.
 *
 * `segment/..` pairs and `/.` are normalized FIRST: the parent-traversal form
 * `rm -rf /tmp/../*` must be judged as a root-wide glob, not rejected because
 * of the real `tmp` component. A glob behind a real component (`/tmp` + `/*`)
 * is a subset delete.
 */
const isRootFamilyTargetLiteral = (word: string): boolean => {
  // A grouping paren can glue to the operand (`(rm -rf /)` tokenizes the
  // target as `/)`): `(`/`)` are shell operators, not part of the path.
  const operand = stripGroupingParens(word);
  if (operand.startsWith('{') && operand.endsWith('}')) {
    // Brace expansion (`{/,/etc}` → '/' and '/etc'): dangerous when any
    // member is a root-family shape.
    return operand
      .slice(1, -1)
      .split(',')
      .some((member) => isRootFamilyTargetLiteral(member));
  }
  if (!operand.startsWith('/')) return false;
  const parts = operand
    .replaceAll(/\/\.(?=\/|$)/g, '')
    .split('/')
    .reduce<string[]>((stack, part) => {
      // `..` at root stays at root (`/..` IS `/`): popping an empty stack is
      // a no-op, never a pushed `..` component.
      if (part === '..') stack.pop();
      else if (part !== '' && part !== '.') stack.push(part);
      return stack;
    }, []);
  if (parts.length === 0) return true; // '/', '//', '/.', '/./' …
  return parts.length === 1 && isRootWideGlobComponent(parts[0]);
};

/** Root-family targets: bare '/', root-reducible shapes and root globs.
 * Deliberately DISJOINT from the home/dot families — the precise root
 * resolver and the scoped fallback both must not fire on '.'/home shapes
 * that belong to their own rules (mislabeling breaks custom matcher
 * contracts and reports the wrong warning).
 *
 * Parent traversal is resolved first: an operand like /tmp/.. then a glob
 * member expands to the directories directly below root and recursively
 * deletes them, so the operand must be normalized to root before the glob
 * test — rejecting it because of the real tmp component would leak the
 * bypass.
 */

export const isRootFamilyTarget = withExpansionOperand(isRootFamilyTargetLiteral);

/** Home-directory targets: ~, $HOME, /Users/<name>, /home/<name> (optional
 * trailing slash). Shared by the precise predicate and the scoped fallback.
 * Grouping parens are stripped first: `(rm -rf ~)` leaves the operand as `~)`,
 * and only the root family used to normalize that operator away. Repeated
 * trailing separators (`rm -rf ~//`, `$HOME//`) name the same directory, so
 * they collapse to at most one before the comparison. */
export const isHomeTarget = withExpansionOperand((word: string): boolean => {
  const operand = collapseTrailingSlashes(stripGroupingParens(word));
  return (
    operand === '~' ||
    operand === '$HOME' ||
    operand === '${HOME}' ||
    operand === '~/' ||
    operand === '$HOME/' ||
    operand === '${HOME}/' ||
    /^\/(?:Users|home)\/[^/]+\/?$/.test(operand)
  );
});

/** Current-directory targets: '.' and './'. */
export const isDotTarget = withExpansionOperand((word: string): boolean => {
  const operand = stripGroupingParens(word);
  return operand === '.' || operand === './';
});

/**
 * Per-predicate target families for the ambiguity fallback. The fallback
 * must honour the REQUESTED predicate's semantics — a home-scoped matcher
 * must not fire on a root-shaped payload (`bash -c "rm -rf /"` under
 * rmRecursiveHomeTarget), or the reported rule mislabels the danger and
 * custom matcher contracts break.
 */
export const TARGET_FAMILY_TESTS: Record<SemanticShellPredicate, (word: string) => boolean> = {
  rmRecursiveRootTarget: isRootFamilyTarget,
  rmRecursiveHomeTarget: isHomeTarget,
  rmForceDotTarget: isDotTarget,
};

/** rm + recursive flag + a target from the predicate's family. */
export const hasRecursiveRmWithDangerousTarget = (
  segment: ShellSegment,
  predicate: SemanticShellPredicate,
): boolean => {
  const recursive = segment.hasFlag('r') || segment.hasFlag('R');
  if (!recursive) return false;
  // rmForceDotTarget's precise contract also requires the force flag.
  if (predicate === 'rmForceDotTarget' && !segment.hasFlag('f')) return false;
  const familyTest = TARGET_FAMILY_TESTS[predicate];
  // words.slice(1) supplements the target slices: root-reducible shapes like
  // '/.' and brace words '{/,/etc}' carry no trailing slash, and the slice
  // keeps matching robust when the command slot is ambiguous.
  return [...segment.trailingSlashTargets, ...segment.homeTargets, ...segment.words.slice(1)].some(
    familyTest,
  );
};
