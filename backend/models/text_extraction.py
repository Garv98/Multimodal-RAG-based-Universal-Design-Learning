import os
import tempfile


def extract_text_from_pdf(pdf_file):
    try:
        import pdfplumber
        
        temp_path = None
        if hasattr(pdf_file, 'save'):
            temp_path = tempfile.mktemp(suffix='.pdf')
            pdf_file.save(temp_path)
            pdf_file.seek(0)
        else:
            temp_path = pdf_file
        
        extracted_text = []
        with pdfplumber.open(temp_path) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                text = page.extract_text()
                if text:
                    extracted_text.append(f"--- Page {page_num} ---\n{text}")
        
        if temp_path and os.path.exists(temp_path) and hasattr(pdf_file, 'save'):
            os.remove(temp_path)
        
        full_text = "\n\n".join(extracted_text)
        
        return {
            "success": True,
            "text": full_text,
            "page_count": len(extracted_text),
            "method": "pdfplumber"
        }
        
    except ImportError:
        return _extract_with_pypdf2(pdf_file)
    except Exception as e:
        return {
            "success": False,
            "text": "",
            "error": str(e),
            "method": "pdfplumber"
        }


def _extract_with_pypdf2(pdf_file):
    """fallback PDF extraction using PyPDF2"""
    try:
        from PyPDF2 import PdfReader
        
        reader = PdfReader(pdf_file)
        extracted_text = []
        
        for page_num, page in enumerate(reader.pages, 1):
            text = page.extract_text()
            if text:
                extracted_text.append(f"--- Page {page_num} ---\n{text}")
        
        return {
            "success": True,
            "text": "\n\n".join(extracted_text),
            "page_count": len(extracted_text),
            "method": "PyPDF2"
        }
    except Exception as e:
        return {
            "success": False,
            "text": "",
            "error": str(e),
            "method": "PyPDF2"
        }


def extract_text_from_image(image_file):
    try:
        from PIL import Image
        import tempfile
        
        temp_path = tempfile.mktemp(suffix='.png')
        if hasattr(image_file, 'save'):
            image_file.save(temp_path)
            image_file.seek(0)
        else:
            temp_path = image_file
        
        image = Image.open(temp_path)
        
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        extracted_text = _extract_with_trocr(image)

        from .image_captioning import generate_alt_text
        caption_result = generate_alt_text(temp_path)

        if os.path.exists(temp_path) and hasattr(image_file, 'save'):
            os.remove(temp_path)

        # Pick the most informative caption available for downstream steps.
        # Priority: enhanced (Groq) → detailed (Florence) → short alt-text.
        rich_description = (
            caption_result.get("enhanced_description")
            or caption_result.get("detailed_caption")
            or caption_result.get("alt_text")
            or ""
        ).strip()

        ocr_text = (extracted_text or "").strip()

        # Decide what becomes the "primary text" for the document.
        #
        # Old logic used OCR whenever len > 5 chars — so a diagram producing
        # a single fragment like "AMOUNT" became the entire document, and
        # downstream simplification/translation/bias all ran on six garbage
        # characters. The new heuristic only trusts OCR when it actually
        # looks like prose: enough words, real sentence boundaries.
        if _ocr_looks_like_prose(ocr_text):
            # Textbook scan / screenshot of an article: keep TrOCR text.
            main_text = ocr_text
            method = "trocr_transformers"
            note = None
        elif rich_description:
            # Diagram / photo / chart: use the AI description as primary
            # content so simplification etc. operate on meaningful text.
            main_text = rich_description
            method = "florence_caption"
            if ocr_text:
                note = (
                    "Image OCR returned only short fragments — using the AI "
                    f"description as primary content. OCR fragments: \"{ocr_text[:200]}\""
                )
            else:
                note = "No readable text in image. Using AI description as primary content."
        else:
            # Both OCR and caption failed — give up gracefully.
            main_text = ocr_text or "Image"
            method = "fallback"
            note = "Could not generate an image description."

        result = {
            "success": True,
            "text": main_text,
            "method": method,
            "source": "image_ocr",
        }

        if note:
            result["note"] = note
        
        if caption_result.get("success"):
            result.update({
                "alt_text": caption_result.get("alt_text"),
                "raw_caption": caption_result.get("raw_caption"),
                "brief_caption": caption_result.get("raw_caption"),
                "detailed_caption": caption_result.get("detailed_caption"),
                "enhanced_description": caption_result.get("enhanced_description"),
                "ocr_text": caption_result.get("ocr_text"),
                "all_captions": caption_result.get("all_captions"),
                "image_info": caption_result.get("image_info"),
                "model": caption_result.get("model"),
                "confidence": caption_result.get("confidence", 0.95)
            })
        
        return result
        
    except ImportError as e:
        return {
            "success": False,
            "text": "",
            "error": f"Missing dependency: {str(e)}. Install with: pip install transformers torch pillow",
            "method": "trocr_transformers"
        }
    except Exception as e:
        return {
            "success": False,
            "text": "",
            "error": str(e),
            "method": "trocr_transformers"
        }


def _ocr_looks_like_prose(text: str) -> bool:
    """Heuristic: does this OCR output look like real readable prose, or
    just scattered label fragments from a diagram?

    We accept it as prose when:
      - At least 80 characters
      - At least 15 words
      - At least 1 sentence boundary (. / ! / ?)
      - Average word length looks human (2.5 - 12 chars)

    Tuned to reject typical diagram label fragments like "AMOUNT", "Input",
    "Data Source Layer" while keeping textbook / article scans.
    """
    if not text:
        return False
    cleaned = text.strip()
    if len(cleaned) < 80:
        return False
    words = cleaned.split()
    if len(words) < 15:
        return False
    sentence_markers = sum(cleaned.count(p) for p in (". ", "! ", "? "))
    if sentence_markers < 1:
        return False
    avg_len = sum(len(w) for w in words) / len(words)
    if avg_len < 2.5 or avg_len > 12:
        return False
    return True


def _extract_with_trocr(image):
    try:
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel
        
        model_name = "microsoft/trocr-base-printed"
        
        print(f"Loading TrOCR model: {model_name}...")
        processor = TrOCRProcessor.from_pretrained(model_name)
        model = VisionEncoderDecoderModel.from_pretrained(model_name)
        
        pixel_values = processor(image, return_tensors="pt").pixel_values
        generated_ids = model.generate(pixel_values)
        generated_text = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
        
        return generated_text
        
    except Exception as e:
        print(f"TrOCR extraction failed: {e}")
        return ""

