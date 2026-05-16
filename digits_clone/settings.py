import os
from datetime import timedelta
from pathlib import Path

from corsheaders.defaults import default_headers
from decouple import Csv, config

# dj_database_url is only needed when DATABASE_URL is set (cloud deploy).
# Missing locally — fall back to the DB_* env vars below without exploding.
try:
    import dj_database_url
except ImportError:
    dj_database_url = None

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config("SECRET_KEY", default="django-insecure-change-me")
DEBUG = config("DEBUG", default=False, cast=bool)
ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="localhost,127.0.0.1", cast=Csv())

# Trust the Fly / Vercel / Cloudflare proxy chain so request.is_secure() and
# request.build_absolute_uri() return HTTPS URLs. Only honored when not DEBUG.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 3600          # start small; bump to 31536000 when confident
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"

# ---------------------------------------------------------------------------
# Application definition
# ---------------------------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "corsheaders",
    # Foundation — stays
    "accounts",           # User + auth
    "organizations",      # Tenant (org → members → roles)
    "audit",              # AuditMiddleware + AuditEvent
    "api",                # URL shell
    # Beakon kernel (blueprint 2026-04-17, Objectives 1 + 2)
    "beakon_core",
    # Beakon banking feeder (Objective 3)
    "beakon_banking",
    # Travel & Expense (UI philosophy doc, Phase 1 module)
    "beakon_travel",
    # Employment master (UI philosophy doc, Phase 1 module)
    "beakon_employment",
    # Documents store (UI philosophy doc, Phase 1 module)
    "beakon_documents",
    # NOTE: legacy apps (ledger, banking, reconciliation, vendors, customers,
    # documents, reports, dashboards, notifications, ap, ar, ai, tasks) were
    # unregistered on 2026-04-18 per the founder working paper. Their code
    # + DB tables remain on disk for reference but are not loaded. Decommission
    # fully once Thomas signs off on the replacement stack.
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "audit.middleware.AuditMiddleware",
]

ROOT_URLCONF = "digits_clone.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "digits_clone.wsgi.application"
APPEND_SLASH = False

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
# Cloud: set DATABASE_URL ("postgres://user:pass@host:5432/db") — parsed by
# dj_database_url. Local dev falls back to the DB_* env vars below.
_database_url = config("DATABASE_URL", default="")
if _database_url and dj_database_url is not None:
    DATABASES = {
        "default": dj_database_url.parse(_database_url, conn_max_age=600, ssl_require=not DEBUG),
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": config("DB_NAME", default="digits_clone"),
            "USER": config("DB_USER", default="postgres"),
            "PASSWORD": config("DB_PASSWORD", default="postgres"),
            "HOST": config("DB_HOST", default="localhost"),
            "PORT": config("DB_PORT", default="5432"),
        }
    }

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---------------------------------------------------------------------------
# Internationalization
# ---------------------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------------------
# Static files
# ---------------------------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------------------
# Ollama (local LLM for OCR / draft journal entries)
# Privacy-by-default: bills never leave the machine. To use a remote LLM
# instead, point OLLAMA_BASE_URL at the remote.
# ---------------------------------------------------------------------------
from decouple import config as _cfg  # noqa: E402

OLLAMA_BASE_URL = _cfg("OLLAMA_BASE_URL", default="http://localhost:11434")
# Two text models split by job: extraction is JSON-strict and benefits from a
# small fast model; chat needs a bigger model that reasons over a multi-section
# snapshot without inventing numbers.
OLLAMA_TEXT_MODEL = _cfg("OLLAMA_TEXT_MODEL", default="qwen2.5:1.5b")        # OCR
OLLAMA_CHAT_MODEL = _cfg("OLLAMA_CHAT_MODEL", default=OLLAMA_TEXT_MODEL)     # Ask Beakon
OLLAMA_VISION_MODEL = _cfg("OLLAMA_VISION_MODEL", default="llama3.2-vision:11b")
OLLAMA_TIMEOUT_SECONDS = int(_cfg("OLLAMA_TIMEOUT_SECONDS", default="180"))
OLLAMA_CHAT_TIMEOUT_SECONDS = int(_cfg("OLLAMA_CHAT_TIMEOUT_SECONDS", default="300"))

# ---------------------------------------------------------------------------
# OCR backend selector
#   "ollama"  → local Ollama (default, privacy-first, see block above)
#   "claude"  → Anthropic Claude API (higher accuracy, native PDF + scanned PDF
#               support, requires ANTHROPIC_API_KEY; bills leave the machine).
# ---------------------------------------------------------------------------
OCR_BACKEND = _cfg("OCR_BACKEND", default="ollama").lower()
ANTHROPIC_API_KEY = _cfg("ANTHROPIC_API_KEY", default="")
# Skill default is Opus 4.7. Family-office bill volumes are low and accuracy
# matters more than per-bill cost; override to claude-sonnet-4-6 for cheaper
# extraction at slightly lower quality.
CLAUDE_OCR_MODEL = _cfg("CLAUDE_OCR_MODEL", default="claude-opus-4-7")

# ---------------------------------------------------------------------------
# Ask Beakon backend
#   "ollama" → local Ollama (default, privacy-first)
#   "claude" → Anthropic API (faster, smarter answers; chat leaves the machine)
# Defaults to OCR_BACKEND so a single env-var flip enables Claude everywhere.
# ---------------------------------------------------------------------------
ASK_BACKEND = _cfg("ASK_BACKEND", default=OCR_BACKEND).lower()
CLAUDE_ASK_MODEL = _cfg("CLAUDE_ASK_MODEL", default="claude-haiku-4-5")

# ---------------------------------------------------------------------------
# Avaloq SFTP bank-feed receiver
#   AVALOQ_INCOMING_DIR is where the production SFTP daemon lands the
#   custodian's daily zip. Defaults to <project>/incoming/avaloq/ for
#   local dev. In production this points at the chrooted SFTP user's
#   home directory.
# ---------------------------------------------------------------------------
AVALOQ_INCOMING_DIR = Path(_cfg(
    "AVALOQ_INCOMING_DIR",
    default=str(BASE_DIR / "incoming" / "avaloq"),
))
# After successful ingest a zip is moved into AVALOQ_ARCHIVE_DIR/<business_date>/.
# On parse failure it goes to AVALOQ_QUARANTINE_DIR. Operators inspect quarantine
# manually; archived zips are the audit trail (retain ≥ 30 days per the spec).
AVALOQ_ARCHIVE_DIR = Path(_cfg(
    "AVALOQ_ARCHIVE_DIR",
    default=str(BASE_DIR / "incoming" / "avaloq_archive"),
))
AVALOQ_QUARANTINE_DIR = Path(_cfg(
    "AVALOQ_QUARANTINE_DIR",
    default=str(BASE_DIR / "incoming" / "avaloq_quarantine"),
))

# ---------------------------------------------------------------------------
# Django REST Framework
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "api.pagination.StandardPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_RENDERER_CLASSES": (
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ),
}

# ---------------------------------------------------------------------------
# Simple JWT
# ---------------------------------------------------------------------------
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=1),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# ---------------------------------------------------------------------------
# Celery
# ---------------------------------------------------------------------------
CELERY_BROKER_URL = config("CELERY_BROKER_URL", default="redis://localhost:6379/0")
CELERY_RESULT_BACKEND = config("REDIS_URL", default="redis://localhost:6379/0")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = "UTC"

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = config(
    "CORS_ALLOWED_ORIGINS",
    default="http://localhost:3000,http://127.0.0.1:3000",
    cast=Csv(),
)
# Allow any Vercel preview URL so PR previews work without whitelisting
# each one. Production should still use the pinned CORS_ALLOWED_ORIGINS.
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^https://.*\.vercel\.app$",
]
# Set CORS_ALLOW_ALL_ORIGINS=True in .env when exposing via Cloudflare Tunnel
# / ngrok — random hostnames are impractical to whitelist.
CORS_ALLOW_ALL_ORIGINS = config("CORS_ALLOW_ALL_ORIGINS", default=False, cast=bool)
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = (*default_headers, "x-organization-id")

# ---------------------------------------------------------------------------
# AI / External Services
# ---------------------------------------------------------------------------
ANTHROPIC_API_KEY = config("ANTHROPIC_API_KEY", default="")
# Fast + cheap for per-transaction categorization; smarter for Ask Finance.
AI_MODEL_CATEGORIZE = config("AI_MODEL_CATEGORIZE", default="claude-haiku-4-5")
AI_MODEL_ASK = config("AI_MODEL_ASK", default="claude-sonnet-4-6")

# ---------------------------------------------------------------------------
# Email (console backend for dev, switch to SMTP for production)
# ---------------------------------------------------------------------------
EMAIL_BACKEND = config(
    "EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend"
)
EMAIL_HOST = config("EMAIL_HOST", default="localhost")
EMAIL_PORT = config("EMAIL_PORT", default=587, cast=int)
EMAIL_USE_TLS = config("EMAIL_USE_TLS", default=True, cast=bool)
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")
DEFAULT_FROM_EMAIL = config("DEFAULT_FROM_EMAIL", default="noreply@beakon.local")

FRONTEND_URL = config("FRONTEND_URL", default="http://localhost:3000")
