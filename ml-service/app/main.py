from __future__ import annotations

import os
import re
import zipfile
from functools import lru_cache
from io import BytesIO
from typing import Any

import fitz
import spacy
from docx import Document
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

app = FastAPI(title="CareerMatch NLP service", version="1.0.0")
MODEL_NAME = os.getenv("SENTENCE_TRANSFORMER_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
MAX_FILE_BYTES = 5 * 1024 * 1024

# Lightweight normalized skill vocabulary; extend it with a licensed taxonomy as one is selected.
SKILLS = {
    "python", "java", "javascript", "typescript", "react", "node.js", "express", "fastify", "django",
    "flask", "fastapi", "sql", "postgresql", "mysql", "mongodb", "redis", "docker", "kubernetes",
    "aws", "azure", "gcp", "git", "linux", "html", "css", "tailwind css", "machine learning",
    "deep learning", "natural language processing", "nlp", "statistics", "scikit-learn", "tensorflow",
    "pytorch", "sentence transformers", "data analysis", "power bi", "tableau", "airflow", "spark",
    "api design", "system design", "testing", "communication", "project management", "c++", "c#", ".net",
    "spring boot", "graphql", "rest api", "terraform", "mlops", "model deployment", "data visualization",
}
SKILL_ALIASES = {"ml": "machine learning", "natural language processing (nlp)": "natural language processing", "postgres": "postgresql", "js": "javascript", "ts": "typescript", "scikit learn": "scikit-learn"}


@lru_cache(maxsize=1)
def embedding_model() -> SentenceTransformer:
    return SentenceTransformer(MODEL_NAME)


@lru_cache(maxsize=1)
def nlp_model():
    try:
        return spacy.load(os.getenv("SPACY_MODEL", "en_core_web_sm"))
    except OSError:
        # No NER model is bundled implicitly; rule-based parsing still runs and health reports this.
        return spacy.blank("en")


def authorize(authorization: str | None = Header(default=None)):
    expected = os.getenv("ML_SERVICE_API_KEY")
    if expected and authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Invalid service credentials")


class MatchRequest(BaseModel):
    candidate_text: str = Field(min_length=1, max_length=30000)
    job_texts: list[str] = Field(min_length=1, max_length=200)


class EmbeddingRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=250)


@app.get("/health")
def health(_: Any = Depends(authorize)):
    model_ready = True
    model_error = None
    try:
        embedding_model()
    except Exception as error:  # report a missing/download failure explicitly
        model_ready = False
        model_error = str(error)
    return {"status": "ok" if model_ready else "degraded", "embeddingModel": MODEL_NAME, "embeddingReady": model_ready, "spacyNerReady": nlp_model().has_pipe("ner"), "modelError": model_error}


def extract_text(data: bytes, content_type: str, filename: str) -> str:
    lower_name = filename.lower()
    if content_type == "application/pdf" and lower_name.endswith(".pdf") and data.startswith(b"%PDF-"):
        try:
            with fitz.open(stream=data, filetype="pdf") as document:
                if document.page_count > 200:
                    raise HTTPException(status_code=413, detail="PDF has too many pages")
                return "\n".join(page.get_text("text") for page in document)
        except Exception as error:
            raise HTTPException(status_code=422, detail="The PDF could not be read") from error
    if content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" and lower_name.endswith(".docx") and data.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(BytesIO(data)) as archive:
                entries = archive.infolist()
                if len(entries) > 2000 or sum(entry.file_size for entry in entries) > 50 * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="DOCX expands beyond the processing limit")
                if any(".." in entry.filename.split("/") for entry in entries) or "word/document.xml" not in archive.namelist():
                    raise HTTPException(status_code=422, detail="The DOCX package is invalid")
            document = Document(BytesIO(data))
            paragraphs = [paragraph.text for paragraph in document.paragraphs]
            tables = [cell.text for table in document.tables for row in table.rows for cell in row.cells]
            return "\n".join(paragraphs + tables)
        except Exception as error:
            raise HTTPException(status_code=422, detail="The DOCX could not be read") from error
    raise HTTPException(status_code=415, detail="Upload a valid PDF or DOCX file")


def parse_resume(text: str) -> dict[str, Any]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    doc = nlp_model()(text[:100000])
    email_match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, flags=re.I)
    phone_match = re.search(r"(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)", text)
    first_line = lines[0][:160] if lines else ""
    person_name = next((entity.text for entity in doc.ents if entity.label_ == "PERSON"), None)
    if not person_name and first_line and len(first_line.split()) <= 5 and not re.search(r"@|resume|curriculum|https?://|\d{3}", first_line, re.I):
        person_name = first_line

    normalized_hits: set[str] = set()
    lowered = text.lower()
    for term in SKILLS:
        if re.search(rf"(?<![\w+#.]){re.escape(term)}(?![\w+#.])", lowered):
            normalized_hits.add(SKILL_ALIASES.get(term, term))
    for alias, canonical in SKILL_ALIASES.items():
        if re.search(rf"(?<!\w){re.escape(alias)}(?!\w)", lowered):
            normalized_hits.add(canonical)

    education_lines = [line for line in lines if re.search(r"\b(bachelor|master|b\.? ?tech|b\.? ?e\.?|m\.? ?tech|ph\.? ?d|diploma|university|college)\b", line, re.I)]
    title_lines = [line for line in lines if re.search(r"\b(engineer|developer|analyst|manager|designer|intern|consultant|scientist|administrator)\b", line, re.I)]
    certification_lines = [line for line in lines if re.search(r"\b(certified|certification|certificate|aws certified|cka|pmp)\b", line, re.I)]
    project_start = next((index for index, line in enumerate(lines) if re.search(r"^projects?\b", line, re.I)), None)
    projects = lines[project_start + 1: project_start + 7] if project_start is not None else []
    years = [int(value) for value in re.findall(r"\b(\d{1,2})\s*\+?\s+years?\b", lowered)]
    return {
        "name": person_name,
        "email": email_match.group(0) if email_match else None,
        "phone": phone_match.group(0).strip() if phone_match else None,
        "skills": sorted(normalized_hits),
        "education": education_lines[:12],
        "jobTitles": title_lines[:12],
        "certifications": certification_lines[:12],
        "projects": projects,
        "experienceYears": max(years) if years else None,
        "parser": "spaCy NER when available plus explicit resume rules and normalized skill vocabulary",
        "nerAvailable": nlp_model().has_pipe("ner"),
        "ocr": False,
    }


@app.post("/parse")
async def parse_endpoint(file: UploadFile = File(...), _: Any = Depends(authorize)):
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Resume exceeds the 5 MB limit")
    content_type = file.content_type or ""
    text = extract_text(data, content_type, file.filename or "")
    if len(text.strip()) < 30:
        raise HTTPException(status_code=422, detail="No readable text found; scanned image-only PDFs are not supported")
    parsed = parse_resume(text)
    vector = []
    embedding_error = None
    try:
        vector = embedding_model().encode([text[:30000]], normalize_embeddings=True)[0].tolist()
    except Exception as error:
        embedding_error = str(error)
    return {"text": text[:100000], "parsed": parsed, "embedding": vector, "embeddingError": embedding_error}


@app.post("/match")
def match_endpoint(request: MatchRequest, _: Any = Depends(authorize)):
    try:
        model = embedding_model()
        vectors = model.encode([request.candidate_text[:30000], *[job[:30000] for job in request.job_texts]], normalize_embeddings=True)
        scores = cosine_similarity(vectors[:1], vectors[1:])[0]
    except Exception as error:
        raise HTTPException(status_code=503, detail="Sentence-Transformer model is unavailable") from error
    return {"model": MODEL_NAME, "similarities": [float(max(0.0, min(1.0, score))) for score in scores]}


@app.post("/embeddings")
def embeddings_endpoint(request: EmbeddingRequest, _: Any = Depends(authorize)):
    try:
        vectors = embedding_model().encode([text[:30000] for text in request.texts], normalize_embeddings=True)
    except Exception as error:
        raise HTTPException(status_code=503, detail="Sentence-Transformer model is unavailable") from error
    return {"model": MODEL_NAME, "embeddings": vectors.tolist()}
