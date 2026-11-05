import { MessageSquare } from 'lucide-react';
import { motionValue } from 'motion/react';
import { TabItem } from 'verification:component';

const WIDTH = { compact: 110, full: 200, icon: 32, narrow: 70 } as const;

const noop = () => {};

const resolveVariant = (variant: string) => {
  const tier = variant.startsWith('compact')
    ? 'compact'
    : variant.startsWith('narrow')
      ? 'narrow'
      : variant.startsWith('icon') || variant.startsWith('pinned')
        ? 'icon'
        : 'full';
  return {
    active: variant.includes('active'),
    dragging: variant.includes('dragging'),
    pinned: variant.startsWith('pinned'),
    split: variant.includes('split'),
    tier,
    totalCount: variant.includes('lone') ? 1 : 3,
  } as const;
};

export const Fixture = ({ variant }: { variant: string }) => {
  const { active, dragging, pinned, split, tier, totalCount } = resolveVariant(variant);
  const width = WIDTH[tier];
  return (
    <div style={{ height: 26, position: 'relative', width: 240 }}>
      <TabItem
        instant
        drag={dragging ? { grabFraction: 0, maxX: 0, pointerX: motionValue(0) } : undefined}
        enterWidth={width}
        enterX={0}
        index={0}
        isActive={active}
        isSplitVisible={split}
        pinnedCount={pinned ? 1 : 0}
        splitViewEnabled={false}
        tier={tier}
        totalCount={totalCount}
        width={width}
        x={0}
        item={{
          meta: { icon: MessageSquare, title: 'A conversation tab title that is long' },
          tab: { id: 'tab-1', lastVisited: 0, pinned, url: '/agent/fixture' },
        }}
        onActivate={noop}
        onClose={noop}
        onCloseLeft={noop}
        onCloseOthers={noop}
        onCloseRight={noop}
        onCloseSplitView={noop}
        onDragStart={noop}
        onMoveBy={noop}
        onOpenInSplitView={noop}
        onTogglePin={noop}
      />
    </div>
  );
};
