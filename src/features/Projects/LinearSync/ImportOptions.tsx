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
  includeArchived: boolean;
  onIncludeArchivedChange: (checked: boolean) => void;
  onSyncCommentsChange: (checked: boolean) => void;
  syncComments: boolean;
}

interface OptionProps {
  checked: boolean;
  desc: string;
  label: string;
  onChange: (checked: boolean) => void;
}

const Option = memo<OptionProps>(({ checked, desc, label, onChange }) => (
  <label {...stylex.props(styles.option)}>
    <Flexbox horizontal align={'flex-start'} gap={8}>
      <Checkbox checked={checked} style={{ marginBlockStart: 2 }} onChange={onChange} />
      <Flexbox gap={2} style={{ minWidth: 0 }}>
        <Text>{label}</Text>
        <Text fontSize={12} type={'secondary'}>
          {desc}
        </Text>
      </Flexbox>
    </Flexbox>
  </label>
));

Option.displayName = 'LinearImportOption';

/** What an import brings along besides the issues themselves. */
const ImportOptions = memo<ImportOptionsProps>(
  ({ includeArchived, onIncludeArchivedChange, onSyncCommentsChange, syncComments }) => {
    const { t } = useTranslation('integration');

    return (
      <Flexbox gap={8}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('linear.sync.options.importTitle')}
        </Text>
        <Flexbox gap={12} {...stylex.props(styles.group)}>
          <Option
            checked={syncComments}
            desc={t('linear.sync.options.syncCommentsDesc')}
            label={t('linear.sync.options.syncComments')}
            onChange={onSyncCommentsChange}
          />
          <Option
            checked={includeArchived}
            desc={t('linear.sync.options.includeArchivedDesc')}
            label={t('linear.sync.options.includeArchived')}
            onChange={onIncludeArchivedChange}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

ImportOptions.displayName = 'LinearImportOptions';

export default ImportOptions;
