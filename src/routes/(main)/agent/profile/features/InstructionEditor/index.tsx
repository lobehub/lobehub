'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import EditorCanvas from '../EditorCanvas';

/**
 * The Instruction page: the agent's core prompt, on a page of its own. Heterogeneous agents
 * (Claude Code, Codex, …) run an external CLI with its own system prompt, so the sidebar does
 * not offer this page for them rather than showing a control that looks effective but isn't.
 */
const InstructionEditor = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox paddingBlock={'8px 48px'}>
      <EditorCanvas
        description={<Text type={'secondary'}>{t('settingAgent.instruction.description')}</Text>}
        title={
          <Text fontSize={24} weight={600}>
            {t('settingAgent.instruction.title')}
          </Text>
        }
      />
    </Flexbox>
  );
});

InstructionEditor.displayName = 'InstructionEditor';

export default InstructionEditor;
