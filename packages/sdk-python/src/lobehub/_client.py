from __future__ import annotations

from types import TracebackType
from typing import Any, AsyncIterator, Callable, Iterator, Mapping, Optional, Type

import httpx

from ._base_client import NOT_GIVEN, AccessToken, AsyncAccessToken, AsyncAPIClient, SyncAPIClient
from ._compat import cached_property
from ._constants import DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT
from ._pagination import aiter_pages, iter_pages
from ._resources import AsyncFilesResource, AsyncResponsesResource, FilesResource, ResponsesResource
from ._streaming import AsyncStream, ServerSentEvent, Stream
from .generated.async_resources import AsyncGeneratedResources
from .generated.resources import GeneratedResources


class LobeHub(GeneratedResources, SyncAPIClient):
    """
    The LobeHub REST API client: `client.agents.list()`, `client.files.upload()`,
    `client.responses.stream()`, …

    Resources, methods and schemas are generated from `packages/openapi/openapi.yml`;
    each method is named after its operationId (`agents.list` → `client.agents.list()`).

    :param api_key: a LobeHub API key (`sk-lh-...`) or an OIDC JWT; defaults to
        the `LOBEHUB_API_KEY` environment variable.
    :param access_token: an OIDC access token, or a function returning the current
        one (called before every request: refresh it there). Takes precedence over `api_key`.
    :param base_url: API origin, defaults to `LOBEHUB_BASE_URL` or LobeHub Cloud.
    :param workspace_id: sent as `X-Workspace-Id` on every request: act inside this workspace.
    :param timeout: seconds per attempt (0 disables it); per-call `timeout=` overrides it.
    :param max_retries: retries of idempotent requests (and POSTs with an `idempotency_key`)
        on 408/429/5xx and connection failures, honoring `Retry-After`.
    """

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        access_token: Optional[AccessToken] = None,
        base_url: Optional[str] = None,
        workspace_id: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        default_headers: Optional[Mapping[str, str]] = None,
        http_client: Optional[httpx.Client] = None,
    ) -> None:
        super().__init__(
            api_key=api_key,
            access_token=access_token,
            base_url=base_url,
            workspace_id=workspace_id,
            timeout=timeout,
            max_retries=max_retries,
            default_headers=default_headers,
        )
        self._http = http_client or httpx.Client(follow_redirects=True)
        self._owns_http = http_client is None
        self._client = self

    @cached_property
    def responses(self) -> ResponsesResource:
        return ResponsesResource(self)

    @cached_property
    def files(self) -> FilesResource:
        return FilesResource(self)

    def with_options(
        self,
        *,
        workspace_id: Optional[str] = NOT_GIVEN,
        timeout: float = NOT_GIVEN,
        max_retries: int = NOT_GIVEN,
    ) -> LobeHub:
        """A client sharing this one's connection pool with some settings changed."""
        return self._copy(workspace_id=workspace_id, timeout=timeout, max_retries=max_retries)

    def paginate(self, method: Callable[..., Any], /, **params: Any) -> Iterator[Any]:
        """
        Iterate every item of any cursor-paginated list method across pages::

            for agent in client.paginate(client.agents.list, limit=50):
                print(agent["id"])

        Each generated list method also has a typed `iter_*` twin (`client.agents.iter_list()`).
        """
        cursor = params.pop("cursor", None)
        return iter_pages(lambda page_cursor: method(**params, cursor=page_cursor), None, cursor)

    def stream_events(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Mapping[str, Any]] = None,
        json: Any = None,
        headers: Optional[Mapping[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> Stream[ServerSentEvent]:
        """Open any `text/event-stream` endpoint and iterate its raw `ServerSentEvent`s."""
        return Stream(
            lambda: self._send(
                method,
                path,
                query=query,
                json=json,
                extra_headers=headers,
                timeout=timeout,
                stream=True,
                accept="text/event-stream",
            )
        )

    def close(self) -> None:
        """Close the connection pool (only when the client created it)."""
        if self._owns_http:
            self._http.close()

    def __enter__(self) -> LobeHub:
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self.close()


class AsyncLobeHub(AsyncGeneratedResources, AsyncAPIClient):
    """
    The async LobeHub REST API client: `await client.agents.list()`. Takes the
    same options as `LobeHub`; `access_token` may also be a coroutine function.
    """

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        access_token: Optional[AsyncAccessToken] = None,
        base_url: Optional[str] = None,
        workspace_id: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        default_headers: Optional[Mapping[str, str]] = None,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        super().__init__(
            api_key=api_key,
            access_token=access_token,
            base_url=base_url,
            workspace_id=workspace_id,
            timeout=timeout,
            max_retries=max_retries,
            default_headers=default_headers,
        )
        self._http = http_client or httpx.AsyncClient(follow_redirects=True)
        self._owns_http = http_client is None
        self._client = self

    @cached_property
    def responses(self) -> AsyncResponsesResource:
        return AsyncResponsesResource(self)

    @cached_property
    def files(self) -> AsyncFilesResource:
        return AsyncFilesResource(self)

    def with_options(
        self,
        *,
        workspace_id: Optional[str] = NOT_GIVEN,
        timeout: float = NOT_GIVEN,
        max_retries: int = NOT_GIVEN,
    ) -> AsyncLobeHub:
        """A client sharing this one's connection pool with some settings changed."""
        return self._copy(workspace_id=workspace_id, timeout=timeout, max_retries=max_retries)

    def paginate(self, method: Callable[..., Any], /, **params: Any) -> AsyncIterator[Any]:
        """`async for item in client.paginate(client.agents.list, limit=50)`."""
        cursor = params.pop("cursor", None)
        return aiter_pages(lambda page_cursor: method(**params, cursor=page_cursor), None, cursor)

    def stream_events(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Mapping[str, Any]] = None,
        json: Any = None,
        headers: Optional[Mapping[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> AsyncStream[ServerSentEvent]:
        """Open any `text/event-stream` endpoint and iterate its raw `ServerSentEvent`s."""
        return AsyncStream(
            lambda: self._send(
                method,
                path,
                query=query,
                json=json,
                extra_headers=headers,
                timeout=timeout,
                stream=True,
                accept="text/event-stream",
            )
        )

    async def close(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def __aenter__(self) -> AsyncLobeHub:
        return self

    async def __aexit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        await self.close()
