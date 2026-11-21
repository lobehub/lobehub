from __future__ import annotations

import io
from pathlib import Path
from typing import List

import pytest

from lobehub import AsyncLobeHub, LobeHub

from .conftest import API_KEY, MockServer, Reply, api_error, envelope

FILE = {"file": {"id": "file_1", "name": "report.pdf", "url": "https://files/report.pdf"}}


def test_upload_a_path_with_form_fields(server: MockServer, tmp_path: Path) -> None:
    source = tmp_path / "report.pdf"
    source.write_bytes(b"%PDF-1.7 hello")
    server.reply(Reply(201, envelope(FILE)))
    client = LobeHub(api_key=API_KEY, base_url=server.base_url)

    uploaded = client.files.upload(str(source), knowledge_base_id="kb_1", skip_deduplication=True)

    assert uploaded["file"]["id"] == "file_1"
    request = server.requests[0]
    assert (request.method, request.path) == ("POST", "/api/v1/files")
    assert request.headers["content-type"].startswith("multipart/form-data; boundary=")
    fields, files = request.multipart()
    assert fields == {"knowledgeBaseId": "kb_1", "skipDeduplication": "true"}
    assert files == [("file", "report.pdf", "application/pdf", b"%PDF-1.7 hello")]


@pytest.mark.parametrize(
    ("source", "options", "expected"),
    [
        (b"raw", {}, ("file", "application/octet-stream", b"raw")),
        (b"raw", {"name": "notes.txt"}, ("notes.txt", "text/plain", b"raw")),
        (io.BytesIO(b"buffer"), {"name": "a.json"}, ("a.json", "application/json", b"buffer")),
        (("photo.png", b"\x89PNG"), {}, ("photo.png", "image/png", b"\x89PNG")),
        (("x.bin", b"1", "application/x-custom"), {}, ("x.bin", "application/x-custom", b"1")),
        (b"raw", {"name": "a.md", "content_type": "text/markdown"}, ("a.md", "text/markdown", b"raw")),
    ],
)
def test_upload_sources(server: MockServer, source: object, options: dict, expected: tuple) -> None:
    server.reply(Reply(201, envelope(FILE)))
    LobeHub(api_key=API_KEY, base_url=server.base_url).files.upload(source, **options)  # type: ignore[arg-type]
    _, files = server.requests[0].multipart()
    name, content_type, content = expected
    assert files == [("file", name, content_type, content)]


def test_generated_create_and_upload_batch_take_file_sources(server: MockServer, tmp_path: Path) -> None:
    first = tmp_path / "a.txt"
    first.write_bytes(b"A")
    server.reply(Reply(201, envelope(FILE)), Reply(201, envelope({"successful": [], "failed": []})))
    client = LobeHub(api_key=API_KEY, base_url=server.base_url, workspace_id="ws_1")

    client.files.create({"file": first, "directory": "docs"})
    client.files.upload_batch({"files": [first, ("b.csv", b"B")], "skipCheckFileType": False})

    single, batch = server.requests
    assert single.multipart() == ({"directory": "docs"}, [("file", "a.txt", "text/plain", b"A")])
    fields, files = batch.multipart()
    assert fields == {"skipCheckFileType": "false"}
    assert files == [("files", "a.txt", "text/plain", b"A"), ("files", "b.csv", "text/csv", b"B")]
    assert batch.headers["x-workspace-id"] == "ws_1"


@pytest.mark.anyio
async def test_async_upload(server: MockServer, tmp_path: Path) -> None:
    source = tmp_path / "data.json"
    source.write_bytes(b"{}")
    server.reply(Reply(201, envelope(FILE)))
    async with AsyncLobeHub(api_key=API_KEY, base_url=server.base_url) as client:
        uploaded = await client.files.upload(source, agent_id="agt_1")
    assert uploaded["file"]["id"] == "file_1"
    assert server.requests[0].multipart() == (
        {"agentId": "agt_1"},
        [("file", "data.json", "application/json", b"{}")],
    )


def test_upload_batch_refuses_a_list_mixing_files_and_text(server: MockServer, tmp_path: Path) -> None:
    first = tmp_path / "a.txt"
    first.write_bytes(b"A")
    client = LobeHub(api_key=API_KEY, base_url=server.base_url)
    with pytest.raises(TypeError, match="mixes files"):
        client.files.upload_batch({"files": [first, "b.txt"]})  # type: ignore[list-item]
    assert server.requests == []


def test_a_retried_upload_resends_the_file_object_bytes(server: MockServer, sleeps: List[float]) -> None:
    server.reply(Reply(503, api_error("service_unavailable")), Reply(201, envelope({"successful": []})))
    client = LobeHub(api_key=API_KEY, base_url=server.base_url)

    client.files.upload_batch({"files": [io.BytesIO(b"HELLO")]}, idempotency_key="k1")

    assert len(server.requests) == 2 and len(sleeps) == 1
    assert [request.multipart()[1] for request in server.requests] == [
        [("files", "file", "application/octet-stream", b"HELLO")]
    ] * 2


def test_a_retried_upload_resends_the_same_encoded_body(server: MockServer, sleeps: List[float]) -> None:
    server.reply(Reply(503, api_error("service_unavailable")), Reply(201, envelope({"successful": []})))
    client = LobeHub(api_key=API_KEY, base_url=server.base_url)

    client.files.upload_batch({"files": [io.BytesIO(b"HELLO")]}, idempotency_key="k1")

    bodies = [record.body for record in server.requests]
    headers = [record.headers["content-type"] for record in server.requests]
    # The server fingerprints the raw body under an Idempotency-Key: a rebuilt
    # multipart would carry a new boundary and be answered 422 instead of replaying.
    assert len(bodies) == 2 and bodies[0] == bodies[1]
    assert headers[0] == headers[1]
    assert headers[0].split("boundary=")[1].encode() in bodies[0]
    assert b'name="files"; filename="file"' in bodies[0] and b"HELLO" in bodies[0]
