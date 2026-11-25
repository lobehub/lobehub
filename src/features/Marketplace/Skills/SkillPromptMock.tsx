import { Text } from '@lobehub/ui';
import { Grainient } from '@lobehub/ui/awesome';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_SKILL_GRADIENT, getSkillCategoryStyle } from './skillCategoryStyle';
import SkillIcon from './SkillIcon';
import SkillPromptSend from './SkillPromptSend';
import type { SkillAgent } from './useSkillAgents';

const styles = stylex.create({
  backdrop: {
    position: 'absolute',
    inset: 0,
  },
  chip: {
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    gap: 6,
    maxWidth: '50%',
    paddingBlock: 2,
    paddingInlineStart: 4,
    paddingInlineEnd: 8,
    borderRadius: 6,
    backgroundColor: cssVar.colorFillSecondary,
  },
  input: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: 'min(100%, 560px)',
    paddingBlock: 8,
    paddingInlineStart: 12,
    paddingInlineEnd: 8,
    borderRadius: 14,
    backgroundColor: cssVar.colorBgElevated,
    boxShadow: '0 8px 24px rgb(0 0 0 / 18%)',
  },
  root: {
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 168,
    paddingInline: 32,
    borderRadius: 16,
    userSelect: 'none',
  },
  send: {
    display: 'flex',
    flex: 'none',
  },
});

interface SkillPromptMockProps {
  /** Assistants that have the skill on; they decide what the end button does. */
  agents: SkillAgent[];
  category?: string | null;
  identifier: string;
  name: string;
}

/**
 * A picture of the skill in use: the chat box with the skill tagged and a
 * one-line ask, over a grain gradient in the skill category's colors (full
 * colors in the light theme too; washed toward white they read grey). Only the
 * end button acts: copy the message, or send it to an assistant.
 */
const SkillPromptMock = memo<SkillPromptMockProps>(({ agents, category, identifier, name }) => {
  const { t } = useTranslation('setting');
  const [color1, color2, color3] =
    getSkillCategoryStyle(category)?.gradient ?? DEFAULT_SKILL_GRADIENT;

  return (
    <div {...stylex.props(styles.root)}>
      <Grainient
        aria-hidden
        color1={color1}
        color2={color2}
        color3={color3}
        contrast={1.2}
        grainAmount={0.06}
        lightMode={false}
        timeSpeed={0.15}
        {...stylex.props(styles.backdrop)}
      />
      <div {...stylex.props(styles.input)}>
        <span {...stylex.props(styles.chip)}>
          <SkillIcon category={category} size={18} />
          <Text ellipsis fontSize={13} weight={500}>
            {name}
          </Text>
        </span>
        <Text ellipsis style={{ flex: 1 }}>
          {t('market.skills.mockPrompt')}
        </Text>
        <span {...stylex.props(styles.send)}>
          <SkillPromptSend agents={agents} identifier={identifier} name={name} />
        </span>
      </div>
    </div>
  );
});

SkillPromptMock.displayName = 'MarketSkillPromptMock';

export default SkillPromptMock;
