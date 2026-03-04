"""Tests for API endpoints."""

import hashlib
import hmac
import json
import time

import pytest
from fastapi.testclient import TestClient

from src.config import settings
from src.main import app


@pytest.fixture
def client():
    return TestClient(app)


def _auth_headers(body: dict) -> dict:
    """Generate valid auth headers for testing."""
    body_bytes = json.dumps(body).encode()
    timestamp = str(int(time.time()))
    message = f"{timestamp}.".encode() + body_bytes
    signature = hmac.new(
        settings.service_secret.encode(), message, hashlib.sha256
    ).hexdigest()
    return {
        "x-ai-signature": signature,
        "x-ai-timestamp": timestamp,
        "Content-Type": "application/json",
    }


class TestHealth:
    def test_health_ok(self, client):
        resp = client.get("/ai/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["service"] == "ai-advisor"
        assert "version" in data


class TestRecommendEndpoint:
    def test_unauthenticated_rejected(self, client):
        resp = client.post("/ai/recommend", json={"pair": {}})
        assert resp.status_code == 401

    def test_bad_timestamp_rejected(self, client):
        body = {"pair": {"token_a": "0xaaa", "token_b": "0xbbb"}}
        headers = _auth_headers(body)
        headers["x-ai-timestamp"] = "0"  # expired
        resp = client.post("/ai/recommend", json=body, headers=headers)
        assert resp.status_code == 401


class TestSuggestPairsEndpoint:
    def test_unauthenticated_rejected(self, client):
        resp = client.post("/ai/suggest-pairs", json={})
        assert resp.status_code == 401


class TestValidateEndpoint:
    def test_unauthenticated_rejected(self, client):
        resp = client.post("/ai/refresh-quote-and-validate", json={})
        assert resp.status_code == 401
