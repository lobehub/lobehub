from __future__ import annotations

import io
from pathlib import Path

import pytest

from lobehub import AsyncLobeHub, LobeHub

from .conftest import API_KEY, MockServer, Reply, envelope

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
