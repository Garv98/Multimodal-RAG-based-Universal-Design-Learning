from __future__ import annotations

import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Model preference chain - tried in order, first available wins.
# Swap / extend freely; output contract is unchanged.
# ---------------------------------------------------------------------------
_MODEL_CANDIDATES = [
    # Best quality / speed trade-off for semantic similarity (2024-era)
    "BAAI/bge-small-en-v1.5",
    # Strong all-rounder, slightly larger
    "sentence-transformers/all-mpnet-base-v2",
    # Lightweight fallback still better than MiniLM-L6
    "sentence-transformers/paraphrase-MiniLM-L12-v2",
    # Last-resort: original model from the old code
    "all-MiniLM-L6-v2",
]

# Keep these for vector_store compatibility (index dim + logging).
EMBEDDING_DIM = 384
EMBEDDING_MODEL_NAME = _MODEL_CANDIDATES[0]

_model_lock = threading.Lock()
_similarity_model = None
_loaded_model_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Internal loader
# ---------------------------------------------------------------------------

def _try_load_model(name: str):
    """Attempt to load a SentenceTransformer by name. Returns model or None."""
    try:
        from sentence_transformers import SentenceTransformer
        logger.info("Loading sentence-transformer: %s...", name)
        model = SentenceTransformer(name)
        logger.info("Loaded: %s", name)
        return model
    except Exception as exc:
        logger.warning("Could not load %s: %s", name, exc)
        return None


def _model_dim(model) -> Optional[int]:
    try:
        dim = model.get_sentence_embedding_dimension()
        return int(dim)
    except Exception:
        return None


def get_embedder():
    """Return a cached SentenceTransformer, trying candidates in order."""
    global _similarity_model, _loaded_model_name, EMBEDDING_MODEL_NAME

    with _model_lock:
        if _similarity_model is not None:
            return _similarity_model

        for candidate in _MODEL_CANDIDATES:
            model = _try_load_model(candidate)
            if model is None:
                continue

            dim = _model_dim(model)
            if dim is not None and dim != EMBEDDING_DIM:
                logger.warning(
                    "Skipping %s (dim=%s) because EMBEDDING_DIM=%s", candidate, dim, EMBEDDING_DIM
                )
                continue

            _similarity_model = model
            _loaded_model_name = candidate
            EMBEDDING_MODEL_NAME = candidate
            return _similarity_model

    raise RuntimeError(
        "No sentence-transformers model could be loaded. "
        "Install the package: pip install sentence-transformers"
    )


def load_similarity_model():
    """Public helper - returns model or None (never raises)."""
    try:
        return get_embedder()
    except Exception as exc:
        logger.error("Error loading similarity model: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Core similarity helpers
# ---------------------------------------------------------------------------

def _encode_texts(model, *texts):
    """Encode one or more texts; always returns tensors."""
    from sentence_transformers import SentenceTransformer  # noqa: F401 (import check)
    return model.encode(list(texts), convert_to_tensor=True, show_progress_bar=False)


def _cosine(t1, t2) -> float:
    from sentence_transformers import util
    return util.cos_sim(t1, t2).item()


def _interpret_similarity(score: float) -> str:
    if score >= 0.9:
        return "Excellent - Nearly identical meaning"
    elif score >= 0.8:
        return "Very High - Meaning well preserved"
    elif score >= 0.7:
        return "High - Most meaning preserved"
    elif score >= 0.6:
        return "Moderate - Some meaning preserved"
    elif score >= 0.5:
        return "Low - Significant meaning change"
    else:
        return "Very Low - Meaning substantially different"


def _fallback_similarity(text1: str, text2: str) -> dict:
    """Jaccard overlap - used only when no model is available at all."""
    words1 = set(text1.lower().split())
    words2 = set(text2.lower().split())

    if not words1 or not words2:
        return {"success": False, "score": 0, "error": "Empty text"}

    union = len(words1 | words2)
    score = len(words1 & words2) / union if union else 0.0

    return {
        "success": True,
        "score": round(score, 4),
        "percentage": round(score * 100, 1),
        "interpretation": _interpret_similarity(score),
        "model": "jaccard-fallback",
        "note": "Install sentence-transformers for better accuracy",
    }


# ---------------------------------------------------------------------------
# Public API (output dictionaries are identical to the original)
# ---------------------------------------------------------------------------

def compute_similarity(text1: str, text2: str) -> dict:
    """
    Compute semantic similarity between two texts.

    Returns a dict with keys:
        success, score, percentage, interpretation, model
        (or success=False + error on failure)
    """
    if not text1 or not text2:
        return {"success": False, "score": 0, "error": "Both texts are required"}

    model = load_similarity_model()
    if model is None:
        return _fallback_similarity(text1, text2)

    try:
        embeddings = _encode_texts(model, text1, text2)
        score = round(_cosine(embeddings[0], embeddings[1]), 4)

        return {
            "success": True,
            "score": score,
            "percentage": round(score * 100, 1),
            "interpretation": _interpret_similarity(score),
            "model": _loaded_model_name or "sentence-transformer",
        }

    except ImportError:
        return _fallback_similarity(text1, text2)
    except Exception as exc:
        logger.exception("compute_similarity failed")
        return {"success": False, "score": 0, "error": str(exc)}


def compute_batch_similarity(reference_text: str, comparison_texts: list[str]) -> dict:
    """
    Compute similarity between one reference text and many comparison texts.

    Returns a dict with keys: success, reference, comparisons
        comparisons is a list of {text, score, interpretation}
    """
    if not reference_text or not comparison_texts:
        return {"success": False, "error": "Reference text and comparison list are required"}

    model = load_similarity_model()
    if model is None:
        return {"success": False, "error": "Model not available"}

    try:
        from sentence_transformers import util

        # Encode everything in a single batched call - faster than one-by-one
        all_texts = [reference_text] + list(comparison_texts)
        all_embeddings = _encode_texts(model, *all_texts)

        ref_embedding = all_embeddings[0]
        comp_embeddings = all_embeddings[1:]

        similarities = util.cos_sim(ref_embedding, comp_embeddings)[0]

        results = []
        for i, text in enumerate(comparison_texts):
            score = similarities[i].item()
            results.append({
                "text": (text[:100] + "...") if len(text) > 100 else text,
                "score": round(score, 4),
                "interpretation": _interpret_similarity(score),
            })

        return {
            "success": True,
            "reference": (reference_text[:100] + "...") if len(reference_text) > 100 else reference_text,
            "comparisons": results,
        }

    except Exception as exc:
        logger.exception("compute_batch_similarity failed")
        return {"success": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# Convenience: expose the active model name for diagnostics
# ---------------------------------------------------------------------------

def get_loaded_model_name() -> Optional[str]:
    """Return the name of whichever model is currently loaded (or None)."""
    return _loaded_model_name
