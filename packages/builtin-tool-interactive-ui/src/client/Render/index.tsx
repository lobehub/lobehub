import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { NativeUIDocumentSchema } from '../../native/schema';
import { LegacyRenderUIParamsSchema } from '../../schema';
import type { RenderUIState } from '../../types';
import { NativeWidget } from './NativeWidget';
import { InteractiveWidget } from './Widget';

const styles = createStaticStyles(({ css, cssVar }) => ({
  details: css`
    min-width: 0;
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};

    summary {
      cursor: pointer;
    }
  `,
  diagnostic: css`
    overflow: auto;
    max-height: 240px;
    margin: 8px 0 0;

    font-family: inherit;
    font-size: inherit;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  `,
}));

export const RenderUI = ({
  args,
  content,
  messageId,
  pluginState,
  readOnly,
}: BuiltinRenderProps<unknown, RenderUIState>) => {
  const { t } = useTranslation('plugin');
  // Version 1 remains readable for historical artifacts, but is no longer
  // advertised or accepted by the tool's execution path.
  const native = NativeUIDocumentSchema.safeParse(args);
  if (native.success && pluginState?.status === 'ready' && pluginState.version === 2) {
    return (
      <NativeWidget
        document={native.data}
        key={`${messageId}:native`}
        messageId={messageId}
        readOnly={!!readOnly}
        saved={pluginState.values}
      />
    );
  }
  const parsed = LegacyRenderUIParamsSchema.safeParse(args);
  if (!parsed.success || pluginState?.status !== 'ready' || pluginState.version !== 1) {
    const details = typeof content === 'string' ? content.slice(0, 2_000).trim() : '';
    return (
      <Flexbox gap={8} style={{ minWidth: 0 }}>
        <Flexbox horizontal align="center" gap={8} role="status">
          <Icon aria-hidden icon={CircleAlert} size={16} />
          <Text type="secondary">{t('builtins.lobe-interactive-ui.invalid')}</Text>
        </Flexbox>
        {details && (
          <details className={styles.details}>
            <summary>{t('builtins.lobe-interactive-ui.details')}</summary>
            <pre className={styles.diagnostic}>{details}</pre>
          </details>
        )}
      </Flexbox>
    );
  }
  return (
    <InteractiveWidget
      key={messageId}
      messageId={messageId}
      readOnly={!!readOnly}
      source={parsed.data}
    />
  );
};
