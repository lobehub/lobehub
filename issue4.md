### Description
The code review checklist prohibits leaving console.log statements in the codebase. While some are valid inside scripts, there are several console.log leftovers in the frontend source code that should be replaced with the @lobehub/debug utility (or removed entirely) to avoid polluting the production console.

### Locations to update
- [src/business/client/BusinessSettingPages/SubscriptionIframeWrapper.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/business/client/BusinessSettingPages/SubscriptionIframeWrapper.tsx#L79)

### Expected Behavior
Remove these leftover console.log statements or migrate them to use the appropriate lobe-* debug namespace.
