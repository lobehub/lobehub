import { Block, Center, cssVar, Flexbox } from '@lobehub/ui';

import { SkeletonBar } from '@/components/Skeleton';

import { virtuosoGridStyles } from './style';

/** Enough cards to fill the 60vh list on a tall viewport; overflow is clipped. */
const CARD_COUNT = 16;

const CardSkeleton = ({ index }: { index: number }) => (
  <Block
    horizontal
    align={'center'}
    gap={12}
    paddingBlock={12}
    paddingInline={12}
    variant={'outlined'}
  >
    <SkeletonBar height={40} radius={cssVar.borderRadius} width={40} />
    <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
      {/* Line boxes measured on the settled card: 22px title, 18.8px description. */}
      <Flexbox height={22} justify={'center'}>
        <SkeletonBar height={14} width={['48%', '36%', '56%', '42%'][index % 4]} />
      </Flexbox>
      <Flexbox height={18.8} justify={'center'}>
        <SkeletonBar height={12} width={['88%', '72%', '80%'][index % 3]} />
      </Flexbox>
    </Flexbox>
    {/* Install / more action icon slot. */}
    <Center flex={'none'} height={36} width={36}>
      <SkeletonBar height={16} radius={4} width={16} />
    </Center>
  </Block>
);

/**
 * Skill Store list placeholder: the same 60vh box and two-column wrap grid as the
 * loaded `VirtuosoGrid`, filled with outlined cards shaped like the skill / MCP
 * item (40px avatar, title over a shorter description, action slot), so results
 * replace the cards in place on first load and on every search.
 */
const Loading = () => (
  <div aria-busy style={{ height: '60vh', overflow: 'hidden', width: '100%' }}>
    <div className={virtuosoGridStyles.list}>
      {Array.from({ length: CARD_COUNT }).map((_, index) => (
        <div className={virtuosoGridStyles.item} key={index}>
          <CardSkeleton index={index} />
        </div>
      ))}
    </div>
  </div>
);

export default Loading;
