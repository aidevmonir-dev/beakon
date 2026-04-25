from .services import set_current_request


class AuditMiddleware:
    """Stores the current request in thread-local so audit services can access it."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        set_current_request(request)
        response = self.get_response(request)
        set_current_request(None)
        return response
