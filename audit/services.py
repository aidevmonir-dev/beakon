import threading

from .models import AuditEvent

_local = threading.local()


def get_current_request():
    return getattr(_local, "request", None)


def set_current_request(request):
    _local.request = request


def log_event(
    organization,
    action,
    object_type,
    object_id,
    object_repr="",
    changes=None,
    actor=None,
    actor_type="user",
    metadata=None,
):
    """Create an audit log entry."""
    request = get_current_request()
    ip_address = None
    user_agent = ""

    if request:
        ip_address = _get_client_ip(request)
        user_agent = request.META.get("HTTP_USER_AGENT", "")
        if actor is None and hasattr(request, "user") and request.user.is_authenticated:
            actor = request.user

    return AuditEvent.objects.create(
        organization=organization,
        actor=actor,
        actor_type=actor_type,
        action=action,
        object_type=object_type,
        object_id=object_id,
        object_repr=str(object_repr),
        changes=changes or {},
        metadata=metadata or {},
        ip_address=ip_address,
        user_agent=user_agent,
    )


def _get_client_ip(request):
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")
