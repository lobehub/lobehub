import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
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
    min-height: 58px;
    margin-inline: -10px;
    padding-block: 9px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadiusLG};

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
    <Flexbox gap={8}>
      <Flexbox gap={2}>
        <Text className={homeType.sectionLabel}>{t('dashboard.empty.title')}</Text>
        <Text className={homeType.supporting}>{t('dashboard.empty.subtitle')}</Text>
      </Flexbox>
      <Flexbox gap={1}>
        {suggestions.map(({ icon, key }) => {
          const prompt = t(`dashboard.empty.${key}.prompt`);

          return (
            <Block
              clickable
              horizontal
              align={'flex-start'}
              className={styles.row}
              gap={12}
              key={key}
              variant={'borderless'}
              onClick={() => onSelect(prompt)}
            >
              <Flexbox className={styles.icon}>
                <Icon icon={icon} size={18} />
              </Flexbox>
              <Flexbox gap={2}>
                <Text className={homeType.itemTitleProse}>{t(`dashboard.empty.${key}.title`)}</Text>
                <Text className={styles.description} fontSize={13}>
                  {t(`dashboard.empty.${key}.description`)}
                </Text>
              </Flexbox>
            </Block>
          );
        })}
      </Flexbox>
    </Flexbox>
  );
});

EmptySuggestions.displayName = 'EmptySuggestions';

export default EmptySuggestions;
