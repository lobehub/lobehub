'use client';

import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowRight } from 'lucide-react';
import { memo } from 'react';

import type { MoveLocalFilesState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  arrow: css`
    color: ${cssVar.colorTextSecondary};
  `,
  container: css`
    overflow: hidden;
    padding-inline: 8px 0;
  `,
  header: css`
    font-size: 12px;
  `,
  moveItem: css`
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: 4px;
  `,
  statusIcon: css`
    font-size: 12px;
  `,
}));

interface MoveLocalFilesParams {
  operations: Array<{
    destination: string;
    source: string;
  }>;
}

const MoveLocalFiles = memo<BuiltinRenderProps<MoveLocalFilesParams, MoveLocalFilesState>>(
  ({ pluginState }) => {
    if (!pluginState?.results) {
      return null;
    }

    const allSuccess = pluginState.successCount === pluginState.totalCount;

    return (
      <Flexbox className={styles.container} gap={8}>
        {/* Header */}
        <Flexbox horizontal align={'center'} gap={8}>
          {allSuccess ? (
            <CheckCircleFilled
              className={styles.statusIcon}
              style={{ color: cssVar.colorSuccess }}
            />
          ) : (
            <CloseCircleFilled className={styles.statusIcon} style={{ color: cssVar.colorError }} />
          )}
          <Text className={styles.header}>
            Moved {pluginState.successCount}/{pluginState.totalCount} items
          </Text>
        </Flexbox>

        {/* Move operations list */}
        <Block padding={8} style={{ maxHeight: 300, overflow: 'auto' }} variant={'outlined'}>
          <Flexbox gap={4}>
            {pluginState.results.map((result, index) => (
              <Flexbox
                horizontal
                align={'center'}
                className={styles.moveItem}
                gap={8}
                key={index}
                style={{
                  background: result.success ? cssVar.colorSuccessBg : cssVar.colorErrorBg,
                }}
              >
                {result.success ? (
                  <CheckCircleFilled style={{ color: cssVar.colorSuccess, fontSize: 12 }} />
                ) : (
                  <CloseCircleFilled style={{ color: cssVar.colorError, fontSize: 12 }} />
                )}
                <Text code ellipsis as={'span'} fontSize={11} style={{ maxWidth: 200 }}>
                  {result.source}
                </Text>
                <ArrowRight className={styles.arrow} size={12} />
                <Text code ellipsis as={'span'} fontSize={11} style={{ maxWidth: 200 }}>
                  {result.destination}
                </Text>
                {result.error && (
                  <Text code as={'span'} fontSize={11} type={'danger'}>
                    ({result.error})
                  </Text>
                )}
              </Flexbox>
            ))}
          </Flexbox>
        </Block>
      </Flexbox>
    );
  },
);

MoveLocalFiles.displayName = 'MoveLocalFiles';

export default MoveLocalFiles;
