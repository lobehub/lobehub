'use client';

import { Checkbox, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  group: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderRadius: cssVar.borderRadiusLG,
    paddingBlock: 12,
    paddingInline: 12,
  },
  option: {
    cursor: 'pointer',
  },
});

interface ImportOptionsProps {
  disabled?: boolean;
  onSyncCommentsChange: (checked: boolean) => void;
  syncComments: boolean;
}

/** What an import brings along besides the issues themselves. */
const ImportOptions = memo<ImportOptionsProps>(
  ({ disabled, onSyncCommentsChange, syncComments }) => {
    const { t } = useTranslation('integration');

    return (
      <Flexbox gap={8}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('linear.sync.options.importTitle')}
        </Text>
        <div {...stylex.props(styles.group)}>
          <label {...stylex.props(styles.option)}>
            <Flexbox horizontal align={'flex-start'} gap={8}>
              <Checkbox
                checked={syncComments}
                disabled={disabled}
                style={{ marginBlockStart: 2 }}
                onChange={onSyncCommentsChange}
              />
              <Flexbox gap={2} style={{ minWidth: 0 }}>
                <Text>{t('linear.sync.options.syncComments')}</Text>
                <Text fontSize={12} type={'secondary'}>
                  {t('linear.sync.options.syncCommentsDesc')}
                </Text>
              </Flexbox>
            </Flexbox>
          </label>
        </div>
      </Flexbox>
    );
  },
);

ImportOptions.displayName = 'LinearImportOptions';

export default ImportOptions;
