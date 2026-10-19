"""Isolate the API's global ResultStore from the developer's /tmp/myai-store.

services.api.store builds STORE at import time, so the environment is set here,
before any test module imports the app.
"""

from __future__ import annotations

import os
import tempfile

import pytest

_STORE_DIR = tempfile.mkdtemp(prefix="myai-test-store-")
os.environ["MYAI_STORE"] = _STORE_DIR
for _var in ("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN", "VERCEL"):
    os.environ.pop(_var, None)


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    from services.api.main import SCORE_GLOBAL_LIMIT, SCORE_LIMIT, SHARE_GLOBAL_LIMIT, SHARE_LIMIT

    for limiter in (SCORE_LIMIT, SHARE_LIMIT, SCORE_GLOBAL_LIMIT, SHARE_GLOBAL_LIMIT):
        limiter.reset()
    yield
