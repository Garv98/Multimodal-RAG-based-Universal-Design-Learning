import os
import re
from transformers import pipeline

# Optional spaCy
try:
    import spacy
    from spacy.matcher import DependencyMatcher
    SPACY_AVAILABLE = True
except ImportError:
    SPACY_AVAILABLE = False
    print("⚠️ spaCy not available - using transformer models only")

_bias_model = None
_toxicity_model = None
_sentiment_model = None
_nlp = None

# How many sentences to feed to ML pipelines (caps cost on huge docs).
_ML_SENTENCE_CAP = 200
# Confidence assigned to deterministic rule-based matches.
_RULE_CONFIDENCE = 0.95
# Toxic-BERT emits multiple labels. We treat any of these as a hit.
_TOXIC_LABELS = {"toxic", "severe_toxic", "obscene", "threat", "insult", "identity_hate"}
# CardiffNLP hate model returns NOT-HATE / HATE; toxicity labels are above.
_HATE_LABELS = {"hate"}
# CardiffNLP sentiment returns negative / neutral / positive (lowercase strings).
_NEGATIVE_SENTIMENT_LABELS = {"negative"}
# Bias category labels we recognise (used for category sorting in the report).
_HIGH_SEVERITY_TYPES = {"disability", "racial", "sexual_orientation", "religion", "age", "stereotype_general", "academic_bias"}

BIAS_PATTERNS = {
    "gender": {
        "patterns": [
            r'\b(mankind|manmade|chairman|fireman|policeman|stewardess|waitress|salesman|mailman)\b',
            r'\b(he|him|his)\s+(is|was|should be)\s+(a\s+)?(leader|engineer|scientist|boss|doctor|pilot)\b',
            r'\b(she|her)\s+(is|was)\s+(a\s+)?(nurse|assistant|secretary|teacher|housewife)\b',
            r'\b(men|women)\s+are\s+(better|worse)\s+at\s+\w+',
        ],
        "suggestions": {
            "mankind": "humankind",
            "manmade": "artificial",
            "chairman": "chairperson",
            "fireman": "firefighter",
            "policeman": "police officer",
            "stewardess": "flight attendant",
            "waitress": "server",
            "salesman": "salesperson",
            "mailman": "mail carrier",
        }
    },
    "age": {
        "patterns": [
            r'\b(old people|elderly|senior citizens?|boomers|past generations?)\b.*\b(slow|confused|forgetful|outdated|tech-illiterate|resistant to change)\b',
            r'\b(young people|young professionals|millennials?|gen z|gen y|zoomers|current generation|today\'s youth|today\'s workers)\b.*\b(lazy|naive|entitled|snowflakes|addicted to phones|spoiled|overly focused on|instant rewards|minimal sacrifice|reject proven|no commitment|demand constant|flexible hours|rapid success)\b',
            r'\b(unlike past generations?)\b.*\b(respected hard work|committed to lifelong|valued discipline)\b',
            r'\b(return to traditional|stop indulging|crumble standards)\b.*\b(entitled attitudes|every demand)\b',
            r'\b(too old|too young)\s+(for|to)\s+\w+',
        ],
        "suggestions": {
            "old people": "older adults",
            "elderly": "older adults",
            "senior citizen": "older adult",
            "boomers": "older generations",
            "past generations": "previous generations",
            "young people": "younger individuals",
            "young professionals": "early-career professionals",
            "millennial": "young adult",
            "gen z": "young adult",
            "zoomers": "younger generations",
            "current generation": "contemporary professionals",
            "today's youth": "younger generations",
            "entitled": "high expectations",
            "instant rewards": "quick feedback",
            "minimal sacrifice": "balanced effort",
            "reject proven practices": "innovate on established methods",
            "flexible hours": "work-life balance",
            "constant praise": "regular recognition",
            "entitled attitudes": "aspirational mindsets",
        }
    },
    "disability": {
        "patterns": [
            r'\b(crippled|handicapped|retarded|insane|crazy|psycho|lame|dumb|blind to|deaf to)\b',
            r'\b(suffers from|victim of|afflicted with)\b.*\b(disability|condition|illness)\b',
            r'\b(wheelchair-bound|confined to a wheelchair)\b',
            r'\b(people with|person with|individuals with|those with)\s+(cognitive|mental|physical|intellectual|developmental)?\s*(disabilities|disability|challenges|impairments?)\b.*\b(cannot|can\'t|unable to|incapable of|not able to|should not|shouldn\'t|better off|kept out|excluded from)\b',
            r'\b(disabled people|disabled individuals|the disabled)\b.*\b(cannot|can\'t|unable to|less capable|not suitable|inappropriate for|burden|liability)\b',
            r'\b(for the sake of efficiency|for productivity|to maintain standards)\b.*\b(disability|disabled|cognitive|mental|physical)\b',
        ],
        "suggestions": {
            "handicapped": "person with a disability",
            "crippled": "person with a disability",
            "retarded": "person with intellectual disability",
            "insane": "person with mental health challenges",
            "crazy": "person with mental health challenges",
            "psycho": "person with mental health challenges",
            "suffers from": "lives with",
            "victim of": "has",
            "wheelchair-bound": "wheelchair user",
            "cannot contribute": "can contribute with appropriate support",
            "kept out": "supported to participate",
            "better off being": "deserves opportunity",
        }
    },
    "racial": {
        "patterns": [
            r'\b(illegal alien|illegals|wetback|thug|gangster|criminal)\b',
            r'\b(black|white|asian|hispanic|native)\s+(neighborhood|community|area)\b.*\b(dangerous|ghetto|poor|rich)\b',
            r'\b(all \w+ people are)\b.*\b(lazy|smart|criminal|terrorists)\b',
        ],
        "suggestions": {
            "illegal alien": "undocumented immigrant",
            "illegals": "undocumented people",
            "thug": "person",
            "gangster": "individual",
        }
    },
    "cultural": {
        "patterns": [
            r'\b(tradition(al)? values|respect for authority|stable communities|abandoning traditions|primitive cultures)\b',
            r'\b(progress should never come at the cost of cultural identity)\b',
            r'\b(our way of life|superior culture|inferior culture|backward society)\b',
            r'\b(assimilate or leave|go back to your country)\b',
        ],
        "suggestions": {
            "respect for authority": "respect for diverse perspectives",
            "abandoning traditions": "adapting traditions",
            "superior culture": "unique culture",
            "inferior culture": "different culture",
            "primitive cultures": "diverse cultures",
            "backward society": "evolving society",
        }
    },
    "socioeconomic": {
        "patterns": [
            r'\b(poor people|the poor|low-income families|welfare queens)\b.*\b(lazy|unmotivated|criminal|drain on society)\b',
            r'\b(rich people|the rich|wealthy|one percent)\b.*\b(greedy|selfish|out of touch|elitist)\b',
            r'\b(pull yourself up by your bootstraps)\b',
        ],
        "suggestions": {
            "poor people": "people experiencing poverty",
            "the poor": "people experiencing poverty",
            "low-income families": "families with limited financial resources",
            "welfare queens": "people receiving assistance",
            "rich people": "people with financial means",
            "the rich": "people with financial means",
            "one percent": "high-income individuals",
        }
    },
    "political": {
        "patterns": [
            r'\b(left-wing|right-wing|liberal|conservative|democrat|republican)\b.*\b(radical|extremist|irrational|traitors|sheeple)\b',
            r'\b(politicians|government)\b.*\b(always lie|never care|corrupt|deep state)\b',
            r'\b(fake news|mainstream media)\b.*\b(lies|propaganda)\b',
        ],
        "suggestions": {
            "left-wing": "progressive",
            "right-wing": "traditionalist",
            "liberal": "progressive",
            "conservative": "traditionalist",
            "fake news": "misinformation",
        }
    },
    "sexual_orientation": {
        "patterns": [
            r'\b(gay|lesbian|queer|homo|dyke|fag)\b.*\b(agenda|lifestyle|choice|perverted|sinful)\b',
            r'\b(straight people are normal)\b',
            r'\b(that\'s so gay)\b',
        ],
        "suggestions": {
            "homo": "gay person",
            "dyke": "lesbian person",
            "fag": "gay person",
            "agenda": "rights",
            "lifestyle": "orientation",
            "choice": "identity",
        }
    },
    "religion": {
        "patterns": [
            r'\b(muslim|christian|jewish|hindu|atheist)\b.*\b(terrorists|fanatics|superstitious|greedy|godless)\b',
            r'\b(all religions are)\b.*\b(evil|the same|oppressive)\b',
            r'\b(war on christmas|sharia law)\b',
        ],
        "suggestions": {
            "terrorists": "extremists",
            "fanatics": "extremists",
            "superstitious": "devout",
            "godless": "non-religious",
        }
    },
    "body_image": {
        "patterns": [
            r'\b(fat|skinny|obese|anorexic)\b.*\b(lazy|ugly|unhealthy|disgusting)\b',
            r'\b(real women have curves|men should be muscular)\b',
            r'\b(body positivity is promoting obesity)\b',
        ],
        "suggestions": {
            "fat": "person with larger body",
            "skinny": "person with smaller body",
            "obese": "person with obesity",
            "anorexic": "person with eating disorder",
        }
    },
    "environmental": {
        "patterns": [
            r'\b(climate change is a hoax|environmentalists are extremists)\b',
            r'\b(green energy is a scam|tree huggers)\b',
        ],
        "suggestions": {
            "hoax": "debated issue",
            "extremists": "advocates",
            "scam": "initiative",
            "tree huggers": "environmentalists",
        }
    },
    # ----------------------------------------------------------------------
    # Academic / intellectual elitism — devaluing fields of study,
    # comparative-intelligence claims, "X subjects are mostly hobbies", etc.
    # ----------------------------------------------------------------------
    "academic_bias": {
        "patterns": [
            # Comparative intelligence / capability claims ("more intelligent than")
            r'\b(more|less|much\s+more|far\s+more)\s+(intelligent|capable|gifted|talented|skilled|deserving|worthy|qualified|competent)\s+than\b',
            # "<noun group> who <verb> X are <comparative/judgmental>"
            r'\b(students|people|kids|children|individuals|workers)\s+who\s+(excel|study|prefer|choose|focus|pursue|do|work)\s+(in|on|at|with)?\s*\w+(\s+\w+){0,3}\s+(are|tend\s+to\s+be|seem|will\s+be)\s+(naturally\s+)?(more|less|smarter|dumber|better|worse|inferior|superior|gifted|talented)\b',
            # Devaluation of creative / arts / humanities fields
            r'\b(arts?|music|dance|sports?|creative\s+(subjects?|fields?|work|pursuits?)|humanities|liberal\s+arts|english|literature|history|philosophy|sociology|theater|theatre)\s+(are|is)\s+(mostly|just|merely|only|nothing\s+but|primarily|essentially)\s+(hobbies|pastimes|distractions|fluff|useless|trivial|secondary|unimportant|a\s+waste)\b',
            # "<field> do not contribute / matter / help"
            r'\b(arts?|creative\s+\w+|humanities|sports?|music|hobbies|dance|theater|theatre|literature|liberal\s+arts)\s+(do\s+not|don\'?t|doesn\'?t|does\s+not)\s+(contribute|matter|help|count|add\s+(value|much)|provide\s+value)\b',
            # "X subjects are more valuable than Y" (field hierarchy)
            r'\b(science|math|mathematics|engineering|stem|tech|technology|business|coding|programming)\s+(subjects?|fields?|degrees?|careers?|courses?)?\s*(are|is)\s+(more|much\s+more|far\s+more)\s+(valuable|important|useful|essential|critical|practical|respectable|legitimate)\b',
            # "schools should focus more on STEM"
            r'\b(schools?|education|curriculum|universities|colleges?)\s+should\s+(focus|prioritize|emphasize|invest)\s+(more|primarily|mostly|mainly|heavily)\s+on\s+(science|math|mathematics|stem|engineering|coding)\b',
            # "X is/are real <field>; Y is not"
            r'\b(real|legitimate|serious)\s+(science|math|engineering|academics?|scholars?|professionals?)\b.*\b(arts?|creative|humanities|liberal\s+arts)\b',
        ],
        "suggestions": {
            "more intelligent than": "have different strengths than",
            "less intelligent than": "have different strengths than",
            "are mostly hobbies": "have value as both vocations and avocations",
            "do not contribute": "contribute in different ways",
            "more valuable": "valuable in different ways",
            "mostly hobbies": "important pursuits with cultural and economic value",
            "are just hobbies": "have value beyond recreation",
            "naturally more": "demonstrate different strengths than",
        }
    },
    # ----------------------------------------------------------------------
    # Generic stereotype scaffolds — these are broad on purpose to catch
    # paraphrased bias that the more specific category patterns above miss.
    # ----------------------------------------------------------------------
    "stereotype_general": {
        "patterns": [
            # "All / Most / Every X are Y" — sweeping generalisations
            r'\b(all|most|every|each|the)\s+(men|women|boys|girls|kids|children|americans|asians|africans|europeans|indians|chinese|japanese|christians|muslims|jews|hindus|sikhs|buddhists|whites|blacks|latinos|hispanics|gays|lesbians|immigrants|refugees|atheists|elderly|old|teens|teenagers|millennials|boomers|seniors|liberals|conservatives|democrats|republicans|poor|rich|disabled|autistic|gifted|young)\s+(are|is|act|behave|look|sound|think|feel|believe|tend|always|never)\b',
            # "X always / never <verb>"
            r'\b(men|women|boys|girls|americans|asians|africans|indians|chinese|christians|muslims|jews|hindus|whites|blacks|latinos|hispanics|gays|lesbians|immigrants|refugees|elderly|teens|millennials|boomers|disabled)\s+(always|never|constantly|usually|typically)\s+\w+',
            # "X can't / cannot / shouldn't / don't <verb>"
            r'\b(women|men|girls|boys|elderly|old\s+people|young\s+people|disabled\s+(people|individuals|persons)?|blacks|asians|whites|hispanics|gays|muslims|jews|christians|hindus|atheists|immigrants|refugees)\s+(can\'t|cannot|shouldn\'t|should\s+not|don\'t|do\s+not|are\s+unable\s+to|are\s+incapable\s+of|aren\'t\s+able\s+to)\b',
            # Capability framed as innate: "X are (naturally|inherently|biologically) <comparative> at"
            r'\b(women|men|girls|boys|asians|blacks|whites|hispanics|jews|muslims|christians|americans|indians)\s+are\s+(naturally|inherently|biologically|genetically|innately)\s+(smarter|dumber|better|worse|stronger|weaker|more|less)\b',
            # "<adjective> people are/tend"
            r'\b(fat|skinny|obese|ugly|stupid|lazy|dumb|smart|poor|rich|gay|straight)\s+people\s+(are|tend\s+to\s+be|always|never|usually)\b',
            # "X people are <judgmental adjective>"
            r'\b(asian|black|white|hispanic|latino|jewish|muslim|christian|hindu|gay|lesbian|trans|disabled|poor|rich|old|young)\s+people\s+are\s+(lazy|smart|stupid|dumb|criminal|violent|cheap|greedy|aggressive|emotional|cold|backward|primitive|exotic|inferior|superior)\b',
            # "Real <gender> <claim>"
            r'\breal\s+(men|women|boys|girls)\s+(don\'t|do\s+not|always|never|should|must)\b',
        ],
        "suggestions": {
            "all men": "many men",
            "all women": "many women",
            "every": "many",
            "most": "some",
            "always": "often",
            "never": "rarely",
            "cannot": "may find it difficult to",
            "can't": "may find it difficult to",
            "naturally": "sometimes",
            "inherently": "sometimes",
            "biologically": "sometimes",
        }
    },
}


def detect_gender_role_bias(doc):
    """Detect gender role stereotyping using dependency parsing (requires spaCy)"""
    if not SPACY_AVAILABLE:
        return []
    
    matcher = DependencyMatcher(doc.vocab)

    pattern = [
        {
            "RIGHT_ID": "subject",
            "RIGHT_ATTRS": {"LOWER": {"IN": ["women", "woman", "men", "man", "females", "males"]}}
        },
        {
            "RIGHT_ID": "better",
            "LEFT_ID": "subject",
            "REL_OP": ">",
            "RIGHT_ATTRS": {"LOWER": {"IN": ["better", "suited", "more", "naturally", "tend"]}}
        },
        {
            "RIGHT_ID": "role",
            "LEFT_ID": "better",
            "REL_OP": ">",
            "RIGHT_ATTRS": {"LOWER": {"IN": ["roles", "positions", "jobs", "suited"]}}
        }
    ]

    matcher.add("GENDER_ROLE_BIAS", [pattern])

    matches = matcher(doc)
    flags = []

    for match_id, token_ids in matches:
        span_tokens = [doc[i] for i in token_ids]
        span_text = " ".join(t.text for t in span_tokens)
        flags.append({
            "type": "gender_role_stereotype",
            "severity": "high",
            "matched_text": span_text,
            "confidence": 0.92,
            "explanation": "Gender stereotyped role assignment detected"
        })

    if re.search(r'(emotional|feelings|hormonal).*(interfere|affect|weaken|lower).*(decision|strategic|logical|rational)', doc.text.lower()):
        flags.append({
            "type": "gender_emotion_stereotype",
            "severity": "high",
            "matched_text": "emotional ... interfere ... strategic",
            "confidence": 0.88,
            "explanation": "Emotional vs logical gender stereotype detected"
        })

    return flags


def load_bias_model():
    """Load hate speech detection model"""
    global _bias_model
    if _bias_model is None:
        print("Loading bias detection model...")
        _bias_model = pipeline(
            "text-classification",
            model="cardiffnlp/twitter-roberta-base-hate-latest",
            top_k=None
        )
        print("Bias detection model loaded successfully!")
    return _bias_model


def load_toxicity_model():
    """Load additional toxicity/bias model for enhanced detection"""
    global _toxicity_model
    if _toxicity_model is None:
        print("Loading toxicity detection model...")
        _toxicity_model = pipeline(
            "text-classification",
            model="unitary/toxic-bert",
            top_k=None
        )
        print("Toxicity detection model loaded successfully!")
    return _toxicity_model


def load_sentiment_model():
    """Load sentiment analysis model"""
    global _sentiment_model
    if _sentiment_model is None:
        print("Loading sentiment analysis model...")
        _sentiment_model = pipeline(
            "sentiment-analysis",
            model="cardiffnlp/twitter-roberta-base-sentiment-latest"
        )
        print("Sentiment analysis model loaded successfully!")
    return _sentiment_model


def load_nlp():
    """Load spaCy NLP model (optional - for enhanced detection)"""
    global _nlp
    if not SPACY_AVAILABLE:
        return None
    if _nlp is None:
        try:
            print("Loading spaCy NLP model...")
            _nlp = spacy.load("en_core_web_sm")
            print("spaCy NLP model loaded successfully!")
        except Exception as e:
            print(f"⚠️ Could not load spaCy model: {e}")
            print("Continuing with transformer models only...")
            return None
    return _nlp


def detect_bias(text):
    """Run rule-based + ML + contextual bias detection on `text`.

    Returns a dict the frontend can render directly:
        success, overall_bias_detected, bias_score (0-100, higher = less bias),
        categories (sorted by impact), flags, suggestions, detailed_report.
    """
    if not text or not text.strip():
        return {"success": False, "error": "No text provided"}

    rb = _rule_based_bias_detection(text)
    ml = _ml_bias_detection(text)
    ctx = _contextual_bias_detection(text)

    merged_flags = _merge_and_dedupe_flags(rb["flags"] + ml["flags"] + ctx["flags"])
    suggestions = _dedupe_suggestions(rb["suggestions"] + ctx["suggestions"])

    # Categories: keep the most informative type per category bucket, then
    # sort by descending count for the report.
    category_counts: dict[str, int] = {}
    for flag in merged_flags:
        cat = _category_for_type(flag["type"])
        category_counts[cat] = category_counts.get(cat, 0) + 1
    categories = sorted(category_counts.keys(), key=lambda c: -category_counts[c])

    sentence_count = max(1, len(_split_sentences(text)))
    bias_score = _calculate_bias_score(merged_flags, sentence_count)

    if os.getenv("GROQ_BIAS_EXPLAIN", "").lower() in ("1", "true", "yes"):
        _augment_flags_with_groq(merged_flags, text)

    results = {
        "success": True,
        "overall_bias_detected": bool(merged_flags),
        "bias_score": bias_score,
        "categories": categories,
        "flags": merged_flags,
        "suggestions": suggestions,
    }
    results["detailed_report"] = _generate_bias_report(results, category_counts)
    return results


# ---------------------------------------------------------------------------
# ML detection
# ---------------------------------------------------------------------------


def _ml_bias_detection(text: str) -> dict:
    sentences = [s for s in _split_sentences(text) if len(s.split()) >= 3]
    if not sentences:
        return {"flags": []}

    if len(sentences) > _ML_SENTENCE_CAP:
        sentences = sentences[:_ML_SENTENCE_CAP]

    hate_model = load_bias_model()
    toxicity_model = load_toxicity_model()

    try:
        hate_preds = hate_model(sentences, truncation=True, max_length=512)
        toxicity_preds = toxicity_model(sentences, truncation=True, max_length=512)
    except Exception as exc:  # noqa: BLE001 — graceful degrade if a model crashes
        print(f"⚠️ ML bias pipeline failed: {exc}")
        return {"flags": []}

    flags: list[dict] = []
    # Lowered thresholds — the previous 0.5 cutoff missed a lot of subtle
    # bias the user reported. Rule-based catches the obvious; ML now also
    # catches medium-confidence signals.
    HATE_MIN, HATE_HIGH = 0.35, 0.7
    TOX_MIN, TOX_HIGH = 0.35, 0.7
    for sent, hate_pred, tox_pred in zip(sentences, hate_preds, toxicity_preds):
        for p in hate_pred:
            label = (p.get("label") or "").lower()
            score = float(p.get("score") or 0.0)
            if label in _HATE_LABELS and score > HATE_MIN:
                flags.append({
                    "type": "ml_hate",
                    "matched_text": sent,
                    "severity": "high" if score > HATE_HIGH else "medium",
                    "confidence": round(score, 3),
                })

        for p in tox_pred:
            label = (p.get("label") or "").lower()
            score = float(p.get("score") or 0.0)
            if label in _TOXIC_LABELS and score > TOX_MIN:
                flags.append({
                    "type": f"ml_{label}",
                    "matched_text": sent,
                    "severity": "high" if score > TOX_HIGH else "medium",
                    "confidence": round(score, 3),
                })

    return {"flags": flags}


# ---------------------------------------------------------------------------
# spaCy contextual detection (sentiment + NER + dependency parsing)
# ---------------------------------------------------------------------------


_AGE_CONTEXT_PATTERNS = [
    re.compile(r"\b(young|millennial|gen ?z|gen ?y|zoomer|boomer|current|today's)\b", re.IGNORECASE),
    re.compile(r"\b(past|previous|older)\s+generation", re.IGNORECASE),
]

_ENTITY_BIAS_KEYWORDS = {
    "PERSON": {"stereotype", "bias"},
    "NORP": {"nationality", "religion", "politics", "generation"},
    "GPE": {"country", "location"},
    "DATE": {"young", "old", "generation", "past", "today"},
}


def _contextual_bias_detection(text: str) -> dict:
    nlp = load_nlp()
    if nlp is None:
        return {"flags": [], "suggestions": []}

    doc = nlp(text)
    sentiment_model = load_sentiment_model()

    flags: list[dict] = []
    for sent in doc.sents:
        sent_text = sent.text.strip()
        if not sent_text or len(sent_text.split()) < 3:
            continue

        entities = [(e.text, e.label_) for e in sent.ents
                    if e.label_ in {"PERSON", "NORP", "ORG", "GPE", "DATE"}]
        has_age_context = any(p.search(sent_text) for p in _AGE_CONTEXT_PATTERNS)
        if not entities and not has_age_context:
            continue

        try:
            sentiment = sentiment_model(sent_text, truncation=True, max_length=512)[0]
        except Exception:  # noqa: BLE001
            continue

        label = (sentiment.get("label") or "").lower()
        score = float(sentiment.get("score") or 0.0)
        # Lowered from 0.6 so medium-confidence negative sentiment around
        # demographic entities also gets surfaced.
        if label not in _NEGATIVE_SENTIMENT_LABELS or score <= 0.45:
            continue

        sent_lower = sent_text.lower()
        has_bias_keyword = has_age_context or any(
            kw in sent_lower for _, lbl in entities for kw in _ENTITY_BIAS_KEYWORDS.get(lbl, ())
        )
        if not has_bias_keyword:
            continue

        flags.append({
            "type": "contextual_age" if has_age_context else "contextual_bias",
            "matched_text": sent_text,
            "severity": "high" if score > 0.8 else "medium",
            "entities": [t for t, _ in entities] + (["age_context"] if has_age_context else []),
            "confidence": round(score, 3),
        })

    flags.extend(detect_gender_role_bias(doc))
    return {"flags": flags, "suggestions": []}


# ---------------------------------------------------------------------------
# Merging + scoring
# ---------------------------------------------------------------------------


def _merge_and_dedupe_flags(flags: list[dict]) -> list[dict]:
    """Keep one flag per (type, span). On collision, keep highest severity."""
    severity_rank = {"high": 3, "medium": 2, "low": 1}
    seen: dict[tuple[str, str], dict] = {}
    for flag in flags:
        span = (flag.get("matched_text") or "").strip().lower()[:200]
        key = (flag.get("type", ""), span)
        existing = seen.get(key)
        if existing is None or severity_rank.get(flag.get("severity", ""), 0) > severity_rank.get(existing.get("severity", ""), 0):
            seen[key] = flag
    # Sort: high severity first, then by confidence desc
    return sorted(
        seen.values(),
        key=lambda f: (-severity_rank.get(f.get("severity", ""), 0), -float(f.get("confidence", 0))),
    )


def _dedupe_suggestions(suggestions: list[dict]) -> list[dict]:
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for s in suggestions:
        key = (s.get("original", "").lower(), s.get("type", ""))
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def _calculate_bias_score(flags: list[dict], sentence_count: int) -> float:
    """Length-normalized score in [0, 100] where 100 = no bias.

    Each flag contributes weight by severity * confidence. We then divide by
    sentence count so a 5-sentence rant and a 500-sentence inclusive essay are
    compared on equal footing.
    """
    if not flags:
        return 100.0

    # Slightly more aggressive weights — a single high flag should push the
    # score below the "Significant" threshold (60) for a short biased
    # sentence, not just to "Moderate".
    severity_weight = {"high": 22.0, "medium": 11.0, "low": 5.0}
    total_penalty = 0.0
    for flag in flags:
        weight = severity_weight.get(flag.get("severity", "medium"), 9.0)
        conf = float(flag.get("confidence", 0.7) or 0.7)
        # Confidence in [0, 1]; floor at 0.5 so even unconfident hits matter a bit.
        total_penalty += weight * max(0.5, min(1.0, conf))

    # Length normalization: 1 sentence = full impact; 10 sentences halve it, etc.
    normalizer = 1.0 + 0.05 * max(0, sentence_count - 1)
    score = 100.0 - (total_penalty / normalizer)
    return round(max(0.0, min(100.0, score)), 1)


def _category_for_type(type_name: str) -> str:
    """Group a flag type into a higher-level category for the report."""
    if type_name.startswith("ml_"):
        return type_name[3:]  # ml_toxic -> toxic
    if "_" in type_name:
        head = type_name.split("_", 1)[0]
        return head
    return type_name


def _split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


# ---------------------------------------------------------------------------
# Optional Groq enrichment (off by default — set GROQ_BIAS_EXPLAIN=1 to enable)
# ---------------------------------------------------------------------------


def _augment_flags_with_groq(flags: list[dict], full_text: str) -> None:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return
    targets = [f for f in flags if f.get("type", "").startswith(("ml_", "contextual"))][:6]
    if not targets:
        return
    try:
        from groq import Groq
    except ImportError:
        return

    client = Groq(api_key=api_key)
    model = os.getenv("GROQ_GENERATION_MODEL", "llama-3.3-70b-versatile")
    for flag in targets:
        span = flag.get("matched_text", "")
        if not span:
            continue
        try:
            completion = client.chat.completions.create(
                model=model,
                temperature=0.1,
                max_tokens=180,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are an accessibility editor. Given a sentence flagged as "
                            "potentially biased, reply with exactly two lines:\n"
                            "WHY: <one sentence explaining the bias signal>\n"
                            "REWRITE: <a more inclusive version of the sentence, "
                            "preserving meaning>"
                        ),
                    },
                    {"role": "user", "content": span},
                ],
            )
            content = (completion.choices[0].message.content or "").strip()
            why = rewrite = ""
            for line in content.splitlines():
                if line.upper().startswith("WHY:"):
                    why = line.split(":", 1)[1].strip()
                elif line.upper().startswith("REWRITE:"):
                    rewrite = line.split(":", 1)[1].strip()
            if why:
                flag["explanation"] = why
            if rewrite:
                flag["suggested_rewrite"] = rewrite
        except Exception:  # noqa: BLE001
            continue


def _rule_based_bias_detection(text):
    """Pattern-match against the curated BIAS_PATTERNS dictionary.

    Adds a fixed high confidence (these are deterministic curated rules) and
    standardizes the flag schema. Suggestions are derived from the per-pattern
    `suggestions` dict in BIAS_PATTERNS.
    """
    flags: list[dict] = []
    suggestions: list[dict] = []
    text_lower = text.lower()

    for bias_type, config in BIAS_PATTERNS.items():
        for pattern in config["patterns"]:
            for match in re.finditer(pattern, text_lower):
                matched = match.group(0).strip()
                if not matched:
                    continue
                flag_type = (
                    f"{bias_type}_generational"
                    if bias_type == "age" and "generation" in matched
                    else bias_type
                )
                severity = "high" if bias_type in _HIGH_SEVERITY_TYPES else "medium"
                flags.append({
                    "type": flag_type,
                    "matched_text": matched,
                    "severity": severity,
                    "confidence": _RULE_CONFIDENCE,
                })

                # Build rewrite suggestions from the curated term map. Match the
                # first applicable term; subsequent terms in the same span are
                # captured in their own iterations of the outer pattern loop.
                for term, replacement in config.get("suggestions", {}).items():
                    if re.search(re.escape(term), matched, re.IGNORECASE):
                        suggested = re.sub(
                            re.escape(term), replacement, matched, flags=re.IGNORECASE
                        )
                        suggestions.append({
                            "original": matched,
                            "suggested": suggested,
                            "type": bias_type,
                        })
                        break

    return {"flags": flags, "suggestions": suggestions}


_CATEGORY_GUIDANCE = {
    "age": [
        "Avoid sweeping generalizations about age groups.",
        "Frame differences as varied experience, not deficit.",
        "Focus on individual contribution rather than generational shorthand.",
    ],
    "gender": [
        "Use gender-neutral nouns and pronouns where possible.",
        "Avoid pairing professions with one gender by default.",
        "Treat traits like 'logical' or 'emotional' as universal, not gendered.",
    ],
    "disability": [
        "Use person-first language (\"person with a disability\", not \"the disabled\").",
        "Avoid framing disability as suffering or limitation.",
        "Describe accommodations as enabling, not as exceptions.",
    ],
    "racial": [
        "Avoid coded language tying ethnicity to behaviour.",
        "Name groups precisely; avoid catch-all labels.",
    ],
    "religion": [
        "Avoid linking faith communities to violence or extremism.",
        "Describe practices factually rather than judgmentally.",
    ],
    "sexual_orientation": [
        "Treat sexuality as identity, not lifestyle or choice.",
        "Avoid normalizing one orientation over another.",
    ],
}


def _generate_bias_report(results: dict, category_counts: dict[str, int]) -> str:
    """Markdown-friendly bias report (renders cleanly inside <pre>)."""
    if not results["overall_bias_detected"]:
        return "✓ No significant bias detected. Content appears inclusive and balanced."

    score = results["bias_score"]
    if score >= 85:
        status = "MINOR — light-touch revisions recommended"
    elif score >= 60:
        status = "MODERATE — several issues to address"
    else:
        status = "SIGNIFICANT — substantial revisions recommended"

    lines: list[str] = []
    lines.append("BIAS ANALYSIS REPORT")
    lines.append("=" * 60)
    lines.append(f"Bias-free score : {score:.1f} / 100")
    lines.append(f"Status          : {status}")
    lines.append(f"Total flags     : {len(results['flags'])}")
    lines.append(f"Categories      : {', '.join(results['categories']) or 'None'}")
    lines.append("")

    # Category breakdown -----------------------------------------------------
    lines.append("Breakdown by category")
    lines.append("-" * 60)
    for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
        lines.append(f"  • {_human_label(cat)}: {count}")
    lines.append("")

    # Priority issues --------------------------------------------------------
    severity_rank = {"high": 3, "medium": 2, "low": 1}
    top = sorted(
        results["flags"],
        key=lambda f: (
            -severity_rank.get(f.get("severity", ""), 0),
            -float(f.get("confidence", 0) or 0),
        ),
    )[:10]
    lines.append("Top issues")
    lines.append("-" * 60)
    for i, flag in enumerate(top, 1):
        sev = (flag.get("severity") or "medium").upper()
        conf = flag.get("confidence")
        conf_str = f", conf {conf:.2f}" if isinstance(conf, (int, float)) else ""
        lines.append(f"{i}. [{sev}{conf_str}] {_human_label(flag.get('type', '?'))}")
        text = flag.get("matched_text") or flag.get("text") or ""
        if text:
            lines.append(f"   “{_truncate(text, 200)}”")
        if flag.get("explanation"):
            lines.append(f"   why: {flag['explanation']}")
        if flag.get("suggested_rewrite"):
            lines.append(f"   try: {flag['suggested_rewrite']}")
        lines.append("")

    # Rewrites ---------------------------------------------------------------
    if results.get("suggestions"):
        lines.append("Recommended rewrites")
        lines.append("-" * 60)
        for i, sug in enumerate(results["suggestions"][:10], 1):
            lines.append(f"{i}. Replace: \"{_truncate(sug['original'], 120)}\"")
            lines.append(f"   With:    \"{_truncate(sug['suggested'], 160)}\"")
            lines.append(f"   Type:    {_human_label(sug['type'])}")
            lines.append("")

    # Guidance ---------------------------------------------------------------
    relevant_guidance: list[tuple[str, list[str]]] = []
    for cat in results["categories"]:
        head = cat.split("_", 1)[0]
        if head in _CATEGORY_GUIDANCE:
            relevant_guidance.append((head, _CATEGORY_GUIDANCE[head]))
    if relevant_guidance:
        lines.append("Guidance")
        lines.append("-" * 60)
        seen: set[str] = set()
        for head, tips in relevant_guidance:
            if head in seen:
                continue
            seen.add(head)
            lines.append(f"{_human_label(head)}:")
            for tip in tips:
                lines.append(f"  • {tip}")
            lines.append("")

    return "\n".join(lines).rstrip()


def _human_label(token: str) -> str:
    return token.replace("_", " ").title()


def _truncate(text: str, n: int) -> str:
    text = text.strip()
    return text if len(text) <= n else text[: n - 1] + "…"
