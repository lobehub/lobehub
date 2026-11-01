import * as stylex from '@stylexjs/stylex';
import { type CompiledStyles, type InlineStyles, type StyleXArray } from '@stylexjs/stylex';
import { type CSSProperties } from 'react';

/**
 * stylex.props for elements that also forward a caller's className / style, which
 * spreading stylex.props cannot do (@stylexjs/no-conflicting-props).
 *
 *   <div {...sx([styles.root, active && styles.active], className, style)} />
 *
 * The caller's className is appended, not merged: StyleX rules carry raised
 * specificity, so a plain class cannot override them. Components that let callers
 * restyle them take an `xstyle?: StyleXStyles` prop and pass it in `styles`.
 *
 * Mirror props' exported argument types explicitly: StyleXStyles restricts CSS
 * properties and rejects compiled custom properties and marker symbols. Deriving
 * Parameters<typeof stylex.props> also resolves to never in Bun's checker.
 */
type SxArgument = StyleXArray<
  CompiledStyles | boolean | null | undefined | Readonly<[CompiledStyles, InlineStyles]>
>;

export const sx = (styles: SxArgument, className?: string, style?: CSSProperties) => {
  const props = stylex.props(styles);
  const mergedClassName = [props.className, className].filter(Boolean).join(' ');
  return {
    className: mergedClassName || undefined,
    style: props.style || style ? { ...props.style, ...style } : undefined,
  };
};
