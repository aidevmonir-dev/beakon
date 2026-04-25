from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path


def healthz(_request):
    """Liveness probe for Fly / Vercel / any load balancer. No DB dependency
    so a dead Postgres still flags as ALB-reachable but returns 5xx from the
    real endpoints — cleaner signal for ops."""
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", healthz),
    path("api/v1/", include("api.urls")),
    path("api/v1/beakon/", include("api.beakon_urls")),
]
