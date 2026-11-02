import { useTranslation } from 'react-i18next';

import { ToggleChip } from '../components/OptionChips';
import { type FieldType } from './type';

interface TextOptionsProps {
  onChange: (value: FieldType) => void;
  value: FieldType;
}

const TextOptions = ({ onChange, value }: TextOptionsProps) => {
  const { t } = useTranslation('chat');

  const options: { key: keyof FieldType; label: string }[] = [
    { key: 'withSystemRole', label: t('shareModal.options.agentProfile') },
    { key: 'withRole', label: t('shareModal.options.messageRoles') },
    { key: 'includeUser', label: t('shareModal.options.userMessages') },
    { key: 'includeTool', label: t('shareModal.options.skillMessages') },
  ];

  return options.map(({ key, label }) => (
    <ToggleChip
      checked={value[key]}
      key={key}
      label={label}
      onChange={(checked) => onChange({ ...value, [key]: checked })}
    />
  ));
};

export default TextOptions;
