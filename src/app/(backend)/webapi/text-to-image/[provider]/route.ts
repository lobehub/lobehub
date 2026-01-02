import { type ChatCompletionErrorPayload, type TextToImagePayload } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { NextResponse } from 'next/server';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { createErrorResponse } from '@/utils/errorResponse';

export const preferredRegion = [
  'arn1',
  'bom1',
  'cdg1',
  'cle1',
  'cpt1',
  'dub1',
  'fra1',
  'gru1',
  'hnd1',
  'iad1',
  'icn1',
  'kix1',
  'lhr1',
  'pdx1',
  'sfo1',
  'sin1',
  'syd1',
];

// return NextResponse.json(
//   {
//     body: {
//       endpoint: 'https://ai****ix.com/v1',
//       error: {
//         code: 'content_policy_violation',
//         message:
//           'Your request was rejected as a result of our safety system. Image descriptions generated from your prompt may contain text that is not allowed by our safety system. If you believe this was done in error, your request may succeed if retried, or by adjusting your prompt.',
//         param: null,
//         type: 'invalid_request_error',
//       },
//       provider: 'openai',
//     },
//     errorType: 'OpenAIBizError',
//   },
//   { status: 400 },
// );

export const POST = checkAuth(async (req: Request, { params, jwtPayload }) => {
  const provider = (await params)!.provider!;

  try {
    // ============  1. init chat model   ============ //
    const agentRuntime = await initModelRuntimeWithUserPayload(provider, jwtPayload);

    // ============  2. create chat completion   ============ //

    const data = (await req.json()) as TextToImagePayload;

    const images = await agentRuntime.textToImage(data);

    return NextResponse.json(images);
  } catch (e) {
    const {
      errorType = ChatErrorType.InternalServerError,
      error: errorContent,
      ...res
    } = e as ChatCompletionErrorPayload;

    const error = errorContent || e;
    // track the error at server side
    console.error(`Route: [${provider}] ${errorType}:`, error);

    return createErrorResponse(errorType, { error, ...res, provider });
  }
});
