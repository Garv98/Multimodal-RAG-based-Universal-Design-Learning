"""Modality-aware chunking for the RAG/CAG index.

Takes the unified ProcessingResult emitted by the existing pipeline and produces
a list of indexable Chunks. Each modality has its own slicing strategy:

  text/pdf   ->  sentence-aware sliding window (~350 words, 50-word overlap)
  image      ->  one chunk per image, content = alt-text + captions + OCR
  audio      ->  one chunk per speaker turn (preserves who-said-what context)
  video      ->  same as audio (speaker_segments from video pipeline)

The chunker also threads two UDL signals into each chunk:
  - simplified_text:  best-effort mapping to the simplified version
  - bias_score:       document-level score (0..100) so retrieval can filter
                      out chunks above a configurable threshold
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any


# Sliding-window parameters for prose chunks
CHUNK_TARGET_WORDS = 350
CHUNK_OVERLAP_WORDS = 50
# Image chunks never get split; a chunk this size is unlikely anyway
IMAGE_MAX_CHARS = 8000


def chunk_results(
    *,
    user_id: str,
    doc_name: str,
    modality: str,
    processing_results: dict,
) -> tuple[dict, list[dict]]:
    """Build a document record + its chunks from a ProcessingResult payload.

    Returns (document, chunks). The caller persists both.
    """
    doc_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    extraction = processing_results.get("extraction") or {}
    simplification = processing_results.get("simplification") or {}
    bias = processing_results.get("bias") or {}
    transcript = processing_results.get("transcript") or {}
    alttext = processing_results.get("alttext") or {}

    original_text = (
        extraction.get("text")
        or simplification.get("original")
        or transcript.get("text")
        or ""
    )
    simplified_text = simplification.get("simplified") or ""
    bias_score = float(bias.get("bias_score", 0)) if bias else 0.0
    source_modality = _infer_source_modality(extraction, alttext, transcript, modality)

    chunks: list[dict]
    if source_modality == "image":
        chunks = _chunk_image(alttext, extraction, doc_id, user_id, created_at, bias_score)
    elif source_modality in ("audio", "video") and transcript.get("speaker_turns"):
        chunks = _chunk_speaker_turns(
            transcript, doc_id, user_id, created_at, bias_score, source_modality
        )
    elif source_modality == "audio" and transcript.get("text"):
        chunks = _chunk_prose(
            transcript["text"],
            simplified_text,
            doc_id,
            user_id,
            created_at,
            bias_score,
            source_modality,
            modality_label="audio",
        )
    else:
        chunks = _chunk_prose(
            original_text,
            simplified_text,
            doc_id,
            user_id,
            created_at,
            bias_score,
            source_modality,
            modality_label="text",
        )

    document = {
        "id": doc_id,
        "user_id": user_id,
        "name": doc_name,
        "modality": source_modality,
        "original_text": original_text,
        "simplified_text": simplified_text,
        "processed_results_json": processing_results,
        "total_chunks": len(chunks),
        "bias_score": bias_score,
        "created_at": created_at,
    }
    return document, chunks


# ---------------------------------------------------------------------------
# Modality-specific helpers
# ---------------------------------------------------------------------------


def _chunk_prose(
    text: str,
    simplified_text: str,
    doc_id: str,
    user_id: str,
    created_at: str,
    bias_score: float,
    source_modality: str,
    modality_label: str,
) -> list[dict]:
    text = (text or "").strip()
    if not text:
        return []

    sentences = _split_sentences(text)
    if not sentences:
        sentences = [text]

    chunks: list[dict] = []
    window: list[str] = []
    window_words = 0
    chunk_index = 0

    def emit(window_sentences: list[str]) -> None:
        nonlocal chunk_index
        body = " ".join(window_sentences).strip()
        if not body:
            return
        chunks.append(
            _make_chunk(
                text=body,
                simplified_text=simplified_text,
                modality=modality_label,
                source_modality=source_modality,
                chunk_index=chunk_index,
                doc_id=doc_id,
                user_id=user_id,
                created_at=created_at,
                bias_score=bias_score,
                page=None,
                timestamp=None,
            )
        )
        chunk_index += 1

    for sent in sentences:
        words = len(sent.split())
        if window_words + words > CHUNK_TARGET_WORDS and window:
            emit(window)
            # Carry tail sentences as overlap
            window = _tail_overlap(window, CHUNK_OVERLAP_WORDS)
            window_words = sum(len(s.split()) for s in window)
        window.append(sent)
        window_words += words

    if window:
        emit(window)

    return chunks


def _chunk_image(
    alttext: dict,
    extraction: dict,
    doc_id: str,
    user_id: str,
    created_at: str,
    bias_score: float,
) -> list[dict]:
    parts: list[str] = []
    for key in ("alt_text", "detailed_caption", "enhanced_description", "raw_caption"):
        v = alttext.get(key) or extraction.get(key)
        if v and v not in parts:
            parts.append(str(v))
    ocr = alttext.get("ocr_text") or extraction.get("ocr_text")
    if ocr:
        parts.append(f"OCR: {ocr}")

    info = alttext.get("image_info") or extraction.get("image_info")
    if isinstance(info, dict):
        w, h = info.get("width"), info.get("height")
        if w and h:
            parts.append(f"Image dimensions: {w}x{h}")

    text = " | ".join(parts).strip()[:IMAGE_MAX_CHARS]
    if not text:
        return []

    return [
        _make_chunk(
            text=text,
            simplified_text="",
            modality="image",
            source_modality="image",
            chunk_index=0,
            doc_id=doc_id,
            user_id=user_id,
            created_at=created_at,
            bias_score=bias_score,
            page=None,
            timestamp=None,
        )
    ]


def _chunk_speaker_turns(
    transcript: dict,
    doc_id: str,
    user_id: str,
    created_at: str,
    bias_score: float,
    source_modality: str,
) -> list[dict]:
    turns = transcript.get("speaker_turns") or []
    chunks: list[dict] = []
    for idx, turn in enumerate(turns):
        body = (turn.get("text") or "").strip()
        if not body:
            continue
        speaker = turn.get("speaker", "?")
        start = turn.get("start")
        chunks.append(
            _make_chunk(
                text=f"Speaker {speaker}: {body}",
                simplified_text="",
                modality=f"{source_modality}_turn",
                source_modality=source_modality,
                chunk_index=idx,
                doc_id=doc_id,
                user_id=user_id,
                created_at=created_at,
                bias_score=bias_score,
                page=None,
                timestamp=float(start) if start is not None else None,
            )
        )
    return chunks


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(\[])")


def _split_sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    parts = _SENTENCE_SPLIT.split(text)
    # Final fallback for huge single sentences
    out: list[str] = []
    for p in parts:
        if len(p.split()) > CHUNK_TARGET_WORDS:
            out.extend(_force_split(p, CHUNK_TARGET_WORDS))
        else:
            out.append(p)
    return [p for p in out if p]


def _force_split(sentence: str, target_words: int) -> list[str]:
    words = sentence.split()
    return [" ".join(words[i : i + target_words]) for i in range(0, len(words), target_words)]


def _tail_overlap(sentences: list[str], target_words: int) -> list[str]:
    tail: list[str] = []
    word_budget = target_words
    for sent in reversed(sentences):
        w = len(sent.split())
        if w > word_budget and tail:
            break
        tail.insert(0, sent)
        word_budget -= w
        if word_budget <= 0:
            break
    return tail


def _make_chunk(
    *,
    text: str,
    simplified_text: str,
    modality: str,
    source_modality: str,
    chunk_index: int,
    doc_id: str,
    user_id: str,
    created_at: str,
    bias_score: float,
    page: int | None,
    timestamp: float | None,
) -> dict:
    return {
        "id": f"{doc_id}::{chunk_index}",
        "doc_id": doc_id,
        "user_id": user_id,
        "chunk_index": chunk_index,
        "text": text,
        "simplified_text": simplified_text,
        "modality": modality,
        "source_modality": source_modality,
        "page": page,
        "timestamp": timestamp,
        "bias_score": bias_score,
        "created_at": created_at,
    }


def _infer_source_modality(
    extraction: dict, alttext: dict, transcript: dict, fallback: str
) -> str:
    source = (extraction.get("source") or "").lower()
    if source in ("pdf", "image", "audio", "video", "text", "direct_input"):
        if source == "direct_input":
            return "text"
        return source
    if alttext:
        return "image"
    if transcript and (transcript.get("speaker_turns") or transcript.get("text")):
        return "audio"
    return (fallback or "text").lower()


def estimate_tokens(text: str) -> int:
    """Cheap approximate token count for budget checks (4 chars/token)."""
    return max(1, len(text) // 4)
