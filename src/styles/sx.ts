import * as stylex from '@stylexjs/stylex';
import { type CompiledStyles, type InlineStyles, type StyleXArray } from '@stylexjs/stylex';
import { type CSSProperties } from 'react';

/**
 * stylex.props for elements that also forward a caller's className / style, which
 * spreading stylex.props cannot do (@stylexjs/no-conflicting-props).
 *
 *   <div {...sx(styles.root, active && styles.active, className, style)} />
 *
 * Strings are appended as class names and plain objects merge into the inline style,
 * in argument order; everything else goes to stylex.props. A caller's className
 * cannot override StyleX rules, which carry raised specificity: components that let
 * callers restyle them take an `xstyle?: StyleXStyles` prop and pass it here.
 *
 * Argument types mirror props' exports explicitly: StyleXStyles restricts CSS
 * properties and rejects compiled custom properties and marker symbols.
 */
type SxStyle = StyleXArray<
  CompiledStyles | boolean | null | undefined | Readonly<[CompiledStyles, InlineStyles]>
>;

type SxArgument = SxStyle | string | CSSProperties;

const isInlineStyle = (argument: SxArgument): argument is CSSProperties =>
  typeof argument === 'object' &&
  argument !== null &&
  !Array.isArray(argument) &&
  !('$$css' in argument);

export const sx = (...args: SxArgument[]) => {
  const styles: SxStyle[] = [];
  const classNames: string[] = [];
  let inline: CSSProperties | undefined;
  for (const argument of args) {
    if (typeof argument === 'string') classNames.push(argument);
    else if (isInlineStyle(argument)) inline = { ...inline, ...argument };
    else styles.push(argument);
  }
  const props = stylex.props(styles);
  const className = [props.className, ...classNames].filter(Boolean).join(' ');
  return {
    className: className || undefined,
    style: props.style || inline ? { ...props.style, ...inline } : undefined,
  };
};
