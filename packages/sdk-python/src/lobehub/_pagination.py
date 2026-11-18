from __future__ import annotations

from typing import Any, AsyncIterator, Awaitable, Callable, Iterator, List, Mapping, Optional

# Page metadata: the one other array-valued key of a page holds its items.
PAGE_FIELDS = {"hasMore", "nextCursor", "total", "totalSize"}


def page_items(page: Mapping[str, Any], key: Optional[str] = None) -> List[Any]:
    """The item array of a page: `key`, else `items`, else the one array-valued key."""
    if key is not None:
        return list(page.get(key) or [])
    if isinstance(page.get("items"), list):
        return list(page["items"])
    arrays = [v for k, v in page.items() if k not in PAGE_FIELDS and isinstance(v, list)]
    if len(arrays) != 1:
        raise ValueError(f"paginate: cannot tell the item array apart on a page with keys {', '.join(page)}")
    return list(arrays[0])


def _next_cursor(page: Mapping[str, Any], cursor: Optional[str]) -> Optional[str]:
    next_cursor = page.get("nextCursor")
    if not page.get("hasMore") or not next_cursor or next_cursor == cursor:
        return None
    return str(next_cursor)


def iter_pages(
    fetch: Callable[[Optional[str]], Any], key: Optional[str] = None, cursor: Optional[str] = None
) -> Iterator[Any]:
    """
    Walk every page of a cursor-paginated list, yielding its items: pass
    `nextCursor` back as `cursor` until `hasMore` is false or `nextCursor` null.
    """
    while True:
        page = fetch(cursor)
        yield from page_items(page, key)
        cursor = _next_cursor(page, cursor)
        if cursor is None:
            return


async def aiter_pages(
    fetch: Callable[[Optional[str]], Awaitable[Any]], key: Optional[str] = None, cursor: Optional[str] = None
) -> AsyncIterator[Any]:
    """The async counterpart of `iter_pages`."""
    while True:
        page = await fetch(cursor)
        for item in page_items(page, key):
            yield item
        cursor = _next_cursor(page, cursor)
        if cursor is None:
            return
