from __future__ import annotations

from typing import Any, Dict, List

import pytest

from lobehub import AsyncLobeHub, LobeHub
from lobehub._pagination import page_items

from .conftest import API_KEY, MockServer, Recorded, Reply, envelope


def pages(server: MockServer, key: str = "items") -> None:
    """Three pages of `key` items keyed by cursor."""
    book: Dict[str, Dict[str, Any]] = {
        "": {key: [{"id": "a"}, {"id": "b"}], "hasMore": True, "nextCursor": "c1", "total": 5},
        "c1": {key: [{"id": "c"}, {"id": "d"}], "hasMore": True, "nextCursor": "c2", "total": 5},
        "c2": {key: [{"id": "e"}], "hasMore": False, "nextCursor": None, "total": 5},
    }

    def handler(request: Recorded) -> Reply:
        return Reply(body=envelope(book[request.query.get("cursor", [""])[0]]))

    server.default = handler


def test_iter_list_walks_every_page(server: MockServer) -> None:
    pages(server)
    client = LobeHub(api_key=API_KEY, base_url=server.base_url, workspace_id="ws_1")

    ids = [group["id"] for group in client.agent_groups.iter_list(limit=2)]

    assert ids == ["a", "b", "c", "d", "e"]
    assert [r.query.get("cursor") for r in server.requests] == [None, ["c1"], ["c2"]]
    assert all(r.query["limit"] == ["2"] for r in server.requests)
    assert all(r.headers["x-workspace-id"] == "ws_1" for r in server.requests)


def test_iter_methods_use_the_endpoints_own_item_key(server: MockServer) -> None:
    pages(server, key="messages")
    client = LobeHub(api_key=API_KEY, base_url=server.base_url)
    assert [m["id"] for m in client.messages.iter_list(topic_id="tpc_1")] == ["a", "b", "c", "d", "e"]
    assert server.requests[0].query["topicId"] == ["tpc_1"]


def test_paginate_any_list_method_and_start_cursor(server: MockServer) -> None:
    pages(server, key="topics")
    client = LobeHub(api_key=API_KEY, base_url=server.base_url)
    assert [t["id"] for t in client.paginate(client.topics.list, limit=2)] == ["a", "b", "c", "d", "e"]
    assert [t["id"] for t in client.paginate(client.topics.list, cursor="c1")] == ["c", "d", "e"]


def test_stops_on_a_repeated_cursor(server: MockServer) -> None:
    server.default = Reply(body=envelope({"items": [{"id": "x"}], "hasMore": True, "nextCursor": "same"}))
    client = LobeHub(api_key=API_KEY, base_url=server.base_url)
    assert len(list(client.agent_groups.iter_list(cursor="same"))) == 1


def test_iteration_is_lazy(server: MockServer) -> None:
    pages(server)
    client = LobeHub(api_key=API_KEY, base_url=server.base_url)
    iterator = client.agent_groups.iter_list()
    assert server.requests == []
    assert next(iter(iterator))["id"] == "a"
    assert len(server.requests) == 1


def test_page_items_finds_the_array() -> None:
    assert page_items({"items": [1], "hasMore": False}) == [1]
    assert page_items({"runs": [2], "runId": "r", "hasMore": False, "nextCursor": None}) == [2]
    with pytest.raises(ValueError):
        page_items({"a": [], "b": [], "hasMore": False})


@pytest.mark.anyio
async def test_async_pagination(server: MockServer) -> None:
    pages(server)
    async with AsyncLobeHub(api_key=API_KEY, base_url=server.base_url) as client:
        ids: List[str] = [g["id"] async for g in client.agent_groups.iter_list(limit=2)]
        again = [g["id"] async for g in client.paginate(client.agent_groups.list)]
    assert ids == again == ["a", "b", "c", "d", "e"]
