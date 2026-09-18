'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Alert, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { VerifyParams, VerifyState } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  detail: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  name: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
}));

/**
 * Verification result: one row per constraint check with pass/fail, plus a
 * summary alert. Failed checks stay visible with their detail so the user can
 * see exactly which constraint broke.
 */
const VerifyRender = memo<BuiltinRenderProps<VerifyParams, VerifyState>>(
  ({ pluginState, pluginError }) => {
    const { t } = useTranslation('plugin');

    if (pluginError) {
      return <Alert title={pluginError?.message} type={'error'} />;
    }

    if (!pluginState) return null;

    const { results = [], pass, passed, total } = pluginState;

    return (
      <Flexbox gap={8} style={{ paddingBlock: 4 }}>
        <Alert
          type={pass ? 'success' : 'error'}
          title={
            pass
              ? t('builtins.builtin-solver.render.verifyPass', { passed, total })
              : t('builtins.builtin-solver.render.verifyFail', { failed: total - passed, total })
          }
        />
        <Flexbox gap={4}>
          {results.map((result) => (
            <Flexbox horizontal align={'flex-start'} gap={6} key={result.constraint}>
              <Icon
                color={result.pass ? cssVar.colorSuccess : cssVar.colorError}
                icon={result.pass ? Check : X}
                size={14}
                style={{ marginBlockStart: 3 }}
              />
              <Flexbox gap={2}>
                <Text as={'span'} className={styles.name}>
                  {result.constraint}
                </Text>
                {!result.pass && result.detail && (
                  <Text className={styles.detail}>{result.detail}</Text>
                )}
              </Flexbox>
            </Flexbox>
          ))}
        </Flexbox>
      </Flexbox>
    );
  },
);
VerifyRender.displayName = 'VerifyRender';

export default VerifyRender;
