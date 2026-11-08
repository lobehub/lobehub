import { Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

import { settingsStyles as styles } from './styles';

interface FormCardProps {
  action?: ReactNode;
  children?: ReactNode;
  danger?: boolean;
  description?: string;
  hint?: ReactNode;
  title: string;
}

/** One setting: what it is and its control above, its hint and commit button in a footer bar. */
export function FormCard({ action, children, danger, description, hint, title }: FormCardProps) {
  return (
    <section {...stylex.props(styles.card, danger && styles.dangerCard)}>
      <div {...stylex.props(styles.body)}>
        <div>
          <Text as="h3" fontSize={18} style={{ margin: 0 }} weight={600}>
            {title}
          </Text>
          {description && <Text type="secondary">{description}</Text>}
        </div>
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
