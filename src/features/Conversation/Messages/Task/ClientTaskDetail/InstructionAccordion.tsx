import { Accordion, AccordionItem, Block, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ScrollText } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface InstructionAccordionProps {
  childrenCount: number;
  instruction: string;
}

const InstructionAccordion = memo<InstructionAccordionProps>(({ instruction, childrenCount }) => {
  const { t } = useTranslation('chat');

  // Auto-collapse instruction when children count exceeds threshold
  const [expandedKeys, setExpandedKeys] = useState<string[]>(['instruction']);

  useEffect(() => {
    if (childrenCount > 1) {
      setExpandedKeys([]);
    }
  }, [childrenCount > 1]);

  return (
    <Accordion
      expandedKeys={expandedKeys}
      gap={8}
      onExpandedChange={(keys) => setExpandedKeys(keys as string[])}
    >
      <AccordionItem
        itemKey="instruction"
        paddingBlock={4}
        paddingInline={4}
        title={
          <Flexbox align="center" gap={8} horizontal>
            <Block
              align="center"
              flex="none"
              gap={4}
              height={24}
              horizontal
              justify="center"
              style={{ fontSize: 12 }}
              variant="outlined"
              width={24}
            >
              <Icon color={cssVar.colorTextSecondary} icon={ScrollText} />
            </Block>
            <Text as="span" type="secondary">
              {t('task.instruction')}
            </Text>
          </Flexbox>
        }
      >
        <Block padding={12} style={{ marginBlock: 8, maxHeight: 300, overflow: 'auto' }} variant={'outlined'}>
          <Markdown variant={'chat'}>{instruction}</Markdown>
        </Block>
      </AccordionItem>
    </Accordion>
  );
});

export default InstructionAccordion;
