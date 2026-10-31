'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Sparkles } from 'lucide-react';
import { memo } from 'react';

import type { SkillArgs } from '../../../types';

const styles = stylex.create({
  container: { paddingBlock: '4px' },
  header: { paddingInline: '4px', color: cssVar.colorTextSecondary },
  previewBox: {
    overflow: 'hidden',
    paddingBlock: '4px',
    paddingInline: '8px',
    borderRadius: '8px',
    background: cssVar.colorFillTertiary,
  },
});

const Skill = memo<BuiltinRenderProps<SkillArgs>>(({ args, content }) => {
  const skillName = args?.skill;

  return (
    <Flexbox className={stylex.props(styles.container).className} gap={8}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
        gap={8}
      >
        <Icon icon={Sparkles} size={'small'} />
        <Text strong>{skillName || 'Skill'}</Text>
      </Flexbox>

      {content && (
        <Flexbox className={stylex.props(styles.previewBox).className}>
          <Markdown style={{ maxHeight: 240, overflow: 'auto' }} variant={'chat'}>
            {content}
          </Markdown>
        </Flexbox>
      )}
    </Flexbox>
  );
});

Skill.displayName = 'ClaudeCodeSkill';

export default Skill;
