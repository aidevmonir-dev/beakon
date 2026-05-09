from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class StandardPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    # Workbook-scale lists (CoA = 349 accounts, mappings = 311, validation
    # rules = 311, controlled lists = 206) all need to fit in one page when
    # the frontend asks for the whole set. 1000 is plenty headroom and still
    # caps abuse.
    max_page_size = 1000

    def get_paginated_response(self, data):
        return Response({
            "count": self.page.paginator.count,
            "page": self.page.number,
            "page_size": self.get_page_size(self.request),
            "total_pages": self.page.paginator.num_pages,
            "next": self.get_next_link(),
            "previous": self.get_previous_link(),
            "results": data,
        })
