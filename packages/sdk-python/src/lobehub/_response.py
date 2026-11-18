from __future__ import annotations

import os
from typing import Union

import httpx


class BinaryResponse:
    """A non-JSON answer, such as the audio `audio.create_speech` returns."""

    def __init__(self, response: httpx.Response) -> None:
        self.response = response
        self.content: bytes = response.content
        self.content_type: str = response.headers.get("content-type", "application/octet-stream")

    def write_to_file(self, path: Union[str, os.PathLike[str]]) -> None:
        with open(path, "wb") as file:
            file.write(self.content)

    def __repr__(self) -> str:
        return f"<BinaryResponse {self.content_type} {len(self.content)} bytes>"
