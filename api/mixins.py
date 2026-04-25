class OrganizationFilterMixin:
    """Automatically filter querysets by the current organization."""

    def get_queryset(self):
        qs = super().get_queryset()
        organization = getattr(self.request, "organization", None)
        if organization:
            qs = qs.filter(organization=organization)
        return qs
