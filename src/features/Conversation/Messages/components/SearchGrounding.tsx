import { Flexbox, Icon, SearchResultCards, Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDown, ChevronRight, Globe, Images } from 'lucide-react';
import { AnimatePresence, m as motion } from 'motion/react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';
import Image from '@/libs/next/Image';
import { type GroundingSearch } from '@/types/search';

const stripHtml = (html: string) =>
  html
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ');

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
  imageCard: css`
    overflow: hidden;
    border-radius: 8px;
  `,
  imageCardLink: css`
    color: inherit;
    text-decoration: none;
    transition: opacity 0.2s;

    &:hover {
      opacity: 0.75;
    }
  `,
  imageDomain: css`
    overflow: hidden;

    font-size: 11px;
    line-height: 1;
    color: ${cssVar.colorTextQuaternary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  imageGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
  `,
  imageThumb: css`
    display: block;
    width: 100%;
    height: 80px;
    object-fit: cover;
  `,
  imageThumbWrap: css`
    overflow: hidden;
    display: block;
    flex-shrink: 0;

    height: 80px;
    border-radius: 6px;
  `,
  imageTitle: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 11px;
    line-height: 1.4;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
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

const SearchGrounding = memo<GroundingSearch>(
  ({ searchQueries, citations, imageResults, imageSearchQueries }) => {
    const { t } = useTranslation('chat');
    const isDarkMode = useIsDark();

    const [showDetail, setShowDetail] = useState(false);

    const hasWebResults = !!citations?.length;
    const hasImageResults = !!imageResults?.length;
    const titleIcon = !hasWebResults && hasImageResults ? Images : Globe;
    const titleText = hasWebResults
      ? t('search.grounding.title', { count: citations?.length })
      : t('search.grounding.imageTitle', { count: imageResults?.length });

    return (
      <Flexbox
        gap={16}
        style={{ width: showDetail ? '100%' : undefined }}
        className={cx(
          styles.container,
          isDarkMode ? styles.containerDark : styles.containerLight,
          showDetail && (isDarkMode ? styles.expandDark : styles.expandLight),
        )}
      >
        <Flexbox
          horizontal
          distribution={'space-between'}
          flex={1}
          gap={8}
          style={{ cursor: 'pointer' }}
          onClick={() => {
            setShowDetail(!showDetail);
          }}
        >
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon icon={titleIcon} />
            <Flexbox horizontal>{titleText}</Flexbox>
            {!showDetail && hasWebResults && (
              <Flexbox horizontal>
                {citations?.slice(0, 8).map((item, index) => (
                  <Image
                    unoptimized
                    alt={item.title || item.url}
                    height={16}
                    key={`${item.url}-${index}`}
                    src={`https://icons.duckduckgo.com/ip3/${item.favicon || new URL(item.url).host}.ico`}
                    width={16}
                    style={{
                      background: cssVar.colorBgContainer,
                      borderRadius: 8,
                      marginInline: -2,
                      padding: 2,
                      zIndex: 100 - index,
                    }}
                  />
                ))}
              </Flexbox>
            )}
            {!showDetail && !hasWebResults && hasImageResults && (
              <Flexbox horizontal>
                {imageResults?.slice(0, 8).map((item, index) => (
                  <Image
                    unoptimized
                    alt={item.domain || ''}
                    height={16}
                    key={`${item.domain}-${index}`}
                    src={`https://icons.duckduckgo.com/ip3/${item.domain || ''}.ico`}
                    width={16}
                    style={{
                      background: cssVar.colorBgContainer,
                      borderRadius: 8,
                      marginInline: -2,
                      padding: 2,
                      zIndex: 100 - index,
                    }}
                  />
                ))}
              </Flexbox>
            )}
          </Flexbox>

          <Flexbox horizontal gap={4}>
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
                ease: [0.4, 0, 0.2, 1], // Using ease-out easing function
              }}
              variants={{
                collapsed: { height: 0, opacity: 0, width: 'auto' },
                open: { height: 'auto', opacity: 1, width: 'auto' },
              }}
            >
              <Flexbox gap={12}>
                {searchQueries && (
                  <Flexbox horizontal gap={4}>
                    {t('search.grounding.searchQueries')}
                    <Flexbox horizontal gap={8}>
                      {searchQueries.map((query, index) => (
                        <Tag key={index}>{query}</Tag>
                      ))}
                    </Flexbox>
                  </Flexbox>
                )}
                {citations && (
                  <SearchResultCards
                    dataSource={citations.map((c) => ({
                      ...c,
                      // Pass the original redirect URL as href to preserve the actual link
                      href: c.url,
                      // Override url with favicon domain so SearchResultCard derives the correct favicon host
                      url: c.favicon ? `https://${c.favicon}` : c.url,
                    }))}
                  />
                )}
                {imageSearchQueries && imageSearchQueries.length > 0 && (
                  <Flexbox horizontal gap={4}>
                    {t('search.grounding.imageSearchQueries')}
                    <Flexbox horizontal gap={8} wrap={'wrap'}>
                      {imageSearchQueries.map((query, index) => (
                        <Tag key={index}>{query}</Tag>
                      ))}
                    </Flexbox>
                  </Flexbox>
                )}
                {imageResults && imageResults.length > 0 && (
                  <div className={styles.imageGrid}>
                    {imageResults.map((item, index) => (
                      <div className={styles.imageCard} key={`${item.imageUri}-${index}`}>
                        <Flexbox gap={4}>
                          <a
                            className={styles.imageCardLink}
                            href={item.imageUri}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            <div className={styles.imageThumbWrap}>
                              <img
                                alt={item.title ? stripHtml(item.title) : ''}
                                className={styles.imageThumb}
                                src={item.imageUri || ''}
                              />
                            </div>
                          </a>
                          <a
                            className={styles.imageCardLink}
                            href={item.sourceUri}
                            rel="noopener noreferrer"
                            target="_blank"
                            title={item.title ? stripHtml(item.title) : undefined}
                          >
                            <Flexbox gap={2}>
                              {item.title && (
                                <div
                                  className={styles.imageTitle}
                                  dangerouslySetInnerHTML={{ __html: item.title }}
                                />
                              )}
                              {item.domain && (
                                <Flexbox horizontal align="center" gap={4}>
                                  <Image
                                    unoptimized
                                    alt={item.domain}
                                    height={12}
                                    src={`https://icons.duckduckgo.com/ip3/${item.domain}.ico`}
                                    style={{ borderRadius: 2, flexShrink: 0 }}
                                    width={12}
                                  />
                                  <div className={styles.imageDomain}>{item.domain}</div>
                                </Flexbox>
                              )}
                            </Flexbox>
                          </a>
                        </Flexbox>
                      </div>
                    ))}
                  </div>
                )}
              </Flexbox>
            </motion.div>
          )}
        </AnimatePresence>
      </Flexbox>
    );
  },
);

export default SearchGrounding;
