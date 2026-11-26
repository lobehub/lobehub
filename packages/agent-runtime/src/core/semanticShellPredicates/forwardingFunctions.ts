import type { SemanticShellPredicate } from '@lobechat/types';

import type { ShellSegment } from '../shellCommand';
import { collectFlagLettersAndNames } from '../shellCommand';
import { TARGET_FAMILY_TESTS } from './targets';

/** A token that forwards the caller's whole argv into the callee's argv. */
const ARG_FORWARD_PATTERN = /^\$(?:@|\*|\{@\}|\{\*\})$/;

/**
 * Words that may sit between the body's command slot and `rm` without making
 * `rm` an argument of something else (`f(){ sudo rm -rf ~; }`).
 */
const RM_BODY_PREFIX_WORDS = new Set([
  'busybox',
  'chroot',
  'command',
  'doas',
  'env',
  'exec',
  'flock',
  'ionice',
  'ltrace',
  'nice',
  'nohup',
  'runuser',
  'setsid',
  'stdbuf',
  'strace',
  'su',
  'sudo',
  'time',
  'timeout',
  'xargs',
]);

/** A forwarding shell function whose body forwards argv into `rm`. */
export interface ForwardingRmFunction {
  /** Target families the body names directly (`rm -rf ~`), not via `"$@"`. */
  bodyTargets: SemanticShellPredicate[];
  /** The body itself carries a force flag (`rm -rf "$@"`). */
  force: boolean;
  /** The body itself carries a recursive flag (`rm -rf "$@"`). */
  recursive: boolean;
}

/**
 * Parse a Bash function definition head (`zap(){ … }`, `zap() { … }`,
 * `function zap { … }`, `function zap() { … }`) into its name and body words.
 * Returns null when the segment is not a definition.
 */
const parseFunctionDefinition = (words: string[]): { body: string[]; name: string } | null => {
  const [first] = words;
  if (!first) return null;

  if (first === 'function') {
    const name = (words[1] ?? '').replace(/\(\s*\)$/, '');
    if (!/^[a-z_][\w-]*$/i.test(name)) return null;
    return { body: words.slice(words[2] === '{' ? 3 : 2), name };
  }

  const withParens = /^([a-z_][\w-]*)\s*\(\s*\)\s*\{?$/i.exec(first);
  if (withParens) {
    const name = withParens[1];
    if (first.endsWith('{')) return { body: words.slice(1), name };
    return words[1] === '{' ? { body: words.slice(2), name } : null;
  }

  // Whitespace between the name and `()` (`zap () { … }`) tokenizes them apart.
  if (/^[a-z_][\w-]*$/i.test(first)) {
    let index = 1;
    if (words[index] === '()') index++;
    if (words[index] === '{') return { body: words.slice(index + 1), name: first };
  }

  return null;
};

/**
 * Shell functions that forward the caller's argv into `rm` (`zap(){ rm "$@"; }`).
 *
 * Calling such a function (`zap -rf /`) deletes root exactly like `rm -rf /`,
 * but the definition and the invocation are separate segments and the
 * invocation resolves to the FUNCTION name, not `rm` — the precise predicates
 * and the ambiguity fallback both skip it. The flags may sit in either place
 * (`rm -rf "$@"` vs `zap -rf /`), so both are collected.
 */
export const collectForwardingRmFunctions = (
  segments: ShellSegment[],
): Map<string, ForwardingRmFunction> => {
  const functions = new Map<string, ForwardingRmFunction>();
  for (const segment of segments) {
    const definition = parseFunctionDefinition(segment.words);
    if (!definition) continue;
    const { body, name } = definition;
    const rmIndex = body.findIndex((word) => word === 'rm' || /\/rm$/.test(word));
    if (rmIndex < 0) continue;
    const rmArgs = body.slice(rmIndex + 1);
    // Only argv-forwarding bodies receive the caller's target and flags; a
    // body that names its own target (`rm -rf /tmp/x "$@"`) is not covered
    // here and stays with the precise predicates on its own segment.
    const forwardsArgv = rmArgs.some((word) => ARG_FORWARD_PATTERN.test(word));
    const { letters, names } = collectFlagLettersAndNames(
      rmArgs.filter((word) => word.startsWith('-') && word.length > 1),
    );
    const recursive = letters.has('r') || letters.has('R') || names.has('recursive');
    const force = letters.has('f') || names.has('force');
    // A body that names its own target (`f(){ rm -rf ~; }`) deletes it whether
    // or not the caller passes arguments, so the invocation has to be judged on
    // the body's own target too. Only the definition and the call are separate
    // segments — the invocation resolves to the function name, so nothing else
    // inspects this body. The target only counts when `rm` is the body's own
    // command: in `f(){ echo rm -rf ~; }` the delete is echo's ARGUMENT and
    // never runs.
    const rmIsBodyCommand = body
      .slice(0, rmIndex)
      .every(
        (word) => word.startsWith('-') || /^\d+$/.test(word) || RM_BODY_PREFIX_WORDS.has(word),
      );
    const bodyTargets =
      recursive && rmIsBodyCommand
        ? (Object.keys(TARGET_FAMILY_TESTS) as SemanticShellPredicate[]).filter(
            (family) =>
              (family !== 'rmForceDotTarget' || force) && rmArgs.some(TARGET_FAMILY_TESTS[family]),
          )
        : [];
    if (!forwardsArgv && bodyTargets.length === 0) continue;
    functions.set(name, { bodyTargets, force, recursive });
  }
  return functions;
};

/**
 * True when the segment invokes a forwarding function as if it were `rm`:
 * recursive flag (from the call, the body, or both) plus a target from the
 * REQUESTED predicate's family. Honours the predicate contract exactly like
 * the precise resolvers, including the force requirement of the dot rule.
 */
export const matchesForwardingRmFunction = (
  segment: ShellSegment,
  predicate: SemanticShellPredicate,
  functions: Map<string, ForwardingRmFunction>,
): boolean => {
  const functionName = segment.resolvedCommand;
  if (!functionName) return false;
  const body = functions.get(functionName);
  if (!body) return false;

  const { letters, names } = collectFlagLettersAndNames(segment.flags);
  const recursive =
    body.recursive || letters.has('r') || letters.has('R') || names.has('recursive');
  if (!recursive) return false;

  const force = body.force || letters.has('f') || names.has('force');
  if (predicate === 'rmForceDotTarget' && !force) return false;

  // The body deletes its own target on every call, whatever argv it gets.
  if (body.bodyTargets.includes(predicate)) return true;

  return segment.words.slice(1).some(TARGET_FAMILY_TESTS[predicate]);
};
