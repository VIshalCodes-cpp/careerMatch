# CareerMatch NLP service

This is the Python 3.11 service used for PDF/DOCX text extraction, rule-based resume fields, spaCy NER when `en_core_web_sm` is installed, and Sentence-Transformers embeddings. The default embedding model is `sentence-transformers/all-MiniLM-L6-v2`.

## Run locally

```bash
cd ml-service
python3.11 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m spacy download en_core_web_sm
uvicorn app.main:app --reload --port 8000
```

The first run downloads the open-source SBERT model; this does not require a paid model API key. `GET /health` reports whether it loaded and whether spaCy NER is available. For a remotely reachable service, set a strong `ML_SERVICE_API_KEY` on both the Python service and the TypeScript API. The service is intended to run separately from serverless deployments because the transformer model is a Python runtime dependency.

`POST /parse` accepts a multipart `file` field with a PDF or DOCX. It checks the MIME type, extension, and file signature, extracts text, returns parsed fields and a normalized embedding, and explicitly does not perform OCR. `POST /embeddings` calculates and returns real normalized Sentence-Transformer vectors. `POST /match` returns cosine similarities from the same model.

Install the service as a private internal endpoint or configure a strong shared API key. Do not make resume files public.
