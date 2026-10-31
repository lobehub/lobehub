import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FileTextIcon, ListTodoIcon, SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { homeType } from './components/homeType';

const styles = stylex.create({
  description: { color: cssVar.colorTextTertiary },
  icon: { flex: 'none', paddingBlockStart: '2px', color: cssVar.colorTextSecondary },
  row: {
    justifyContent: 'flex-start',
    width: 'calc(100% + 20px)',
    height: 'auto',
    minHeight: '58px',
    marginInline: '-10px',
    paddingBlock: '9px',
    paddingInline: '10px',
    borderStyle: 'none',
    borderRadius: cssVar.borderRadiusLG,
    textAlign: 'start',
    whiteSpace: 'normal',
    transition: `background ${cssVar.motionDurationFast}`,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

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
        <Text className={stylex.props(homeType.sectionLabel).className}>
          {t('dashboard.empty.title')}
        </Text>
        <Text className={stylex.props(homeType.supporting).className}>
          {t('dashboard.empty.subtitle')}
        </Text>
      </Flexbox>
      <Flexbox gap={1}>
        {suggestions.map(({ icon, key }) => {
          const prompt = t(`dashboard.empty.${key}.prompt`);

          return (
            <Button
              className={stylex.props(styles.row).className}
              key={key}
              type={'text'}
              onClick={() => onSelect(prompt)}
            >
              <Flexbox horizontal align={'flex-start'} gap={12} style={{ width: '100%' }}>
                <Flexbox className={stylex.props(styles.icon).className}>
                  <Icon icon={icon} size={18} />
                </Flexbox>
                <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Text className={stylex.props(homeType.itemTitleProse).className}>
                    {t(`dashboard.empty.${key}.title`)}
                  </Text>
                  <Text className={stylex.props(styles.description).className} fontSize={13}>
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
