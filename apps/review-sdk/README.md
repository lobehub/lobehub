# @lobehub/review-sdk

An embeddable review toolbar. A reviewer opens the delivered product, points at what is wrong, writes a remark (a screenshot and the page context are captured), and sends the delivery back — the remarks land on the delivery's LobeHub **acceptance** as the reviewer's own comments, and sending back rejects the acceptance, which dispatches the repair to the agent that built it.

## Add it to a product

```html
<script
  src="https://<asset-cdn>/review-sdk/assets/v1/lobehub-review.js"
  data-server="https://app.lobehub.com"
  data-acceptance="<acceptance id>"
></script>
```

Or from code, to attach product facts to every remark (the repair agent uses them to reproduce the page):

```ts
LobeHubReview.init({
  acceptanceId,
  server: 'https://app.lobehub.com',
  commit: BUILD_COMMIT, // or <meta name="lobehub-review:commit" content="…">
  context: () => ({ scenario: 'training-mixed', seed: 7 }),
});
```

Review mode: the floating **Review** button or ⌘/Ctrl+Shift+E; Esc leaves it.

## How it authenticates

The first time, the toolbar opens `/oauth/acceptance-review` on LobeHub. The reviewer — signed in there as themselves — sees which site asks to review which delivery and approves. LobeHub posts back an **acceptance-review token**, addressed to this page's origin only:

- bound to one acceptance and this exact origin; a request from any other origin is refused;
- `comment`, plus `reject` only for someone who could reject in the viewer;
- one hour; kept for the tab (sessionStorage) and dropped when it expires;
- refused everywhere else — it is not a user session (`/trpc`, `/api/v1` reject it).

The toolbar talks to `/api/acceptance-review/*` (CORS, bearer token, no cookies).

## Develop

```bash
bun run build # dist/v1/lobehub-review.{js,mjs}
bun run test
bun run deploy # upload to the asset CDN (needs ASSET_S3_* env)
```
