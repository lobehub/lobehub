import { Flexbox, Icon, SearchResultCards, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight, Globe, Images } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';
import Image from '@/libs/next/Image';
import { type GroundingSearch } from '@/types/search';

// Resolve the favicon host defensively: some providers (e.g. OpenRouter built-in
// web search) may emit citations with an empty/invalid url, and `new URL(undefined)`
// would throw and crash the whole message render.
// See https://github.com/lobehub/lobehub/issues/15043
const getFaviconHost = (favicon?: string, url?: string): string => {
  if (favicon) return favicon;
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

const stripHtml = (html: string) =>
  html
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ');

const styles = stylex.create({
  container: {
    width: 'fit-content',
    paddingBlock: '4px',
    paddingInline: '8px',
    borderRadius: '6px',
    color: cssVar.colorTextTertiary,
  },
  containerDark: {
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  containerLight: {
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  expandDark: {
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  expandLight: {
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  imageCard: {
    overflow: 'hidden',
    borderRadius: '8px',
  },
  imageCardLink: {
    color: 'inherit',
    textDecoration: 'none',
    opacity: { 'default': null, ':hover': 0.75 },
    transition: 'opacity 0.2s',
  },
  imageDomain: {
    overflow: 'hidden',
    fontSize: '11px',
    lineHeight: 1,
    color: cssVar.colorTextQuaternary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  imageGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: '8px',
  },
  imageThumb: {
    display: 'block',
    width: '100%',
    height: '80px',
    objectFit: 'cover',
  },
  imageThumbWrap: {
    overflow: 'hidden',
    display: 'block',
    flexShrink: 0,
    height: '80px',
    borderRadius: '6px',
  },
  imageTitle: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    fontSize: '11px',
    lineHeight: 1.4,
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
  },
});

const SearchGrounding = memo<GroundingSearch>(
  ({ searchQueries, citations, imageResults, imageSearchQueries }) => {
    const { t } = useTranslation('chat');
    const isDarkMode = useIsDark();

    const [showDetail, setShowDetail] = useState(false);

    // Drop citations without a valid url so a malformed entry can't crash the render
    const validCitations = citations?.filter((item) => !!item.url);

    const hasWebResults = !!validCitations?.length;
    const hasImageResults = !!imageResults?.length;
    const titleIcon = !hasWebResults && hasImageResults ? Images : Globe;
    const titleText = hasWebResults
      ? t('search.grounding.title', { count: validCitations?.length })
      : t('search.grounding.imageTitle', { count: imageResults?.length });

    return (
      <Flexbox
        gap={16}
        style={{ width: showDetail ? '100%' : undefined }}
        className={
          stylex.props(
            styles.container,
            isDarkMode ? styles.containerDark : styles.containerLight,
            showDetail && (isDarkMode ? styles.expandDark : styles.expandLight),
          ).className
        }
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
                {validCitations?.slice(0, 8).map((item, index) => (
                  <Image
                    unoptimized
                    alt={item.title || item.url}
                    height={16}
                    key={`${item.url}-${index}`}
                    src={`https://icons.duckduckgo.com/ip3/${getFaviconHost(item.favicon, item.url)}.ico`}
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
            <m.div
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
                {validCitations && (
                  <SearchResultCards
                    dataSource={validCitations.map((c) => ({
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
                  <div {...stylex.props(styles.imageGrid)}>
                    {imageResults.map((item, index) => (
                      <div {...stylex.props(styles.imageCard)} key={`${item.imageUri}-${index}`}>
                        <Flexbox gap={4}>
                          <a
                            {...stylex.props(styles.imageCardLink)}
                            href={item.imageUri}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            <div {...stylex.props(styles.imageThumbWrap)}>
                              <img
                                alt={item.title ? stripHtml(item.title) : ''}
                                {...stylex.props(styles.imageThumb)}
                                src={item.imageUri || ''}
                              />
                            </div>
                          </a>
                          <a
                            {...stylex.props(styles.imageCardLink)}
                            href={item.sourceUri}
                            rel="noopener noreferrer"
                            target="_blank"
                            title={item.title ? stripHtml(item.title) : undefined}
                          >
                            <Flexbox gap={2}>
                              {item.title && (
                                <div {...stylex.props(styles.imageTitle)}>
                                  {stripHtml(item.title)}
                                </div>
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
                                  <div {...stylex.props(styles.imageDomain)}>{item.domain}</div>
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
            </m.div>
          )}
        </AnimatePresence>
      </Flexbox>
    );
  },
);

export default SearchGrounding;
