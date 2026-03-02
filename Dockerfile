FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN adduser --disabled-password --gecos "" --uid 1000 appuser

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY . .

RUN mkdir -p /app/frontend/generated-app \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 7860

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
