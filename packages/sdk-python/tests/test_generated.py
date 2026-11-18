"""The generated layer covers the spec: every operation is a method, and the output is current."""

from __future__ import annotations

import inspect
import re
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

from lobehub import AsyncLobeHub, LobeHub, types

PKG_ROOT = Path(__file__).resolve().parent.parent
SPEC = yaml.safe_load((PKG_ROOT.parent / "openapi" / "openapi.yml").read_text(encoding="utf8"))
OPERATIONS = [
    (op["operationId"], method.upper(), path)
    for path, item in SPEC["paths"].items()
    for method, op in item.items()
]


def snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


@pytest.mark.parametrize(("operation_id", "http_method", "path"), OPERATIONS, ids=[o[0] for o in OPERATIONS])
def test_every_operation_is_a_sync_and_async_method(operation_id: str, http_method: str, path: str) -> None:
    resource, method = operation_id.split(".")
    for client in (LobeHub(api_key="k"), AsyncLobeHub(api_key="k")):
        bound = getattr(getattr(client, snake(resource)), snake(method))
        # getdoc() falls back to the generated docstring for hand-written overrides.
        assert f"`{http_method} {path}`" in (inspect.getdoc(bound) or "")


def test_component_schemas_are_exported() -> None:
    for name in ("Agent", "ApiErrorCode", "ResponseObject", "ResponseStreamEvent", "FileDetail"):
        assert name in types.__all__ and hasattr(types, name)


def test_generated_output_is_in_sync_with_the_spec() -> None:
    # The same command CI runs: a route or schema change that regenerates
    # openapi.yml must commit the regenerated Python SDK in the same PR.
    result = subprocess.run(
        [sys.executable, "scripts/generate.py", "--check"], cwd=PKG_ROOT, capture_output=True, text=True
    )
    assert result.returncode == 0, (
        "src/lobehub/generated is out of date. Run `uv run python scripts/generate.py` in packages/sdk-python.\n"
        + result.stderr
    )
