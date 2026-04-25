# Beakon backend — production container.
#
# Base: slim Python to keep the image small; WeasyPrint adds ~90MB of system
# libs (Cairo/Pango), unavoidable if PDF rendering is exercised.
#
# Runtime: gunicorn on PORT (Fly.io injects it), WhiteNoise serves static
# assets directly — no separate nginx.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System dependencies:
#   libpq5 — psycopg2 runtime
#   cairo/pango/gdk-pixbuf — WeasyPrint PDF rendering
#   libffi — cffi (used by weasyprint, cryptography)
#   curl — diagnostic, not required at runtime but tiny
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        libcairo2 \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libpangocairo-1.0-0 \
        libgdk-pixbuf-2.0-0 \
        libffi8 \
        shared-mime-info \
        fonts-liberation \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Build stage deps for wheels that need compilation (psycopg2 if binary fails).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libpq-dev \
    && pip install --upgrade pip

WORKDIR /app

COPY requirements.txt /app/
RUN pip install -r requirements.txt

# Drop build tools after install to shrink the image.
RUN apt-get purge -y build-essential libpq-dev \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY . /app/

# collectstatic runs at build time so the image ships ready to serve.
# SECRET_KEY is required by settings import; a dummy is fine here —
# runtime uses the real secret from Fly env vars.
RUN SECRET_KEY=build-only DEBUG=False \
    DB_NAME=x DB_USER=x DB_PASSWORD=x DB_HOST=localhost \
    python manage.py collectstatic --noinput

EXPOSE 8000

# Fly sets PORT; default to 8000 for local image testing.
CMD ["sh", "-c", "gunicorn digits_clone.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 2 --timeout 120 --access-logfile -"]
