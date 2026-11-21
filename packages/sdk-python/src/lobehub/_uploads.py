from __future__ import annotations

import io
import mimetypes
import os
from pathlib import Path
from typing import IO, Any, Dict, List, Mapping, Optional, Tuple, Union
from uuid import uuid4

FileContent = Union[bytes, bytearray, IO[bytes]]

#: Anything a binary upload field accepts: raw bytes, a binary file object, a
#: path (`pathlib.Path`), or a `(name, content)` / `(name, content, type)` tuple.
FileTypes = Union[
    FileContent,
    "os.PathLike[str]",
    Tuple[Optional[str], FileContent],
    Tuple[Optional[str], FileContent, Optional[str]],
]

#: `files.upload` also takes a path as a plain string.
Uploadable = Union[FileTypes, str]

DEFAULT_CONTENT_TYPE = "application/octet-stream"

UploadFile = Tuple[str, bytes, str]


def _guess_type(name: str) -> str:
    return mimetypes.guess_type(name)[0] or DEFAULT_CONTENT_TYPE


def is_file_content(value: object) -> bool:
    if isinstance(value, (bytes, bytearray, io.IOBase, os.PathLike)):
        return True
    if isinstance(value, tuple) and len(value) in (2, 3):
        return isinstance(value[1], (bytes, bytearray, io.IOBase)) or hasattr(value[1], "read")
    return hasattr(value, "read")


def to_upload_file(
    source: Uploadable, *, name: Optional[str] = None, content_type: Optional[str] = None
) -> UploadFile:
    """
    Read `source` into a `(name, bytes, content type)` triple.

    Content is read into memory up front, so a retried request resends the same
    bytes. The type defaults to one guessed from the file name.
    """
    if isinstance(source, tuple):
        tuple_name, content = source[0], source[1]
        tuple_type = source[2] if len(source) == 3 else None
        file_name, data, _ = to_upload_file(content, name=name or tuple_name)
        return file_name, data, content_type or tuple_type or _guess_type(file_name)

    if isinstance(source, (str, os.PathLike)):
        path = Path(source)
        file_name = name or path.name
        return file_name, path.read_bytes(), content_type or _guess_type(file_name)

    if isinstance(source, (bytes, bytearray)):
        file_name = name or "file"
        return (
            file_name,
            bytes(source),
            content_type or (_guess_type(file_name) if name else DEFAULT_CONTENT_TYPE),
        )

    data = source.read()
    if isinstance(data, str):
        data = data.encode()
    file_name = name or os.path.basename(str(getattr(source, "name", "") or "")) or "file"
    return file_name, bytes(data), content_type or _guess_type(file_name)


def _form_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


MultipartParts = Tuple[Dict[str, Union[str, List[str]]], List[Tuple[str, UploadFile]]]
"""Form fields and `(field, file)` parts, ready for httpx's `data=` and `files=`."""

EncodedMultipart = Tuple[bytes, str]
"""An already encoded multipart body and the `Content-Type` header it belongs to."""


def split_multipart(body: Mapping[str, Any]) -> MultipartParts:
    """Split a multipart body into form fields and files (lists send one part per file)."""
    data: Dict[str, Union[str, List[str]]] = {}
    files: List[Tuple[str, UploadFile]] = []
    for key, value in body.items():
        if value is None:
            continue
        if isinstance(value, (list, tuple)) and not (isinstance(value, tuple) and is_file_content(value)):
            file_parts = [is_file_content(v) for v in value]
            if value and all(file_parts):
                files.extend((key, to_upload_file(v)) for v in value)
            elif any(file_parts):
                raise TypeError(
                    f"`{key}` mixes files with other values; pass every file as bytes, a file object, "
                    "a pathlib.Path or a (name, content) tuple (a plain str is sent as text)"
                )
            else:
                data[key] = [_form_value(v) for v in value]
        elif is_file_content(value):
            files.append((key, to_upload_file(value)))
        else:
            data[key] = _form_value(value)
    return data, files


def _quote(value: str) -> str:
    """A form parameter value safe inside a quoted `Content-Disposition` header."""
    return value.replace("\r", " ").replace("\n", " ").replace('"', "%22")


def encode_multipart(
    data: Mapping[str, Union[str, List[str]]],
    files: List[Tuple[str, UploadFile]],
    boundary: Optional[str] = None,
) -> EncodedMultipart:
    """
    Encode a multipart body to bytes with one fixed boundary.

    The bytes have to be stable across retries: the server fingerprints the raw
    body under an `Idempotency-Key`, so a freshly generated boundary would make a
    legitimate resend look like a different request (422 `idempotency_conflict`).
    """
    delimiter = boundary or uuid4().hex
    chunks: List[bytes] = []
    for key, value in data.items():
        for item in value if isinstance(value, list) else [value]:
            chunks.append(
                f'--{delimiter}\r\nContent-Disposition: form-data; name="{_quote(key)}"\r\n\r\n'.encode()
            )
            chunks.append(f"{item}\r\n".encode())
    for field, (name, content, content_type) in files:
        chunks.append(
            (
                f"--{delimiter}\r\n"
                f'Content-Disposition: form-data; name="{_quote(field)}"; filename="{_quote(name)}"\r\n'
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode()
        )
        chunks.append(content)
        chunks.append(b"\r\n")
    chunks.append(f"--{delimiter}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={delimiter}"
