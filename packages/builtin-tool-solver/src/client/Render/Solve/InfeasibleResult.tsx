'use client';

import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SolverConflict } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  detail: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
}));

export const InfeasibleResult = memo<{ conflicts: SolverConflict[] }>(({ conflicts }) => {
  const { t } = useTranslation('plugin');

  return (
    <Flexbox gap={12}>
      {conflicts.map((conflict, index) => (
        <Flexbox gap={4} key={`${conflict.constraint}-${index}`}>
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            <Tag color={'warning'} style={{ marginInlineEnd: 0 }}>
              {conflict.constraint}
            </Tag>
            {conflict.involvedFields?.map((field) => (
              <Text as={'span'} className={styles.mono} key={field}>
                $.{field}
              </Text>
            ))}
          </Flexbox>
          <Text className={styles.detail}>{conflict.explanation}</Text>
          {conflict.suggestedRelaxations && conflict.suggestedRelaxations.length > 0 && (
            <Flexbox gap={2}>
              <Text as={'span'} className={styles.detail} style={{ fontWeight: 500 }}>
                {t('builtins.builtin-solver.render.suggestedRelaxations')}:
              </Text>
              {conflict.suggestedRelaxations.map((suggestion) => (
                <Text className={styles.detail} key={suggestion}>
                  · {suggestion}
                </Text>
              ))}
            </Flexbox>
          )}
        </Flexbox>
      ))}
    </Flexbox>
  );
});
InfeasibleResult.displayName = 'InfeasibleResult';

export default InfeasibleResult;
