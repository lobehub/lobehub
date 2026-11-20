import { formatUsageValue } from '@lobechat/utils';
import { Center, cssVar, Flexbox, Tooltip } from '@lobehub/ui';
import numeral from 'numeral';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import TokenProgress from './TokenProgress';
import { type TokenBreakdown } from './useTokenBreakdown';

interface TokenDetailsProps {
  breakdown: TokenBreakdown;
}

const TokenDetails = memo<TokenDetailsProps>(({ breakdown }) => {
  const { t } = useTranslation(['chat', 'components']);

  const {
    chatsToken,
    fileContextToken,
    lastRequestInputTokens,
    maxTokens,
    reasoningToken,
    systemToken,
    toolCallsToken,
    toolsToken,
    totalToken,
  } = breakdown;
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  return (
    <Flexbox gap={12} style={{ minWidth: 200 }}>
      <Flexbox horizontal align={'center'} gap={4} justify={'space-between'} width={'100%'}>
        <Flexbox horizontal align={'baseline'} gap={6}>
          <div style={{ color: cssVar.colorTextDescription }}>{t('tokenDetails.title')}</div>
          <Tooltip title={t('tokenDetails.estimatedTooltip')}>
            <div style={{ color: cssVar.colorTextQuaternary, cursor: 'help', fontSize: 12 }}>
              {t('tokenDetails.estimated')}
            </div>
          </Tooltip>
        </Flexbox>
        <Tooltip
          styles={{ root: { maxWidth: 'unset', pointerEvents: 'none' } }}
          title={t('ModelSelect.featureTag.tokens', {
            ns: 'components',
            tokens: numeral(maxTokens).format('0,0'),
          })}
        >
          <Center
            height={20}
            paddingInline={4}
            style={{
              background: cssVar.colorFillTertiary,
              borderRadius: 4,
              color: cssVar.colorTextSecondary,
              fontFamily: cssVar.fontFamilyCode,
              fontSize: 11,
            }}
          >
            TOKEN
          </Center>
        </Tooltip>
      </Flexbox>
      {isDevMode && (
        <TokenProgress
          showIcon
          data={[
            {
              color: cssVar.magenta,
              id: 'system',
              title: t('tokenDetails.system'),
              value: systemToken,
            },
            {
              color: cssVar.geekblue,
              id: 'tools',
              title: t('tokenDetails.tools'),
              value: toolsToken,
            },
            {
              color: cssVar.gold,
              id: 'chats',
              title: t('tokenDetails.chats'),
              value: chatsToken,
            },
            {
              color: cssVar.orange,
              id: 'fileContext',
              title: t('tokenDetails.fileContext'),
              value: fileContextToken,
            },
            {
              color: cssVar.cyan,
              id: 'toolCalls',
              title: t('tokenDetails.toolCalls'),
              value: toolCallsToken,
            },
            {
              color: cssVar.purple,
              id: 'reasoning',
              title: t('tokenDetails.reasoning'),
              value: reasoningToken,
            },
          ]}
        />
      )}
      <TokenProgress
        showIcon={isDevMode}
        showTotal={t('tokenDetails.total')}
        data={[
          {
            color: cssVar.colorSuccess,
            id: 'used',
            title: t('tokenDetails.used'),
            value: totalToken,
          },
          {
            color: cssVar.colorFill,
            id: 'rest',
            title: t('tokenDetails.rest'),
            value: maxTokens - totalToken,
          },
        ]}
      />
      {!!lastRequestInputTokens && (
        <Flexbox horizontal align={'center'} gap={4} justify={'space-between'}>
          <div style={{ color: cssVar.colorTextDescription }}>
            {t('tokenDetails.lastRequestInput')}
          </div>
          <div style={{ color: cssVar.colorTextSecondary }}>
            {formatUsageValue(lastRequestInputTokens)}
          </div>
        </Flexbox>
      )}
    </Flexbox>
  );
});

TokenDetails.displayName = 'ContextWindowTokenDetails';

export default TokenDetails;
