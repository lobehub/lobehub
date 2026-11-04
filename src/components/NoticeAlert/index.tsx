'use client';

import { Alert, type AlertProps } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  // `Alert` pins the action and the close button to the top of the row. With a
  // description the notice is two lines tall, which leaves the button between
  // the lines; centering both ties them to the whole message instead.
  centered: { alignSelf: 'center' },
  // Greedy wrapping leaves a lone character (or a two-character word) on the
  // second line when a sentence barely overflows. Balanced lines never do.
  balanced: { textWrap: 'balance' },
});

/**
 * Class names, not props: `Alert` takes slot classes, and a class from outside
 * `@layer lobe-ui` overrides its layout rules.
 */
const centeredClass = stylex.props(styles.centered).className;
const balancedClass = stylex.props(styles.balanced).className;

const join = (...classNames: (string | undefined)[]) => classNames.filter(Boolean).join(' ');

/**
 * `Alert` for the notices that sit beside the composer or the editor: a short
 * title, an optional second line, one action and an optional close button.
 *
 * It keeps the action and the close button centered against the text and
 * balances the wrapped lines. Everything else is `Alert`'s own behavior.
 */
export const NoticeAlert = memo<AlertProps>(({ classNames, ...rest }) => (
  <Alert
    {...rest}
    classNames={{
      ...classNames,
      action: join(centeredClass, classNames?.action),
      close: join(centeredClass, classNames?.close),
      description: join(balancedClass, classNames?.description),
      title: join(balancedClass, classNames?.title),
    }}
  />
));

NoticeAlert.displayName = 'NoticeAlert';
