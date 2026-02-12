import { authEnv } from '@/envs/auth';
import { notFound } from '@/libs/next/navigation';
import { defaultClients } from '@/libs/oidc-provider/config';
import { OIDCService } from '@/server/services/oidc';

import ConsentClientError from './ClientError';
import Consent from './Consent';
import Login from './Login';

const InteractionPage = async (props: { params: Promise<{ uid: string }> }) => {
  if (!authEnv.ENABLE_OIDC) return notFound();

  const params = await props.params;
  const uid = params.uid;

  try {
    const oidcService = await OIDCService.initialize();

    // 获取交互详情，传入请求和响应对象
    const details = await oidcService.getInteractionDetails(uid);

    // 支持 login 和 consent 类型的交互
    if (details.prompt.name !== 'consent' && details.prompt.name !== 'login') {
      return (
        <ConsentClientError
          error={{
            messageKey: 'consent.error.unsupportedInteraction.message',
            titleKey: 'consent.error.unsupportedInteraction.title',
            values: { promptName: details.prompt.name },
          }}
        />
      );
    }

    // 获取客户端 ID 和授权范围
    const clientId = (details.params.client_id as string) || 'unknown';
    const scopes = (details.params.scope as string)?.split(' ') || [];

    const clientDetail = await oidcService.getClientMetadata(clientId);

    const clientMetadata = {
      clientName: clientDetail?.client_name,
      isFirstParty: defaultClients.map((c) => c.client_id).includes(clientId),
      logo: clientDetail?.logo_uri,
    };
    // 渲染客户端组件，无论是 login 还是 consent 类型
    if (details.prompt.name === 'login')
      return <Login clientMetadata={clientMetadata} uid={params.uid} />;

    return (
      <Consent
        clientId={clientId}
        clientMetadata={clientMetadata}
        redirectUri={details.params.redirect_uri as string}
        scopes={scopes}
        uid={params.uid}
      />
    );
  } catch (error) {
    console.error('Error handling OIDC interaction:', error);
    // 确保错误处理能正确显示
    const errorMessage = error instanceof Error ? error.message : undefined;
    // 检查是否是 'interaction session not found' 错误，可以给用户更友好的提示
    if (errorMessage?.includes('interaction session not found')) {
      return (
        <ConsentClientError
          error={{
            messageKey: 'consent.error.sessionInvalid.message',
            titleKey: 'consent.error.sessionInvalid.title',
          }}
        />
      );
    }

    return (
      <ConsentClientError
        error={{
          message: errorMessage,
          messageKey: errorMessage ? undefined : 'consent.error.unknown.message',
          titleKey: 'consent.error.title',
        }}
      />
    );
  }
};

export default InteractionPage;
