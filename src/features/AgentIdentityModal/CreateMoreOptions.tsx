'use client';

import { Accordion, cssVar, Flexbox, Text } from '@lobehub/ui';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ITEM_KEY = 'more';

interface CreateMoreOptionsProps {
  children: ReactNode;
  /**
   * The form's current field error. A new one opens the section, so a refused
   * slug is never hidden behind a collapsed header.
   */
  error?: string;
  /**
   * A short reading of what the folded fields currently hold (e.g. the
   * visibility), so a choice that matters is not invisible while collapsed.
   */
  summary?: ReactNode;
}

/**
 * Optional details of a new agent (description, slug, visibility), collapsed by
 * default so the main path is just "name it and create".
 */
const CreateMoreOptions = memo<CreateMoreOptionsProps>(({ children, error, summary }) => {
  const { t } = useTranslation('setting');
  const [expanded, setExpanded] = useState(false);
  const [revealedError, setRevealedError] = useState<string>();

  // Open once per new error, during render rather than in an effect, so the
  // error never paints collapsed. The user can still fold the section back.
  if (error !== revealedError) {
    setRevealedError(error);
    if (error) setExpanded(true);
  }

  return (
    <Accordion
      gap={0}
      indicatorPlacement={'inline'}
      styles={{ header: { paddingBlock: 4, paddingInline: 0 } }}
      value={expanded ? [ITEM_KEY] : []}
      items={[
        {
          children: (
            <Flexbox gap={20} paddingBlock={'12px 0'}>
              {children}
            </Flexbox>
          ),
          key: ITEM_KEY,
          title: (
            <Flexbox horizontal align={'center'} gap={8}>
              <Text style={{ color: cssVar.colorTextSecondary }}>
                {t('settingAgent.identity.moreOptions')}
              </Text>
              {summary && !expanded && (
                <Text fontSize={12} type={'secondary'}>
                  · {summary}
                </Text>
              )}
            </Flexbox>
          ),
        },
      ]}
      onValueChange={(value) => setExpanded(value.includes(ITEM_KEY))}
    />
  );
});

CreateMoreOptions.displayName = 'CreateMoreOptions';

export default CreateMoreOptions;
