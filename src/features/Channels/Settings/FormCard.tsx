import { Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

import { settingsStyles as styles } from './styles';

interface FormCardProps {
  action?: ReactNode;
  children?: ReactNode;
  danger?: boolean;
  description?: string;
  /** Beside the title, for an action on the card's whole content rather than a commit. */
  headerAction?: ReactNode;
  hint?: ReactNode;
  /** No frame, for content that is already a list of its own rows. */
  plain?: boolean;
  title: string;
}

/** One setting: what it is and its control above, its hint and commit button in a footer bar. */
export function FormCard({
  action,
  children,
  danger,
  description,
  headerAction,
  hint,
  plain,
  title,
}: FormCardProps) {
  return (
    <section {...stylex.props(styles.card, danger && styles.dangerCard, plain && styles.plainCard)}>
      <div {...stylex.props(styles.body, plain && styles.plainBody)}>
        <Flexbox horizontal align="flex-start" gap={16} justify="space-between">
          <div>
            <Text as="h3" fontSize={18} style={{ margin: 0 }} weight={600}>
              {title}
            </Text>
            {description && <Text type="secondary">{description}</Text>}
          </div>
          {headerAction}
        </Flexbox>
        {children}
      </div>
      {(hint || action) && (
        <div {...stylex.props(styles.footer, danger && styles.dangerFooter)}>
          {hint && (
            <Text fontSize={13} type="secondary">
              {hint}
            </Text>
          )}
          {action && <div {...stylex.props(styles.action)}>{action}</div>}
        </div>
      )}
    </section>
  );
}
