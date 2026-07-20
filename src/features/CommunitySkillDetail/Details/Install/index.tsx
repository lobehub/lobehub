'use client';

import { Flexbox, MaterialFileTypeIcon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import { useDetailContext } from '../../DetailProvider';
import Platform from './Platform';

const styles = createStaticStyles(({ css, cssVar }) => ({
  filesCard: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;
    background: ${cssVar.colorBgContainer};
  `,
  sectionLabel: css`
    margin: 0;

    font-size: 20px;
    font-weight: 700;
    line-height: 1.25;
    color: ${cssVar.colorText};
  `,
}));

const Install = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { identifier, downloadUrl, resources, content } = useDetailContext();
  const { t } = useTranslation('discover');
  const entries = Object.entries((resources || {}) as Record<string, { size: number }>);

  // Ensure SKILL.md is always shown, use content length as fallback size
  if (!entries.some(([path]) => path.toLowerCase() === 'skill.md')) {
    const skillMdSize = content ? new TextEncoder().encode(content).length : 0;
    entries.unshift(['SKILL.md', { size: skillMdSize }]);
  }

  return (
    <Flexbox gap={32}>
      <Platform
        expandCodeByDefault
        downloadUrl={downloadUrl}
        identifier={identifier}
        mobile={mobile}
      />
      {entries.length > 0 && (
        <Flexbox gap={12}>
          <Text as={'h2'} className={styles.sectionLabel}>
            {t('skills.details.installation.filesIncluded')}
          </Text>
          <div className={styles.filesCard}>
            {entries.map(([name, meta], index) => (
              <Flexbox
                horizontal
                align={'center'}
                justify={'space-between'}
                key={name}
                paddingBlock={12}
                paddingInline={16}
                style={
                  index < entries.length - 1
                    ? { borderBottom: `1px solid ${cssVar.colorBorderSecondary}` }
                    : undefined
                }
              >
                <Flexbox horizontal align={'center'} gap={10} style={{ minWidth: 0 }}>
                  <MaterialFileTypeIcon filename={name} size={20} />
                  <Text ellipsis style={{ fontSize: 14 }}>
                    {name}
                  </Text>
                </Flexbox>
                {meta.size > 0 && (
                  <Text style={{ color: cssVar.colorTextDescription, flex: 'none', fontSize: 13 }}>
                    {formatSize(meta.size)}
                  </Text>
                )}
              </Flexbox>
            ))}
          </div>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default Install;
