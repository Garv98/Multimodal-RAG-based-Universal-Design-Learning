"""SQLite persistence for documents + chunks.

Pinecone holds vectors and small metadata; SQLite holds the full chunk text and
the original processing payload. On retrieval the backend hydrates chunk text
from SQLite using the IDs returned by Pinecone.

Every query enforces user_id isolation as defense-in-depth on top of the
Pinecone namespace.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from typing import Any

_DB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
os.makedirs(_DB_DIR, exist_ok=True)
_DB_PATH = os.path.join(_DB_DIR, "udl.db")
_LOCK = threading.RLock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  modality TEXT NOT NULL,
  original_text TEXT,
  simplified_text TEXT,
  processed_results_json TEXT,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  bias_score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  simplified_text TEXT,
  metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_user ON chunks(user_id);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with _LOCK, _connect() as conn:
        conn.executescript(_SCHEMA)


init_db()


def save_document(document: dict) -> None:
    with _LOCK, _connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO documents
              (id, user_id, name, modality, original_text, simplified_text,
               processed_results_json, total_chunks, bias_score, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                document["id"],
                document["user_id"],
                document["name"],
                document["modality"],
                document.get("original_text") or "",
                document.get("simplified_text") or "",
                json.dumps(document.get("processed_results_json") or {}),
                int(document.get("total_chunks") or 0),
                float(document.get("bias_score") or 0.0),
                document["created_at"],
            ),
        )


def save_chunks(chunks: list[dict]) -> None:
    if not chunks:
        return
    rows = [
        (
            c["id"],
            c["doc_id"],
            c["user_id"],
            int(c["chunk_index"]),
            c["text"],
            c.get("simplified_text") or "",
            json.dumps(
                {
                    "modality": c.get("modality"),
                    "source_modality": c.get("source_modality"),
                    "page": c.get("page"),
                    "timestamp": c.get("timestamp"),
                    "bias_score": c.get("bias_score"),
                    "created_at": c.get("created_at"),
                }
            ),
        )
        for c in chunks
    ]
    with _LOCK, _connect() as conn:
        conn.executemany(
            """
            INSERT OR REPLACE INTO chunks
              (id, doc_id, user_id, chunk_index, text, simplified_text, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )


def get_document(doc_id: str, user_id: str) -> dict | None:
    with _LOCK, _connect() as conn:
        row = conn.execute(
            "SELECT * FROM documents WHERE id = ? AND user_id = ?",
            (doc_id, user_id),
        ).fetchone()
    return _doc_row_to_dict(row) if row else None


def list_documents(user_id: str) -> list[dict]:
    with _LOCK, _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, name, modality, total_chunks, bias_score, created_at
            FROM documents
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (user_id,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "modality": r["modality"],
            "total_chunks": r["total_chunks"],
            "bias_score": r["bias_score"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def get_chunks_by_ids(ids: list[str], user_id: str) -> list[dict]:
    if not ids:
        return []
    placeholders = ",".join("?" for _ in ids)
    with _LOCK, _connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM chunks WHERE user_id = ? AND id IN ({placeholders})",
            (user_id, *ids),
        ).fetchall()
    # Preserve the order requested by `ids`
    by_id = {r["id"]: r for r in rows}
    out: list[dict] = []
    for cid in ids:
        r = by_id.get(cid)
        if not r:
            continue
        out.append(_chunk_row_to_dict(r))
    return out


def get_chunk_ids_for_doc(doc_id: str, user_id: str) -> list[str]:
    with _LOCK, _connect() as conn:
        rows = conn.execute(
            "SELECT id FROM chunks WHERE doc_id = ? AND user_id = ?",
            (doc_id, user_id),
        ).fetchall()
    return [r["id"] for r in rows]


def delete_document(doc_id: str, user_id: str) -> int:
    with _LOCK, _connect() as conn:
        cur = conn.execute(
            "DELETE FROM documents WHERE id = ? AND user_id = ?",
            (doc_id, user_id),
        )
        # CASCADE removes chunks
    return cur.rowcount


def _doc_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "name": row["name"],
        "modality": row["modality"],
        "original_text": row["original_text"],
        "simplified_text": row["simplified_text"],
        "processed_results_json": _safe_json(row["processed_results_json"]),
        "total_chunks": row["total_chunks"],
        "bias_score": row["bias_score"],
        "created_at": row["created_at"],
    }


def _chunk_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "doc_id": row["doc_id"],
        "user_id": row["user_id"],
        "chunk_index": row["chunk_index"],
        "text": row["text"],
        "simplified_text": row["simplified_text"],
        "metadata": _safe_json(row["metadata_json"]),
    }


def _safe_json(value: Any) -> Any:
    if not value:
        return {}
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return {}
