FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/opt/huggingface

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

# Download the named SBERT model at build time so cold starts do not depend on model downloads.
RUN python -c "from sentence_transformers import SentenceTransformer; import os; SentenceTransformer(os.getenv('SENTENCE_TRANSFORMER_MODEL', 'sentence-transformers/all-MiniLM-L6-v2'))"

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
