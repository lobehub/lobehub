import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: 12px;
    border-radius: 10px;
    background: ${cssVar.colorFillQuaternary};
  `,
  description: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  fieldLabel: css`
    flex-shrink: 0;
    inline-size: 56px;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  fieldValue: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  listBlock: css`
    overflow: auto;
    max-block-size: 220px;
  `,
  listItem: css`
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: 6px;
    background: ${cssVar.colorFillTertiary};
  `,
  pathText: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
}));

const OpenManagerCard = memo<BuiltinRenderProps>(({ apiName, args, pluginState }) => {
  const { t } = useTranslation('plugin');

  const path = typeof args?.path === 'string' ? args.path : undefined;
  const prefix = typeof args?.prefix === 'string' ? args.prefix : undefined;
  const listedItems: Array<{ path: string; valueMasked?: string }> = Array.isArray(
    pluginState?.items,
  )
    ? pluginState.items.slice(0, 5)
    : [];
  const listedTotal =
    typeof pluginState?.total === 'number' ? pluginState.total : listedItems.length;

  return (
    <Flexbox className={styles.container} gap={8}>
      <Flexbox gap={6}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Text strong>{t('builtins.lobe-credentials.ui.card.title')}</Text>
          {!!apiName && <Tag>{apiName}</Tag>}
        </Flexbox>
        <span className={styles.description}>
          {t('builtins.lobe-credentials.ui.card.description')}
        </span>
      </Flexbox>

      {!!path && (
        <Flexbox horizontal align={'center'} gap={8}>
          <span className={styles.fieldLabel}>Path</span>
          <span className={styles.fieldValue}>{path}</span>
        </Flexbox>
      )}
      {!!prefix && (
        <Flexbox horizontal align={'center'} gap={8}>
          <span className={styles.fieldLabel}>Prefix</span>
          <span className={styles.fieldValue}>{prefix}</span>
        </Flexbox>
      )}
      {listedItems.length > 0 && (
        <Block className={styles.listBlock} gap={6} padding={8} variant={'outlined'}>
          <Text as={'span'} fontSize={12} type={'secondary'}>
            Matched {listedTotal}
          </Text>
          {listedItems.map((item) => (
            <Flexbox className={styles.listItem} gap={2} key={item.path}>
              <span className={styles.pathText}>{item.path}</span>
              <span className={styles.description}>{item.valueMasked || '******'}</span>
            </Flexbox>
          ))}
        </Block>
      )}
    </Flexbox>
  );
});

OpenManagerCard.displayName = 'OpenManagerCard';

export default OpenManagerCard;
