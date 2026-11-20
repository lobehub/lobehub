import { describe, expect, it } from 'vitest';

import { elementAtPath, resolveForward } from './forward';

const component = (title: string, extra = '') => `
import { Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

const AcceptanceIdentity = ({ focusSlot, titleXstyle }) => {
  const { data } = useBundle();
  if (!data) return null;
  return (
    <Flexbox gap={10}>
      <Flexbox horizontal className={styles.titleRow}>
        ${title}
        {focusSlot && <div data-role={'focus-entry'}>{focusSlot}</div>}
      </Flexbox>
      ${extra}
    </Flexbox>
  );
};

export default AcceptanceIdentity;
`;

const title = (props = 'className={stylex.props(titleXstyle).className}') =>
  `<Text ellipsis as={'h1'} ${props} style={{ fontSize: 18, margin: 0 }} title={data.title} onClick={open}>
          {data.title}
        </Text>`;

describe('a style prop forwarded into our own component', () => {
  it('finds the single element the prop is applied to, with its static attributes', () => {
    expect(resolveForward(component(title()), 'default', 'titleXstyle')).toEqual({
      prop: 'titleXstyle',
      target: {
        application: 'props',
        attributes: { as: 'h1', ellipsis: true, style: { fontSize: 18, margin: 0 } },
        path: [0, 0],
        tag: 'Text',
        tagImport: { imported: 'Text', source: '@lobehub/ui' },
      },
    });
  });

  it('reads a className prop applied as is and a spread of stylex.props', () => {
    const memo = `import { memo } from 'react';
import * as stylex from '@stylexjs/stylex';
export const Row = memo(({ className, xstyle }) => (
  <div>
    <span className={className} />
    <p {...stylex.props(xstyle)} />
  </div>
));
`;
    expect(resolveForward(memo, 'Row', 'className').target).toMatchObject({
      application: 'className',
      path: [0],
      tag: 'span',
    });
    expect(resolveForward(memo, 'Row', 'xstyle').target).toMatchObject({
      application: 'spread',
      path: [1],
      tag: 'p',
    });
  });

  it('refuses a prop applied twice', () => {
    const code = component(title(), '<h2 className={stylex.props(titleXstyle).className} />');
    expect(resolveForward(code, 'default', 'titleXstyle').reason).toBe('FORWARD_APPLIED_2_TIMES');
  });

  it('refuses a prop applied under a condition', () => {
    const code = component(`{data.title && ${title()}}`);
    expect(resolveForward(code, 'default', 'titleXstyle').reason).toBe('FORWARD_CONDITIONAL');
  });

  it('refuses a prop merged with other styles', () => {
    const code = component(title('className={cx(styles.title, titleXstyle)}'));
    expect(resolveForward(code, 'default', 'titleXstyle').reason).toBe(
      'FORWARD_APPLICATION_UNSUPPORTED',
    );
  });

  it('refuses a target whose own style is not static', () => {
    const code = component(
      title().replace('style={{ fontSize: 18, margin: 0 }}', 'style={titleStyle}'),
    );
    expect(resolveForward(code, 'default', 'titleXstyle').reason).toBe(
      'FORWARD_ATTRIBUTES_UNMODELED:style',
    );
  });

  it('refuses a prop the component does not destructure', () => {
    const code = `export const A = (props) => <h1 className={props.className} />;`;
    expect(resolveForward(code, 'A', 'className').reason).toBe('FORWARD_PROP_NOT_DESTRUCTURED');
  });

  it('reads the element at the same place in another version of the component', () => {
    const before = component(title('').replace(' ellipsis', ' ellipsis'));
    expect(elementAtPath(before, 'default', [0, 0])).toEqual({
      attributes: { as: 'h1', ellipsis: true, style: { fontSize: 18, margin: 0 } },
      path: [0, 0],
      tag: 'Text',
      tagImport: { imported: 'Text', source: '@lobehub/ui' },
    });
    expect(elementAtPath(before, 'default', [0, 3])).toEqual({ reason: 'FORWARD_BASE_MISSING' });
  });
});
