import { Accordion, AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentDocumentsGroup from './AgentDocumentsGroup';

interface ResourcesSectionProps {
  onSelectDocument: (id: string | null) => void;
  selectedDocumentId: string | null;
}

const ResourcesSection = memo<ResourcesSectionProps>(({ onSelectDocument, selectedDocumentId }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox data-testid="workspace-resources" padding={16}>
      <Accordion defaultExpandedKeys={['resources']} gap={0}>
        <AccordionItem
          itemKey={'resources'}
          paddingBlock={2}
          paddingInline={6}
          title={<Text strong>{t('workingPanel.resources')}</Text>}
          styles={{
            header: {
              width: 'fit-content',
            },
          }}
        >
          <Flexbox paddingBlock={8}>
            <AgentDocumentsGroup
              selectedDocumentId={selectedDocumentId}
              onSelectDocument={onSelectDocument}
            />
          </Flexbox>
        </AccordionItem>
      </Accordion>
    </Flexbox>
  );
});

ResourcesSection.displayName = 'ResourcesSection';

export default ResourcesSection;
