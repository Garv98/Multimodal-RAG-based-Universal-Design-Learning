import json
import os
import sys

# Force UTF-8 stdout/stderr so model modules with emoji prints don't crash on
# Windows (default cp1252) once they hit a non-ASCII character.
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except (AttributeError, OSError):
    pass

from flask import Flask, Response, request, jsonify, stream_with_context
from flask_cors import CORS

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from models.text_extraction import extract_text_from_pdf, extract_text_from_image
from models.simplification import simplify_text
from models.translation import translate_text
from models.similarity import compute_similarity
from models.bias_detection import detect_bias
from models.sign_language import generate_gloss
from models.image_captioning import generate_alt_text
from models.speech_to_text import transcribe_audio
from models.video_processing import process_video_for_accessibility, transcribe_video
from models import chunking, document_store, vector_store, generator

app = Flask(__name__)
CORS(
    app,
    origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    expose_headers=["X-User-Id"],
    allow_headers=["Content-Type", "X-User-Id", "Accept"],
)

def _current_user_id() -> str:
    return request.headers.get("X-User-Id") or "anonymous"


def _require_user_id():
    """Return (user_id, None) if authenticated, or (None, json-response) to abort.

    Library + generation endpoints reject anonymous so per-user isolation is
    real, not just convention. Preprocessing endpoints (/process/*) still
    allow anonymous because they don't persist anything per-user.
    """
    uid = (request.headers.get("X-User-Id") or "").strip()
    if not uid or uid.lower() == "anonymous":
        return None, (
            jsonify({
                "success": False,
                "error": "Sign in required. This endpoint is scoped to a specific user.",
                "code": "anonymous_blocked",
            }),
            401,
        )
    return uid, None


def _sse_event(event_type: str, payload) -> str:
    if isinstance(payload, (dict, list)):
        data = json.dumps(payload, ensure_ascii=False)
    else:
        data = str(payload)
    # Multi-line data values must be prefixed line-by-line per the SSE spec.
    data_lines = "\n".join(f"data: {line}" for line in data.split("\n"))
    return f"event: {event_type}\n{data_lines}\n\n"


UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500MB max for video uploads


@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "healthy",
        "message": "UDL Backend is running",
        "models": {
            "text_extraction": "ready",
            "simplification": "ready",
            "translation": "ready",
            "similarity": "ready",
            "bias_detection": "ready",
            "sign_language": "ready",
            "image_captioning": "Florence-2 + Groq",
            "speech_to_text": "ready",
            "video_processing": "ready"
        }
    })


@app.route("/process", methods=["POST"])
def process_all():
    """Main endpoint that processes all UDL transformations"""
    try:
        text_content = ""
        image_file = None
        audio_file = None
        pdf_file = None

        if request.is_json:
            data = request.get_json()
            text_content = data.get("text", "")
        else:
            text_content = request.form.get("text", "")
            
            if "image" in request.files:
                image_file = request.files["image"]
            if "audio" in request.files:
                audio_file = request.files["audio"]
            if "pdf" in request.files:
                pdf_file = request.files["pdf"]

        extracted_text = text_content
        
        if pdf_file and pdf_file.filename:
            pdf_result = extract_text_from_pdf(pdf_file)
            if pdf_result.get("success"):
                extracted_text = pdf_result.get("text", "")
        
        if image_file and image_file.filename and not extracted_text:
            ocr_result = extract_text_from_image(image_file)
            if ocr_result.get("success"):
                extracted_text = ocr_result.get("text", "")

        if audio_file and audio_file.filename and not extracted_text:
            audio_result = transcribe_audio(audio_file)
            if audio_result.get("success"):
                extracted_text = audio_result.get("transcript", "")

        simplification_result = simplify_text(extracted_text)
        simplified_text = simplification_result.get("simplified", extracted_text)
        
        results = {
            "extraction": {
                "text": extracted_text,
                "source": "pdf" if pdf_file else "image" if image_file else "audio" if audio_file else "direct"
            },
            "simplification": simplification_result,
            "translation": translate_text(simplified_text),
            "similarity": compute_similarity(extracted_text, simplified_text),
            "bias": detect_bias(extracted_text),
            "signlanguage": generate_gloss(simplified_text),
        }
        
        if image_file and image_file.filename:
            image_file.seek(0)
            results["alttext"] = generate_alt_text(image_file)
        
        if audio_file and audio_file.filename:
            audio_file.seek(0)
            results["transcript"] = transcribe_audio(audio_file)

        return jsonify({"success": True, "results": results})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/process/extraction", methods=["POST"])
def process_extraction():
    """Extract text from uploaded files"""
    try:
        if request.files:
            text = request.form.get("text", "")
            
            if "pdf" in request.files:
                pdf_file = request.files["pdf"]
                if pdf_file.filename:
                    print(f"📄 Processing PDF: {pdf_file.filename}")
                    result = extract_text_from_pdf(pdf_file)
                else:
                    result = {"success": True, "text": text, "source": "direct_input"}
            elif "image" in request.files:
                image_file = request.files["image"]
                if image_file.filename:
                    print(f"🖼️ Processing Image: {image_file.filename}")
                    result = extract_text_from_image(image_file)
                    # NOTE: Alt-text / captioning is intentionally NOT done here
                    # (Florence-2 + Groq adds 30-90s on CPU). The frontend
                    # pipeline fires /process/alttext as a separate follow-up
                    # step so the main pipeline stays responsive.
                else:
                    result = {"success": True, "text": text, "source": "direct_input"}
            elif "audio" in request.files:
                audio_file = request.files["audio"]
                if audio_file.filename:
                    print(f"🎤 Processing Audio: {audio_file.filename}")
                    result = transcribe_audio(audio_file)
                else:
                    result = {"success": True, "text": text, "source": "direct_input"}
            else:
                result = {"success": True, "text": text, "source": "direct_input"}
        elif request.content_type and 'application/json' in request.content_type:
            data = request.get_json() or {}
            text = data.get("text", "")
            result = {"success": True, "text": text, "source": "direct_input"}
        else:
            text = request.form.get("text", "") or request.values.get("text", "")
            result = {"success": True, "text": text, "source": "direct_input"}
        
        print(f"✅ Extraction complete: {len(result.get('text', ''))} characters")
        return jsonify({"success": True, "result": result})
    except Exception as e:
        print(f"❌ Extraction error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/process/simplification", methods=["POST"])
def process_simplification():
    try:
        data = request.get_json() or {}
        text = data.get("text", "")
        result = simplify_text(text)
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/process/translation", methods=["POST"])
def process_translation():
    try:
        data = request.get_json() or {}
        text = data.get("text", "")
        languages = data.get("languages", ["hi", "es", "fr", "de"]) 
        include_audio = data.get("include_audio", True) 
        
        result = translate_text(text, languages, include_audio)
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/translate/single", methods=["POST"])
def translate_single():
    """Translate text to a single language on-demand with audio"""
    try:
        data = request.get_json() or {}
        text = data.get("text", "")
        language = data.get("language", "hi")
        include_audio = data.get("include_audio", True)
        
        result = translate_text(text, [language], include_audio)
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/languages", methods=["GET"])
def get_languages():
    try:
        from models.translation import get_supported_languages
        languages = get_supported_languages()
        return jsonify({"success": True, "languages": languages})
    except Exception as e:
        print(f"❌ Error getting languages: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/languages/grouped", methods=["GET"])
def get_languages_grouped_endpoint():
    try:
        from models.translation import get_languages_grouped
        result = get_languages_grouped()
        return jsonify({"success": True, **result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/language/<lang_code>", methods=["GET"])
def get_language_info_endpoint(lang_code):
    try:
        from models.translation import get_language_info
        info = get_language_info(lang_code)
        return jsonify({"success": True, "language": info})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/process/similarity", methods=["POST"])
def process_similarity():
    try:
        data = request.get_json() or {}
        original = data.get("original", "")
        simplified = data.get("simplified", "")
        result = compute_similarity(original, simplified)
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/process/bias", methods=["POST"])
def process_bias():
    try:
        data = request.get_json() or {}
        text = data.get("text", "")
        result = detect_bias(text)
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/process/signlanguage", methods=["POST"])
def process_sign_language():
    try:
        data = request.get_json() or {}
        text = data.get("text", "")
        result = generate_gloss(text)
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/process/alttext", methods=["POST", "OPTIONS"])
def process_alt_text():
    if request.method == "OPTIONS":
        return "", 200
    
    try:
        print("🖼️ Alt text endpoint called!")
        print(f"📁 Files in request: {list(request.files.keys())}")
        
        if "image" not in request.files:
            print("❌ No 'image' field in request.files")
            return jsonify({"success": False, "error": "No image provided"}), 400
        
        image_file = request.files["image"]
        print(f"📷 Processing image: {image_file.filename}")
        
        result = generate_alt_text(image_file)
        print(f"✅ Alt text result: {result.get('alt_text', 'N/A')[:100]}...")
        
        return jsonify({"success": True, "result": result})
    except Exception as e:
        print(f"❌ Alt text error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/process/transcript", methods=["POST"])
def process_transcript():
    try:
        if "audio" not in request.files:
            return jsonify({"success": False, "error": "No audio provided"}), 400
        
        audio_file = request.files["audio"]
        language = request.form.get("language", "en") 
        result = transcribe_audio(audio_file, language)
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/process/video", methods=["POST"])
def process_video():
    temp_path = None
    try:
        if "video" not in request.files:
            return jsonify({"success": False, "error": "No video provided"}), 400
        
        video_file = request.files["video"]
        
        if not video_file.filename:
            return jsonify({"success": False, "error": "Empty video file"}), 400
        
        import tempfile
        import time
        temp_path = tempfile.mktemp(suffix=os.path.splitext(video_file.filename)[1])
        video_file.save(temp_path)
        
        print(f"🎬 Processing video: {video_file.filename}")
        
        result = process_video_for_accessibility(temp_path)
        
        time.sleep(0.5)
        
        if temp_path and os.path.exists(temp_path):
            for _ in range(3):
                try:
                    os.remove(temp_path)
                    break
                except PermissionError:
                    time.sleep(0.5)
        
        return jsonify({"success": result.get("success", False), "result": result})
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        if temp_path and os.path.exists(temp_path):
            try:
                import time
                time.sleep(0.5)
                os.remove(temp_path)
            except:
                pass
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/process/video/captions", methods=["POST"])
def get_video_captions():
    try:
        if "video" not in request.files:
            return jsonify({"success": False, "error": "No video provided"}), 400
        
        video_file = request.files["video"]
        
        import tempfile
        temp_path = tempfile.mktemp(suffix=os.path.splitext(video_file.filename)[1])
        video_file.save(temp_path)
        
        result = transcribe_video(temp_path)
        
        if os.path.exists(temp_path):
            os.remove(temp_path)
        
        if result.get("success"):
            return jsonify({
                "success": True,
                "captions": result.get("captions", []),
                "vtt_content": result.get("vtt_content", ""),
                "speaker_segments": result.get("speaker_segments", []),
                "duration": result.get("duration", 0)
            })
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ---------------------------------------------------------------------------
# RAG/CAG library + generation endpoints
# ---------------------------------------------------------------------------


@app.route("/library/index", methods=["POST"])
def library_index():
    """Chunk, embed, and persist the just-finished pipeline output."""
    try:
        user_id, err = _require_user_id()
        if err:
            return err
        data = request.get_json() or {}
        doc_name = (data.get("doc_name") or "Untitled").strip() or "Untitled"
        modality = (data.get("modality") or "text").strip() or "text"
        processing_results = data.get("processing_results") or {}

        document, chunks = chunking.chunk_results(
            user_id=user_id,
            doc_name=doc_name,
            modality=modality,
            processing_results=processing_results,
        )

        if not chunks:
            return jsonify({
                "success": False,
                "error": "No indexable content found in this document.",
            }), 400

        document_store.save_document(document)
        document_store.save_chunks(chunks)

        indexed = 0
        warning = None
        if vector_store.is_available():
            try:
                indexed = vector_store.upsert_chunks(chunks, namespace=user_id)
            except Exception as exc:  # noqa: BLE001 — surface clearly to client
                warning = f"Vector index failed; document saved locally only. {exc}"
        else:
            warning = "PINECONE_API_KEY not set — chunks saved to SQLite, but RAG search will be unavailable."

        return jsonify({
            "success": True,
            "doc_id": document["id"],
            "total_chunks": len(chunks),
            "indexed": indexed,
            "warning": warning,
        })
    except Exception as exc:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/library/documents", methods=["GET"])
def library_documents():
    try:
        user_id, err = _require_user_id()
        if err:
            return err
        docs = document_store.list_documents(user_id)
        return jsonify({"success": True, "documents": docs})
    except Exception as exc:  # noqa: BLE001
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/library/documents/<doc_id>", methods=["DELETE"])
def library_delete_document(doc_id):
    try:
        user_id, err = _require_user_id()
        if err:
            return err
        chunk_ids = document_store.get_chunk_ids_for_doc(doc_id, user_id)
        if vector_store.is_available() and chunk_ids:
            try:
                vector_store.delete_ids(chunk_ids, namespace=user_id)
            except Exception as exc:  # noqa: BLE001
                print(f"[library] Pinecone delete failed (continuing): {exc}")
        removed = document_store.delete_document(doc_id, user_id)
        return jsonify({"success": removed > 0, "deleted": removed})
    except Exception as exc:  # noqa: BLE001
        return jsonify({"success": False, "error": str(exc)}), 500


def _stream_generator(events_iter):
    yield ": ping\n\n"  # keep-alive for proxies
    for event in events_iter:
        yield _sse_event(event["type"], event.get("data", ""))


@app.route("/generate/cag", methods=["POST"])
def generate_cag_route():
    user_id, err = _require_user_id()
    if err:
        return err
    data = request.get_json() or {}
    doc_id = data.get("doc_id") or ""
    query = data.get("query") or ""

    def stream():
        try:
            events = generator.generate_cag(doc_id, user_id, query)
            yield from _stream_generator(events)
        except Exception as exc:  # noqa: BLE001
            yield _sse_event("error", str(exc))

    return Response(stream_with_context(stream()), mimetype="text/event-stream")


@app.route("/generate/rag", methods=["POST"])
def generate_rag_route():
    user_id, err = _require_user_id()
    if err:
        return err
    data = request.get_json() or {}
    query = data.get("query") or ""
    top_k = int(data.get("top_k") or 5)

    def stream():
        try:
            events = generator.generate_rag(user_id, query, top_k=top_k)
            yield from _stream_generator(events)
        except Exception as exc:  # noqa: BLE001
            yield _sse_event("error", str(exc))

    return Response(stream_with_context(stream()), mimetype="text/event-stream")


@app.route("/generate/summary", methods=["POST"])
def generate_summary_route():
    user_id, err = _require_user_id()
    if err:
        return err
    data = request.get_json() or {}
    doc_id = data.get("doc_id") or ""
    length = (data.get("length") or "medium").lower()

    def stream():
        try:
            events = generator.generate_summary(doc_id, user_id, length=length)
            yield from _stream_generator(events)
        except Exception as exc:  # noqa: BLE001
            yield _sse_event("error", str(exc))

    return Response(stream_with_context(stream()), mimetype="text/event-stream")


@app.route("/generate/quiz", methods=["POST"])
def generate_quiz_route():
    try:
        user_id, err = _require_user_id()
        if err:
            return err
        data = request.get_json() or {}
        doc_id = data.get("doc_id") or ""
        n = int(data.get("n_questions") or 5)
        difficulty = (data.get("difficulty") or "medium")
        result = generator.generate_quiz(doc_id, user_id, n_questions=n, difficulty=difficulty)
        return jsonify(result)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/generate/flashcards", methods=["POST"])
def generate_flashcards_route():
    try:
        user_id, err = _require_user_id()
        if err:
            return err
        data = request.get_json() or {}
        doc_id = data.get("doc_id") or ""
        n = int(data.get("n_cards") or 8)
        result = generator.generate_flashcards(doc_id, user_id, n_cards=n)
        return jsonify(result)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/generate/misconception", methods=["POST"])
def generate_misconception_route():
    try:
        data = request.get_json() or {}
        result = generator.generate_misconception(
            question=data.get("question") or "",
            wrong_choice=data.get("wrong_choice") or "",
            correct_choice=data.get("correct_choice") or "",
            doc_context=data.get("doc_context") or "",
        )
        return jsonify(result)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/generate/udl-check", methods=["POST"])
def generate_udl_check():
    """Run the generated answer back through simplify + bias detection."""
    try:
        data = request.get_json() or {}
        answer = (data.get("answer") or "").strip()
        if not answer:
            return jsonify({"success": False, "error": "Empty answer."}), 400

        simplification = simplify_text(answer)
        bias = detect_bias(answer)

        return jsonify({
            "success": True,
            "report": {
                "simplification": simplification,
                "bias": bias,
            },
        })
    except Exception as exc:  # noqa: BLE001
        return jsonify({"success": False, "error": str(exc)}), 500

@app.route("/voice/models", methods=["GET"])
def get_voice_models_route():
    try:
        from models.voice_separation import get_voice_models
        models = get_voice_models()
        return jsonify(models)
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/voice/extract_voice", methods=["POST"])
def extract_voice_route():
    temp_path = None
    try:
        if "mixture_file" not in request.files:
            return jsonify({"success": False, "error": "No mixture_file provided"}), 400

        mixture_file = request.files["mixture_file"]
        if not mixture_file.filename:
            return jsonify({"success": False, "error": "Empty audio file"}), 400

        model_name = request.form.get("model_name", "speechbrain/sepformer-wsj02mix")
        try:
            source_index = int(request.form.get("source_index", "0"))
        except ValueError:
            source_index = 0

        import tempfile
        suffix = os.path.splitext(mixture_file.filename)[1] or ".wav"
        temp_path = tempfile.mktemp(suffix=suffix)
        mixture_file.save(temp_path)

        print(f"🎙️  Voice separation: {mixture_file.filename} ({model_name}, idx={source_index})")

        from models.voice_separation import separate_voice
        result = separate_voice(temp_path, model_name, source_index)

        return jsonify(result)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(exc)}), 500
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass

if __name__ == "__main__":
    print("=" * 60)
    print("Universal UDL Converter - Flask Backend")
    print("=" * 60)
    print("Server running at: http://localhost:8000")
    print("Health check: http://localhost:8000/health")
    print(f"Vector store: {'Pinecone (configured)' if vector_store.is_available() else 'DISABLED — PINECONE_API_KEY missing'}")
    print("=" * 60)
    # Pre-install the speechbrain LazyModule patch BEFORE app.run() starts the
    # werkzeug reloader poll thread. Otherwise the reloader walks sys.modules,
    # touches speechbrain.k2_integration's __file__, triggers a real `import k2`
    # (not installed on Windows), and the reloader thread dies.
    try:
        from models.voice_separation import _patch_speechbrain_lazy_module
        _patch_speechbrain_lazy_module()
    except Exception as _patch_exc:
        print(f"[startup] speechbrain LazyModule patch skipped: {_patch_exc}")
    # Make the debug reloader watch nested module files too — otherwise edits
    # to backend/models/*.py don't trigger a reload and the live server keeps
    # serving stale code (this caused the "bias still shows 100%" bug).
    import glob
    extra_files = glob.glob(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "*.py")
    )
    app.run(host="0.0.0.0", port=8000, debug=True, extra_files=extra_files)
