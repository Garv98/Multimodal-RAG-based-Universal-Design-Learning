"""Groq-backed generation for the RAG/CAG layer.

Two paths:
    generate_cag(doc_id, user_id, query)     -> single-document Q&A. Stuffs the
                                                processed document text into
                                                the system prompt. Auto-falls
                                                back to RAG above
                                                CAG_MAX_INPUT_TOKENS.

    generate_rag(user_id, query, top_k)      -> cross-library retrieval.
                                                Embeds the query, pulls top_k
                                                chunks from Pinecone, hydrates
                                                them from SQLite, builds a
                                                cited context block.

Both yield generator events:
    {"type": "citations", "data": [...]} | {"type": "mode", "data": {...}}
    {"type": "token",     "data": "..."}
    {"type": "done",      "data": {"answer": "..."}}
    {"type": "error",     "data": "..."}

The Flask endpoint translates these into Server-Sent Events.
"""

from __future__ import annotations

import os
from typing import Iterator

from . import document_store, vector_store
from .chunking import estimate_tokens

GROQ_MODEL = os.getenv("GROQ_GENERATION_MODEL", "llama-3.3-70b-versatile")
CAG_MAX_INPUT_TOKENS = int(os.getenv("CAG_MAX_INPUT_TOKENS", "50000"))

_SYSTEM_GROUNDING = (
    "You are an accessible learning assistant for the Universal Content "
    "Converter. Answer clearly using only the provided context. If the "
    "context does not contain the answer, say so plainly. Prefer short "
    "sentences and concrete examples. Cite sources inline as [Source N] "
    "when you draw on them."
)


def _groq_client():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set in backend/.env")
    from groq import Groq  # type: ignore

    return Groq(api_key=api_key)


# ---------------------------------------------------------------------------
# CAG — single-document Q&A
# ---------------------------------------------------------------------------


def generate_cag(doc_id: str, user_id: str, query: str) -> Iterator[dict]:
    if not query.strip():
        yield {"type": "error", "data": "Empty query."}
        return

    doc = document_store.get_document(doc_id, user_id)
    if not doc:
        yield {"type": "error", "data": f"Document {doc_id} not found in your library."}
        return

    original = doc.get("original_text") or ""
    simplified = doc.get("simplified_text") or ""
    context_text = original
    if simplified and simplified.strip() and simplified != original:
        context_text = f"{original}\n\n---\nSimplified version of the same content:\n{simplified}"

    tokens = estimate_tokens(context_text)
    if tokens > CAG_MAX_INPUT_TOKENS:
        yield {
            "type": "mode",
            "data": {
                "effective_mode": "rag",
                "fallback_reason": (
                    f"Document is ~{tokens} tokens (limit {CAG_MAX_INPUT_TOKENS}); "
                    "switching to retrieval over its chunks."
                ),
            },
        }
        yield from _generate_rag_over_doc(doc_id=doc_id, user_id=user_id, query=query)
        return

    yield {"type": "mode", "data": {"effective_mode": "cag"}}

    system_prompt = (
        f"{_SYSTEM_GROUNDING}\n\n"
        f"You are answering questions about a document titled "
        f"\"{doc.get('name')}\". The full document text is below.\n\n"
        f"=== DOCUMENT ===\n{context_text}\n=== END DOCUMENT ==="
    )

    yield from _stream_chat(system_prompt=system_prompt, user_query=query)


def _generate_rag_over_doc(*, doc_id: str, user_id: str, query: str) -> Iterator[dict]:
    """RAG scoped to a single document (used as CAG fallback)."""
    if not vector_store.is_available():
        yield {
            "type": "error",
            "data": "Document is too large for CAG and Pinecone is not configured for RAG fallback.",
        }
        return
    matches = vector_store.query(query, namespace=user_id, top_k=8)
    matches = [m for m in matches if m["metadata"].get("doc_id") == doc_id]
    if not matches:
        yield {"type": "error", "data": "No relevant context found in this document."}
        return
    yield from _rag_from_matches(matches=matches, user_id=user_id, query=query)


# ---------------------------------------------------------------------------
# RAG — cross-library
# ---------------------------------------------------------------------------


def generate_rag(user_id: str, query: str, top_k: int = 5) -> Iterator[dict]:
    if not query.strip():
        yield {"type": "error", "data": "Empty query."}
        return

    if not vector_store.is_available():
        yield {
            "type": "error",
            "data": "Pinecone is not configured. Add PINECONE_API_KEY to backend/.env to enable RAG.",
        }
        return

    matches = vector_store.query(query, namespace=user_id, top_k=top_k)
    if not matches:
        yield {"type": "citations", "data": []}
        yield {"type": "mode", "data": {"effective_mode": "rag"}}
        yield {
            "type": "done",
            "data": {
                "answer": (
                    "Your library is empty for that query. Upload and process a document "
                    "first, or try a different question."
                )
            },
        }
        return
    yield from _rag_from_matches(matches=matches, user_id=user_id, query=query)


def _rag_from_matches(*, matches: list[dict], user_id: str, query: str) -> Iterator[dict]:
    chunk_ids = [m["id"] for m in matches]
    chunks_by_id = {c["id"]: c for c in document_store.get_chunks_by_ids(chunk_ids, user_id)}

    # Hydrate document names so citations can carry friendly labels
    doc_names: dict[str, str] = {}
    for cid, c in chunks_by_id.items():
        doc_id = c["doc_id"]
        if doc_id not in doc_names:
            doc = document_store.get_document(doc_id, user_id)
            doc_names[doc_id] = (doc or {}).get("name") or doc_id

    citations: list[dict] = []
    context_blocks: list[str] = []
    for idx, m in enumerate(matches, start=1):
        chunk = chunks_by_id.get(m["id"])
        meta = m["metadata"] or {}
        doc_id = meta.get("doc_id") or (chunk or {}).get("doc_id") or ""
        text_preview = meta.get("text_preview") or ((chunk or {}).get("text") or "")[:200]
        full_text = (chunk or {}).get("text") or text_preview

        citations.append(
            {
                "doc_id": doc_id,
                "doc_name": doc_names.get(doc_id, doc_id),
                "chunk_index": int(meta.get("chunk_index", (chunk or {}).get("chunk_index", 0))),
                "score": m["score"],
                "text_preview": text_preview,
                "page": meta.get("page"),
                "timestamp": meta.get("timestamp"),
            }
        )
        context_blocks.append(
            f"[Source {idx} — {doc_names.get(doc_id, doc_id)}]\n{full_text}"
        )

    yield {"type": "citations", "data": citations}
    yield {"type": "mode", "data": {"effective_mode": "rag"}}

    context_text = "\n\n".join(context_blocks)
    system_prompt = (
        f"{_SYSTEM_GROUNDING}\n\n"
        f"Retrieved context follows. Cite by Source number when used.\n\n"
        f"=== CONTEXT ===\n{context_text}\n=== END CONTEXT ==="
    )

    yield from _stream_chat(system_prompt=system_prompt, user_query=query)


# ---------------------------------------------------------------------------
# Shared chat streaming
# ---------------------------------------------------------------------------


_STUDY_DOC_TOKEN_CAP = 40_000  # Leaves room for output even on smaller models.


def _load_doc_text(doc_id: str, user_id: str) -> tuple[str, str] | None:
    """Return (doc_name, body_for_llm) or None if not found."""
    doc = document_store.get_document(doc_id, user_id)
    if not doc:
        return None
    body = doc.get("original_text") or ""
    simplified = doc.get("simplified_text") or ""
    if simplified and simplified.strip() and simplified != body:
        body = f"{body}\n\n---\nSimplified version:\n{simplified}"
    # Truncate for study-tool features so we always fit easily.
    if estimate_tokens(body) > _STUDY_DOC_TOKEN_CAP:
        # 4 chars/token approx
        body = body[: _STUDY_DOC_TOKEN_CAP * 4]
    return doc.get("name") or doc_id, body


def generate_summary(
    doc_id: str, user_id: str, length: str = "medium"
) -> Iterator[dict]:
    """Stream a length-controlled summary of a single document."""
    loaded = _load_doc_text(doc_id, user_id)
    if loaded is None:
        yield {"type": "error", "data": f"Document {doc_id} not found."}
        return
    doc_name, body = loaded

    length_directive = {
        "short": "Write a single concise sentence that captures the main point.",
        "medium": "Write one well-structured paragraph (4-7 sentences) covering the key ideas.",
        "detailed": (
            "Write a multi-paragraph summary with a brief intro, the main points "
            "organised under short subheadings (use ##), and a one-line takeaway."
        ),
    }.get(length, "Write one paragraph covering the key ideas.")

    system_prompt = (
        "You are an accessible learning assistant. Summarise documents in plain "
        "language for diverse learners. Preserve facts, names, and numbers; do "
        "not invent details. Use short sentences and concrete examples.\n\n"
        f"Length requirement: {length_directive}\n\n"
        f"=== DOCUMENT: {doc_name} ===\n{body}\n=== END DOCUMENT ==="
    )
    yield {"type": "mode", "data": {"effective_mode": "summary", "length": length}}
    yield from _stream_chat(system_prompt=system_prompt, user_query="Produce the summary now.")


def generate_quiz(
    doc_id: str,
    user_id: str,
    n_questions: int = 5,
    difficulty: str = "medium",
) -> dict:
    """Return parsed quiz JSON. Non-streaming (clients render after parse)."""
    loaded = _load_doc_text(doc_id, user_id)
    if loaded is None:
        return {"success": False, "error": f"Document {doc_id} not found."}
    doc_name, body = loaded
    n = max(3, min(10, int(n_questions)))
    diff = (difficulty or "medium").strip().lower()
    if diff not in {"easy", "medium", "hard"}:
        diff = "medium"

    difficulty_directive = {
        "easy": (
            "Use direct recall questions that match key sentences. Keep wording simple."
        ),
        "medium": (
            "Mix direct recall and basic reasoning across sections. Keep distractors plausible."
        ),
        "hard": (
            "Favor multi-step reasoning, comparisons, or cause-effect. Distractors should be subtle."
        ),
    }[diff]

    system_prompt = (
        "You are an educational quiz generator. Read the document and produce "
        f"exactly {n} multiple-choice questions that test understanding of the "
        "most important concepts. Avoid trivia. Cover different sections of the "
        "document. Make distractors plausible but clearly wrong.\n\n"
        f"Difficulty: {difficulty_directive}\n\n"
        "Reply with a JSON object of this exact shape:\n"
        "{\n"
        '  "questions": [\n'
        '    {"question": "...", "options": ["...","...","...","..."], '
        '"correct_index": 0, "explanation": "..."}\n'
        "  ]\n"
        "}\n"
        "correct_index is a 0-based index into the options array. The "
        "explanation should be one short sentence citing the document."
    )

    try:
        client = _groq_client()
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            temperature=0.3,
            max_tokens=2048,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"=== DOCUMENT: {doc_name} ===\n{body}"},
            ],
        )
        import json
        data = json.loads(completion.choices[0].message.content or "{}")
        questions = data.get("questions") or []
        if not questions:
            return {"success": False, "error": "Model returned no questions."}
        return {"success": True, "doc_name": doc_name, "questions": questions}
    except Exception as exc:  # noqa: BLE001
        return {"success": False, "error": f"Quiz generation failed: {exc}"}


def generate_flashcards(doc_id: str, user_id: str, n_cards: int = 8) -> dict:
    """Return parsed flashcards JSON. Non-streaming."""
    loaded = _load_doc_text(doc_id, user_id)
    if loaded is None:
        return {"success": False, "error": f"Document {doc_id} not found."}
    doc_name, body = loaded
    n = max(4, min(20, int(n_cards)))

    system_prompt = (
        "You are a flashcard generator for learners. Extract the most important "
        f"{n} concepts from the document and turn each into a flashcard. The "
        "front should be a short term, name, or question; the back should be a "
        "1-2 sentence definition or answer in plain language. Avoid duplicating "
        "cards.\n\n"
        "Reply with a JSON object:\n"
        "{\n"
        '  "cards": [\n'
        '    {"front": "...", "back": "..."}\n'
        "  ]\n"
        "}"
    )

    try:
        client = _groq_client()
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            temperature=0.4,
            max_tokens=1800,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"=== DOCUMENT: {doc_name} ===\n{body}"},
            ],
        )
        import json
        data = json.loads(completion.choices[0].message.content or "{}")
        cards = data.get("cards") or []
        if not cards:
            return {"success": False, "error": "Model returned no flashcards."}
        return {"success": True, "doc_name": doc_name, "cards": cards}
    except Exception as exc:  # noqa: BLE001
        return {"success": False, "error": f"Flashcard generation failed: {exc}"}


def generate_misconception(
    question: str,
    wrong_choice: str,
    correct_choice: str,
    doc_context: str = "",
) -> dict:
    """Diagnose why a learner picked a wrong quiz answer + emit a micro-lesson."""
    if not question or not wrong_choice or not correct_choice:
        return {"success": False, "error": "Missing question or choices."}

    system_prompt = (
        "A learner picked a wrong answer on a quiz. In one short sentence, "
        "diagnose the likely misconception that made the wrong answer seem "
        "tempting. Then in one short sentence, give a plain-language "
        "micro-lesson that clears it up. Be encouraging, never condescending. "
        "Reply with JSON:\n"
        '{ "diagnosis": "...", "micro_lesson": "..." }'
    )
    user_content = (
        f"Question: {question}\n"
        f"Wrong answer the learner chose: {wrong_choice}\n"
        f"Correct answer: {correct_choice}\n"
        f"Document excerpt (for grounding):\n{(doc_context or '')[:1200]}"
    )

    try:
        client = _groq_client()
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            temperature=0.3,
            max_tokens=300,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
        )
        import json
        data = json.loads(completion.choices[0].message.content or "{}")
        return {
            "success": True,
            "diagnosis": (data.get("diagnosis") or "").strip(),
            "micro_lesson": (data.get("micro_lesson") or "").strip(),
        }
    except Exception as exc:  # noqa: BLE001
        return {"success": False, "error": f"Misconception analysis failed: {exc}"}


def _stream_chat(*, system_prompt: str, user_query: str) -> Iterator[dict]:
    try:
        client = _groq_client()
    except RuntimeError as exc:
        yield {"type": "error", "data": str(exc)}
        return

    try:
        stream = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_query},
            ],
            stream=True,
            temperature=0.4,
            max_tokens=1024,
        )
    except Exception as exc:
        yield {"type": "error", "data": f"Groq request failed: {exc}"}
        return

    answer_parts: list[str] = []
    try:
        for chunk in stream:
            delta = None
            choices = getattr(chunk, "choices", None)
            if choices:
                delta = getattr(choices[0].delta, "content", None)
            if delta:
                answer_parts.append(delta)
                yield {"type": "token", "data": delta}
    except Exception as exc:
        yield {"type": "error", "data": f"Stream interrupted: {exc}"}
        return

    yield {"type": "done", "data": {"answer": "".join(answer_parts)}}
