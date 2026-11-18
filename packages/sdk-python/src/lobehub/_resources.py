"""Hand-written additions to generated resources: `responses.stream()` and `files.upload()`."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, Mapping, Optional, cast

from ._streaming import AsyncResponseStream, ResponseStream
from ._uploads import Uploadable, to_upload_file
from .generated.async_resources import AsyncFiles, AsyncResponses
from .generated.resources import Files, Responses

if TYPE_CHECKING:
    from .generated.types import (
        FileDetail,
        FilesCreateBody,
        ResponseObject,
        ResponsesCreateBody,
    )

RESPONSES_PATH = "/api/v1/responses"


def _reject_stream(body: Mapping[str, Any]) -> None:
    if body.get("stream"):
        raise TypeError(
            "responses.create() returns one JSON object; use responses.stream() for `stream: true`"
        )


def _upload_fields(**fields: Any) -> Dict[str, Any]:
    names = {
        "agent_id": "agentId",
        "directory": "directory",
        "knowledge_base_id": "knowledgeBaseId",
        "session_id": "sessionId",
        "skip_check_file_type": "skipCheckFileType",
        "skip_deduplication": "skipDeduplication",
    }
    return {names[key]: value for key, value in fields.items() if value is not None}


class ResponsesResource(Responses):
    """`client.responses`, plus `stream()` for typed server-sent events."""

    def create(self, body: ResponsesCreateBody, **options: Any) -> ResponseObject:
        _reject_stream(body)
        return super().create(body, **options)

    def stream(
        self,
        body: ResponsesCreateBody,
        *,
        workspace_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        extra_headers: Optional[Mapping[str, str]] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
    ) -> ResponseStream:
        """
        Start a response with `stream: true` and iterate its typed events::

            with client.responses.stream({"model": agent_id, "input": "Hi"}) as stream:
                for event in stream:
                    if event["type"] == "response.output_text.delta":
                        print(event["delta"], end="")
            final = stream.final_response()

        The request is sent when iteration starts. For a stream, `timeout` bounds
        each wait for the next bytes, not the whole run.
        """
        return ResponseStream(
            lambda: self._client._send(
                "POST",
                RESPONSES_PATH,
                json={**body, "stream": True},
                headers={"X-Workspace-Id": workspace_id, "Idempotency-Key": idempotency_key},
                extra_headers=extra_headers,
                timeout=timeout,
                max_retries=max_retries,
                stream=True,
                accept="text/event-stream",
            )
        )


class AsyncResponsesResource(AsyncResponses):
    """`client.responses`, plus `stream()` for typed server-sent events."""

    async def create(self, body: ResponsesCreateBody, **options: Any) -> ResponseObject:
        _reject_stream(body)
        return await super().create(body, **options)

    def stream(
        self,
        body: ResponsesCreateBody,
        *,
        workspace_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        extra_headers: Optional[Mapping[str, str]] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
    ) -> AsyncResponseStream:
        """`async for event in client.responses.stream(...)`; see `LobeHub.responses.stream`."""
        return AsyncResponseStream(
            lambda: self._client._send(
                "POST",
                RESPONSES_PATH,
                json={**body, "stream": True},
                headers={"X-Workspace-Id": workspace_id, "Idempotency-Key": idempotency_key},
                extra_headers=extra_headers,
                timeout=timeout,
                max_retries=max_retries,
                stream=True,
                accept="text/event-stream",
            )
        )


class FilesResource(Files):
    """`client.files`, plus `upload()` for any file source. `upload_batch` takes the same sources, except a path must be a `pathlib.Path`."""

    def upload(
        self,
        file: Uploadable,
        *,
        name: Optional[str] = None,
        content_type: Optional[str] = None,
        agent_id: Optional[str] = None,
        directory: Optional[str] = None,
        knowledge_base_id: Optional[str] = None,
        session_id: Optional[str] = None,
        skip_check_file_type: Optional[bool] = None,
        skip_deduplication: Optional[bool] = None,
        workspace_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        extra_headers: Optional[Mapping[str, str]] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
    ) -> FileDetail:
        """
        Upload a path (`str` or `pathlib.Path`), raw bytes, a binary file object
        or a `(name, content[, type])` tuple::

            uploaded = client.files.upload("./report.pdf", knowledge_base_id=kb_id)

        `name` / `content_type` override what is inferred from the source.
        """
        body = {
            "file": to_upload_file(file, name=name, content_type=content_type),
            **_upload_fields(
                agent_id=agent_id,
                directory=directory,
                knowledge_base_id=knowledge_base_id,
                session_id=session_id,
                skip_check_file_type=skip_check_file_type,
                skip_deduplication=skip_deduplication,
            ),
        }
        return self.create(
            cast("FilesCreateBody", body),
            workspace_id=workspace_id,
            idempotency_key=idempotency_key,
            extra_headers=extra_headers,
            timeout=timeout,
            max_retries=max_retries,
        )


class AsyncFilesResource(AsyncFiles):
    """`client.files`, plus `upload()` for any file source. `upload_batch` takes the same sources, except a path must be a `pathlib.Path`."""

    async def upload(
        self,
        file: Uploadable,
        *,
        name: Optional[str] = None,
        content_type: Optional[str] = None,
        agent_id: Optional[str] = None,
        directory: Optional[str] = None,
        knowledge_base_id: Optional[str] = None,
        session_id: Optional[str] = None,
        skip_check_file_type: Optional[bool] = None,
        skip_deduplication: Optional[bool] = None,
        workspace_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        extra_headers: Optional[Mapping[str, str]] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
    ) -> FileDetail:
        """See `LobeHub.files.upload`. The file is read before the request is sent."""
        body = {
            "file": to_upload_file(file, name=name, content_type=content_type),
            **_upload_fields(
                agent_id=agent_id,
                directory=directory,
                knowledge_base_id=knowledge_base_id,
                session_id=session_id,
                skip_check_file_type=skip_check_file_type,
                skip_deduplication=skip_deduplication,
            ),
        }
        return await self.create(
            cast("FilesCreateBody", body),
            workspace_id=workspace_id,
            idempotency_key=idempotency_key,
            extra_headers=extra_headers,
            timeout=timeout,
            max_retries=max_retries,
        )
