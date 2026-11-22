from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import quote

if TYPE_CHECKING:
    from ._base_client import AsyncAPIClient, SyncAPIClient


def _path(value: object) -> str:
    """Encode one path segment: an id never splits into extra segments."""
    return quote(str(value), safe="")


class SyncAPIResource:
    def __init__(self, client: SyncAPIClient) -> None:
        self._client = client


class AsyncAPIResource:
    def __init__(self, client: AsyncAPIClient) -> None:
        self._client = client
