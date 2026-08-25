import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { FileTextIcon, ListTodoIcon, SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { homeType } from './components/homeType';

const styles = createStaticStyles(({ css, cssVar }) => ({
  description: css`
    color: ${cssVar.colorTextTertiary};
  `,
  icon: css`
    flex: none;
    padding-block-start: 2px;
    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    justify-content: flex-start;

    width: calc(100% + 20px);
    height: auto;
    min-height: 58px;
    margin-inline: -10px;
    padding-block: 9px;
    padding-inline: 10px;
    border: 0;
    border-radius: ${cssVar.borderRadiusLG};

    text-align: start;
    white-space: normal;

    transition: background ${cssVar.motionDurationFast};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));

const suggestions = [
  { icon: FileTextIcon, key: 'summarize' },
  { icon: ListTodoIcon, key: 'plan' },
  { icon: SearchIcon, key: 'research' },
] as const;

interface EmptySuggestionsProps {
  onSelect: (prompt: string) => void;
}

const EmptySuggestions = memo<EmptySuggestionsProps>(({ onSelect }) => {
  const { t } = useTranslation('home');

  return (
    // Inset from the column edge: the composer above and the list rows below
    // are both padded surfaces, so a flush-left block here reads as hanging
    // outside the page's own rhythm.
    <Flexbox gap={12} paddingBlock={8} paddingInline={12}>
      <Flexbox gap={2}>
        <Text className={homeType.sectionLabel}>{t('dashboard.empty.title')}</Text>
        <Text className={homeType.supporting}>{t('dashboard.empty.subtitle')}</Text>
      </Flexbox>
      <Flexbox gap={1}>
        {suggestions.map(({ icon, key }) => {
          const prompt = t(`dashboard.empty.${key}.prompt`);

          return (
            <Button className={styles.row} key={key} type={'text'} onClick={() => onSelect(prompt)}>
              <Flexbox horizontal align={'flex-start'} gap={12} style={{ width: '100%' }}>
                <Flexbox className={styles.icon}>
                  <Icon icon={icon} size={18} />
                </Flexbox>
                <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Text className={homeType.itemTitleProse}>
                    {t(`dashboard.empty.${key}.title`)}
                  </Text>
                  <Text className={styles.description} fontSize={13}>
                    {t(`dashboard.empty.${key}.description`)}
                  </Text>
                </Flexbox>
              </Flexbox>
            </Button>
          );
        })}
      </Flexbox>
    </Flexbox>
  );
});

EmptySuggestions.displayName = 'EmptySuggestions';

export default EmptySuggestions;
