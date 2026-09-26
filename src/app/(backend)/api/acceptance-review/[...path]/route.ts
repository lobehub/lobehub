// Route shell for the embedded review toolbar's API. Auth, CORS and every
// action live in the server service; see `@/server/services/acceptanceReview/http`.
import {
  handleAcceptanceReviewPreflight,
  handleAcceptanceReviewRequest,
} from '@/server/services/acceptanceReview/http';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

const handle = async (request: Request, context: Context) =>
  handleAcceptanceReviewRequest(request, (await context.params).path);

export const OPTIONS = handleAcceptanceReviewPreflight;
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
