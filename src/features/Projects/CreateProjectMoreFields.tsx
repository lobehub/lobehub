import { Button, cssVar, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CreateProjectMoreFieldsProps {
  identifier: string;
  identifierInvalid: boolean;
  /** The identifier is valid but already claimed in this scope. */
  identifierTaken: boolean;
  onIdentifierChange: (value: string) => void;
  onSlugChange: (value: string) => void;
  onSubmit: () => void;
  slug: string;
  /** The slug is well-formed but already claimed in this scope. */
  slugTaken: boolean;
  slugValid: boolean;
}

const CreateProjectMoreFields = ({
  identifier,
  identifierInvalid,
  identifierTaken,
  onIdentifierChange,
  onSlugChange,
  onSubmit,
  slug,
  slugTaken,
  slugValid,
}: CreateProjectMoreFieldsProps) => {
  const { t } = useTranslation('project');
  const [expanded, setExpanded] = useState(false);
  // An invalid value stays visible so its error can't hide behind the fold.
  const identifierError = identifierInvalid || identifierTaken;
  const slugError = !slugValid || slugTaken;
  const open = expanded || identifierError || slugError;

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
              aria-invalid={identifierError}
              maxLength={6}
              placeholder={t('create.identifierPlaceholder')}
              style={identifierError ? { borderColor: cssVar.colorError } : undefined}
              value={identifier}
              onChange={(event) => onIdentifierChange(event.target.value.toUpperCase())}
              onPressEnter={onSubmit}
            />
            <Text fontSize={12} type={identifierError ? 'danger' : 'secondary'}>
              {t(
                identifierInvalid
                  ? 'create.identifierInvalid'
                  : identifierTaken
                    ? 'create.identifierTaken'
                    : 'create.identifierDescription',
              )}
            </Text>
          </Flexbox>
          <Flexbox gap={6}>
            <Text fontSize={13} weight={500}>
              {t('create.slugLabel')}
            </Text>
            <Input
              aria-invalid={slugError}
              maxLength={100}
              placeholder={t('create.slugPlaceholder')}
              style={slugError ? { borderColor: cssVar.colorError } : undefined}
              value={slug}
              onChange={(event) => onSlugChange(event.target.value.toLowerCase())}
              onPressEnter={onSubmit}
            />
            <Text fontSize={12} type={slugError ? 'danger' : 'secondary'}>
              {t(
                slugValid
                  ? slugTaken
                    ? 'create.slugTaken'
                    : 'create.slugDescription'
                  : 'create.slugInvalid',
              )}
            </Text>
          </Flexbox>
        </>
      ) : null}
    </Flexbox>
  );
};

export default CreateProjectMoreFields;
