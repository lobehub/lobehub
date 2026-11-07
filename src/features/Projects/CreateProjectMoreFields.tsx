import { Button, cssVar, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CreateProjectMoreFieldsProps {
  identifier: string;
  identifierInvalid: boolean;
  onIdentifierChange: (value: string) => void;
  onSlugChange: (value: string) => void;
  onSubmit: () => void;
  slug: string;
  slugValid: boolean;
}

const CreateProjectMoreFields = ({
  identifier,
  identifierInvalid,
  onIdentifierChange,
  onSlugChange,
  onSubmit,
  slug,
  slugValid,
}: CreateProjectMoreFieldsProps) => {
  const { t } = useTranslation('project');
  const [expanded, setExpanded] = useState(false);
  // An invalid value stays visible so its error can't hide behind the fold.
  const open = expanded || identifierInvalid || !slugValid;

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal>
        <Button
          aria-expanded={open}
          icon={<Icon icon={open ? ChevronDownIcon : ChevronRightIcon} />}
          size="small"
          style={{ paddingInline: 0 }}
          type="text"
          onClick={() => setExpanded(!open)}
        >
          {t('create.moreSettings')}
        </Button>
      </Flexbox>
      {open ? (
        <>
          <Flexbox gap={6}>
            <Text fontSize={13} weight={500}>
              {t('create.identifierLabel')}
            </Text>
            <Input
              aria-invalid={identifierInvalid}
              maxLength={6}
              placeholder={t('create.identifierPlaceholder')}
              style={identifierInvalid ? { borderColor: cssVar.colorError } : undefined}
              value={identifier}
              onChange={(event) => onIdentifierChange(event.target.value.toUpperCase())}
              onPressEnter={onSubmit}
            />
            <Text fontSize={12} type={identifierInvalid ? 'danger' : 'secondary'}>
              {t(identifierInvalid ? 'create.identifierInvalid' : 'create.identifierDescription')}
            </Text>
          </Flexbox>
          <Flexbox gap={6}>
            <Text fontSize={13} weight={500}>
              {t('create.slugLabel')}
            </Text>
            <Input
              aria-invalid={!slugValid}
              maxLength={100}
              placeholder={t('create.slugPlaceholder')}
              style={slugValid ? undefined : { borderColor: cssVar.colorError }}
              value={slug}
              onChange={(event) => onSlugChange(event.target.value.toLowerCase())}
              onPressEnter={onSubmit}
            />
            <Text fontSize={12} type={slugValid ? 'secondary' : 'danger'}>
              {t(slugValid ? 'create.slugDescription' : 'create.slugInvalid')}
            </Text>
          </Flexbox>
        </>
      ) : null}
    </Flexbox>
  );
};

export default CreateProjectMoreFields;
