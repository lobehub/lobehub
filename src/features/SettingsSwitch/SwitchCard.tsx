'use client';

import { Block, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { ChevronRightIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { Link } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { isModifierClick } from '@/utils/navigation';

interface SettingsSwitchCardProps {
  avatar: ReactNode;
  /** Literal path that already carries its space prefix. */
  href: string;
  title: string;
}

/**
 * The card pinned to the bottom of a settings sidebar. It names the other
 * settings set and opens it in one click.
 */
const SettingsSwitchCard = memo<SettingsSwitchCardProps>(({ avatar, href, title }) => {
  const navigate = useWorkspaceAwareNavigate();

  return (
    <Flexbox flex={'none'} paddingBlock={8} paddingInline={8}>
      <Link
        data-testid={'settings-switch-card'}
        to={href}
        onClick={(e) => {
          if (isModifierClick(e)) return;
          e.preventDefault();
          navigate(href, { escape: true });
        }}
      >
        <Block
          clickable
          horizontal
          align={'center'}
          gap={8}
          paddingBlock={8}
          paddingInline={10}
          variant={'outlined'}
        >
          <Flexbox flex={'none'}>{avatar}</Flexbox>
          <Text ellipsis style={{ flex: 1 }} weight={500}>
            {title}
          </Text>
          <Icon color={cssVar.colorTextDescription} icon={ChevronRightIcon} />
        </Block>
      </Link>
    </Flexbox>
  );
});

SettingsSwitchCard.displayName = 'SettingsSwitchCard';

export default SettingsSwitchCard;
