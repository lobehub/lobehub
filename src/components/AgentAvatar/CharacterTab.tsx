'use client';

import {
  AgentAvatar as GeneratedAgentAvatar,
  type EmojiPickerProps,
  Icon,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BotIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { agentCharacterOptions } from './characters';

type EmojiPickerCustomTab = NonNullable<EmojiPickerProps['customTabs']>[number];

const TILE_SIZE = 48;
const CHARACTER_SIZE = 40;

const styles = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: `repeat(6, ${TILE_SIZE}px)`,
    gap: '6px',
    padding: '6px',
  },
  tile: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${TILE_SIZE}px`,
    height: `${TILE_SIZE}px`,
    padding: 0,
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillTertiary,
    },
    backgroundImage: 'none',
    outline: {
      'default': 'none',
      ':focus-visible': `2px solid ${cssVar.colorPrimaryBorder}`,
    },
    transition: `background-color ${cssVar.motionDurationFast}`,
  },
  selected: {
    borderColor: cssVar.colorPrimary,
    backgroundColor: {
      'default': cssVar.colorFillSecondary,
      ':hover': cssVar.colorFillSecondary,
    },
  },
});

interface AgentCharacterGridProps {
  onSelect: (avatar: string) => void;
  /** The current avatar; marks the character it picked. */
  value?: string | null;
}

/**
 * The fixed set of generated characters. Picking one stores `generated:<seed>`,
 * so the agent keeps that character instead of the one its id would draw.
 */
export const AgentCharacterGrid = ({ onSelect, value }: AgentCharacterGridProps) => {
  const { t } = useTranslation('setting');

  return (
    <div {...stylex.props(styles.grid)} aria-label={t('settingAgent.avatar.characters')}>
      {agentCharacterOptions(value).map(({ avatar, seed, selected }, index) => (
        <button
          aria-label={t('settingAgent.avatar.character', { index: index + 1 })}
          aria-pressed={selected}
          key={seed}
          type={'button'}
          {...stylex.props(styles.tile, selected && styles.selected)}
          onClick={() => onSelect(avatar)}
        >
          <GeneratedAgentAvatar seed={seed} size={CHARACTER_SIZE} />
        </button>
      ))}
    </div>
  );
};

/** Value of the characters tab among the emoji picker's tabs. */
export const AGENT_CHARACTER_TAB = 'characters';

/**
 * The emoji picker tab that offers the generated characters. Picking one goes
 * through the picker's own change handler, so it saves and closes like an emoji.
 */
export const useAgentCharacterTab = (value?: string | null): EmojiPickerCustomTab => {
  const { t } = useTranslation('setting');

  return {
    label: (
      <Tooltip title={t('settingAgent.avatar.characters')}>
        <Icon icon={BotIcon} size={{ size: 20, strokeWidth: 2.5 }} />
      </Tooltip>
    ),
    render: (onChange) => <AgentCharacterGrid value={value} onSelect={onChange} />,
    value: AGENT_CHARACTER_TAB,
  };
};
