"""Pinecone wrapper for the RAG/CAG index.

- Reuses the sentence-transformer singleton from `similarity.py` so we don't
  load the model twice in memory.
- Stores only short, whitelisted metadata in Pinecone; full chunk text lives
  in SQLite (see `document_store.py`).
- Per-user namespace isolation: every call requires a namespace (the user id).
"""

from __future__ import annotations

import os
import time
from typing import Any

from .similarity import EMBEDDING_DIM, EMBEDDING_MODEL_NAME, get_embedder


INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "udl-content")
_CLOUD = os.getenv("PINECONE_CLOUD", "aws")
_REGION = os.getenv("PINECONE_REGION", "us-east-1")
_API_KEY = os.getenv("PINECONE_API_KEY") or ""

_TEXT_PREVIEW_CHARS = 200
_UPSERT_BATCH = 100
_pinecone_index: Any | None = None


class PineconeUnavailable(RuntimeError):
    """Raised when Pinecone is not configured. Callers should surface a 503."""


def is_available() -> bool:
    return bool(_API_KEY)


def _client():
    if not _API_KEY:
        raise PineconeUnavailable(
            "PINECONE_API_KEY is not set. Add it to backend/.env to enable RAG."
        )
    from pinecone import Pinecone  # type: ignore

    return Pinecone(api_key=_API_KEY)


def get_index():
    """Return the (cached) Pinecone index handle, creating it if needed."""
    global _pinecone_index
    if _pinecone_index is not None:
        return _pinecone_index

    pc = _client()
    names = {idx["name"] for idx in pc.list_indexes()}
    if INDEX_NAME not in names:
        from pinecone import ServerlessSpec  # type: ignore

        print(f"[vector_store] creating Pinecone index '{INDEX_NAME}' "
              f"(dim={EMBEDDING_DIM}, model={EMBEDDING_MODEL_NAME}, "
              f"cloud={_CLOUD}, region={_REGION})")
        pc.create_index(
            name=INDEX_NAME,
            dimension=EMBEDDING_DIM,
            metric="cosine",
            spec=ServerlessSpec(cloud=_CLOUD, region=_REGION),
        )
        # Pinecone serverless indexes are usually ready within a few seconds
        for _ in range(20):
            desc = pc.describe_index(INDEX_NAME)
            if desc.status.get("ready") if isinstance(desc.status, dict) else desc.status.ready:
                break
            time.sleep(1)

    _pinecone_index = pc.Index(INDEX_NAME)
    return _pinecone_index


def upsert_chunks(chunks: list[dict], namespace: str) -> int:
    """Embed and upsert chunks. Returns the number of vectors written."""
    if not chunks:
        return 0
    index = get_index()
    embedder = get_embedder()

    texts = [c["text"] for c in chunks]
    embeddings = embedder.encode(texts, show_progress_bar=False, normalize_embeddings=True)

    written = 0
    for start in range(0, len(chunks), _UPSERT_BATCH):
        batch = []
        for offset, chunk in enumerate(chunks[start : start + _UPSERT_BATCH]):
            vec = embeddings[start + offset]
            batch.append(
                {
                    "id": chunk["id"],
                    "values": vec.tolist() if hasattr(vec, "tolist") else list(vec),
                    "metadata": _build_metadata(chunk),
                }
            )
        index.upsert(vectors=batch, namespace=namespace)
        written += len(batch)
    return written


def query(query_text: str, namespace: str, top_k: int = 5) -> list[dict]:
    if not query_text or not query_text.strip():
        return []
    index = get_index()
    embedder = get_embedder()
    vec = embedder.encode([query_text], show_progress_bar=False, normalize_embeddings=True)[0]

    result = index.query(
        vector=vec.tolist() if hasattr(vec, "tolist") else list(vec),
        top_k=top_k,
        namespace=namespace,
        include_metadata=True,
    )
    matches = result.get("matches") if isinstance(result, dict) else getattr(result, "matches", [])
    out: list[dict] = []
    for m in matches or []:
        mid = m["id"] if isinstance(m, dict) else m.id
        mscore = m["score"] if isinstance(m, dict) else m.score
        mmeta = m.get("metadata") if isinstance(m, dict) else getattr(m, "metadata", {}) or {}
        out.append({"id": mid, "score": float(mscore or 0.0), "metadata": dict(mmeta or {})})
    return out


def delete_ids(ids: list[str], namespace: str) -> int:
    if not ids:
        return 0
    index = get_index()
    # Pinecone accepts up to 1000 ids per delete; batch defensively.
    for start in range(0, len(ids), 1000):
        index.delete(ids=ids[start : start + 1000], namespace=namespace)
    return len(ids)


def _build_metadata(chunk: dict) -> dict:
    """Pinecone metadata is capped at 40KB per vector; keep it small."""
    text = chunk.get("text") or ""
    simplified = chunk.get("simplified_text") or ""
    md: dict[str, Any] = {
        "doc_id": chunk["doc_id"],
        "chunk_index": int(chunk.get("chunk_index", 0)),
        "modality": chunk.get("modality") or "text",
        "source_modality": chunk.get("source_modality") or "text",
        "text_preview": text[:_TEXT_PREVIEW_CHARS],
        "bias_score": float(chunk.get("bias_score") or 0.0),
    }
    if simplified:
        md["simplified_preview"] = simplified[:_TEXT_PREVIEW_CHARS]
    if chunk.get("page") is not None:
        md["page"] = int(chunk["page"])
    if chunk.get("timestamp") is not None:
        md["timestamp"] = float(chunk["timestamp"])
    return md
