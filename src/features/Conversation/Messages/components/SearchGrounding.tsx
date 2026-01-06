import { Flexbox, Icon, SearchResultCards, Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx, useThemeMode } from 'antd-style';
import { ChevronDown, ChevronRight, Globe } from 'lucide-react';
import { AnimatePresence, m as motion } from 'motion/react';
import Image from 'next/image';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type GroundingSearch } from '@/types/search';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    width: fit-content;
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: 6px;

    color: ${cssVar.colorTextTertiary};
  `,
  containerDark: css`
    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  containerLight: css`
    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  expandDark: css`
    background: ${cssVar.colorFillQuaternary} !important;
  `,
  expandLight: css`
    background: ${cssVar.colorFillTertiary} !important;
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    font-size: 12px;
    text-overflow: ellipsis;
  `,
}));

const SearchGrounding = memo<GroundingSearch>(({ searchQueries, citations }) => {
  const { t } = useTranslation('chat');
  const { isDarkMode } = useThemeMode();

  const [showDetail, setShowDetail] = useState(false);

  return (
    <Flexbox
      className={cx(
        styles.container,
        isDarkMode ? styles.containerDark : styles.containerLight,
        showDetail && (isDarkMode ? styles.expandDark : styles.expandLight),
      )}
      gap={16}
      style={{ width: showDetail ? '100%' : undefined }}
    >
      <Flexbox
        distribution={'space-between'}
        flex={1}
        gap={8}
        horizontal
        onClick={() => {
          setShowDetail(!showDetail);
        }}
        style={{ cursor: 'pointer' }}
      >
        <Flexbox align={'center'} gap={8} horizontal>
          <Icon icon={Globe} />
          <Flexbox horizontal>{t('search.grounding.title', { count: citations?.length })}</Flexbox>
          {!showDetail && (
            <Flexbox horizontal>
              {citations?.slice(0, 8).map((item, index) => (
                <Image
                  alt={item.title || item.url}
                  height={16}
                  key={`${item.url}-${index}`}
                  src={`https://icons.duckduckgo.com/ip3/${new URL(item.url).host}.ico`}
                  style={{
                    background: cssVar.colorBgContainer,
                    borderRadius: 8,
                    marginInline: -2,
                    padding: 2,
                    zIndex: 100 - index,
                  }}
                  unoptimized
                  width={16}
                />
              ))}
            </Flexbox>
          )}
        </Flexbox>

        <Flexbox gap={4} horizontal>
          <Icon icon={showDetail ? ChevronDown : ChevronRight} />
        </Flexbox>
      </Flexbox>

      <AnimatePresence initial={false}>
        {showDetail && (
          <motion.div
            animate="open"
            exit="collapsed"
            initial="collapsed"
            style={{ overflow: 'hidden', width: '100%' }}
            transition={{
              duration: 0.2,
              ease: [0.4, 0, 0.2, 1], // 使用 ease-out 缓动函数
            }}
            variants={{
              collapsed: { height: 0, opacity: 0, width: 'auto' },
              open: { height: 'auto', opacity: 1, width: 'auto' },
            }}
          >
            <Flexbox gap={12}>
              {searchQueries && (
                <Flexbox gap={4} horizontal>
                  {t('search.grounding.searchQueries')}
                  <Flexbox gap={8} horizontal>
                    {searchQueries.map((query, index) => (
                      <Tag key={index}>{query}</Tag>
                    ))}
                  </Flexbox>
                </Flexbox>
              )}
              {citations && <SearchResultCards dataSource={citations} />}
            </Flexbox>
          </motion.div>
        )}
      </AnimatePresence>
    </Flexbox>
  );
});

export default SearchGrounding;
