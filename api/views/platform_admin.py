"""Platform-admin views — Thomas's owner cockpit.

These endpoints expose data across ALL tenants (not scoped to the caller's
organization). Gated by ``IsAdminUser`` (``is_staff``) so only Beakon
staff see them. Used by the ``/dashboard/admin/customers`` UI.
"""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, Max
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import LoginSession
from audit.models import AuditEvent
from organizations.models import Organization, OrganizationMember
from beakon_core.models.billing import OrganizationSubscription


User = get_user_model()


def _serialize_org(org: Organization, sub: OrganizationSubscription | None,
                   member_count: int, last_seen) -> dict:
    plan = sub.plan if sub else None
    return {
        "id": org.id,
        "slug": org.slug,
        "name": org.name,
        "legal_name": org.legal_name,
        "country": org.country,
        "currency": org.currency,
        "is_active": org.is_active,
        "created_at": org.created_at.isoformat() if org.created_at else None,
        "selected_activities": list(org.selected_activities or []),
        "activity_count": len(org.selected_activities or []),
        "member_count": member_count,
        "last_member_login": last_seen.isoformat() if last_seen else None,
        "plan": {
            "slug": plan.slug,
            "name": plan.name,
            "price": str(plan.price) if plan and plan.price is not None else None,
            "currency": plan.currency,
            "billing_cadence": plan.billing_cadence,
        } if plan else None,
        "subscription": {
            "status": sub.status,
            "status_label": sub.get_status_display(),
            "started_at":   sub.started_at.isoformat()   if sub.started_at   else None,
            "trial_ends_at": sub.trial_ends_at.isoformat() if sub.trial_ends_at else None,
            "activated_at": sub.activated_at.isoformat() if sub.activated_at else None,
            "cancelled_at": sub.cancelled_at.isoformat() if sub.cancelled_at else None,
            "days_left": sub.days_left(),
        } if sub else None,
    }


class CustomerListView(APIView):
    """GET /beakon/admin/customers/ — one row per Organization.

    Includes plan, subscription status, member count, activity count.
    Sorted by most recent sign-up first. No pagination — Beakon has at
    most a few dozen client orgs in v1; revisit when that changes.
    """

    permission_classes = [IsAdminUser]

    def get(self, request):
        # Prefetch the one-to-one subscription + its plan to avoid the
        # N+1 (one org × one subscription × one plan).
        orgs = (
            Organization.objects
            .select_related("subscription__plan")
            .annotate(
                _member_count=Count("members", distinct=True),
                _last_seen=Max("members__user__last_login"),
            )
            .order_by("-created_at")
        )

        rows = []
        for org in orgs:
            sub = getattr(org, "subscription", None)
            rows.append(_serialize_org(
                org=org,
                sub=sub,
                member_count=org._member_count,
                last_seen=org._last_seen,
            ))

        # Headline stats roll up across all orgs so the page shows the
        # 4 KPI cards at the top without a second round-trip.
        totals = {
            "total":     len(rows),
            "active":    sum(1 for r in rows if r["subscription"] and r["subscription"]["status"] == "active"),
            "trial":     sum(1 for r in rows if r["subscription"] and r["subscription"]["status"] == "trial"),
            "cancelled": sum(1 for r in rows if r["subscription"] and r["subscription"]["status"] == "cancelled"),
            "expired":   sum(1 for r in rows if r["subscription"] and r["subscription"]["status"] == "expired"),
            "no_plan":   sum(1 for r in rows if not r["subscription"]),
        }
        return Response({"customers": rows, "totals": totals})


class CustomerDetailView(APIView):
    """GET /beakon/admin/customers/<slug>/ — single org deep view.

    Includes member list + subscription history snippet. Kept compact
    for v1; the page mostly displays the same fields as the list row
    plus a member table.
    """

    permission_classes = [IsAdminUser]

    def get(self, request, slug: str):
        org = (
            Organization.objects
            .select_related("subscription__plan")
            .filter(slug=slug)
            .first()
        )
        if not org:
            return Response({"detail": "Not found"}, status=404)

        members = (
            OrganizationMember.objects
            .filter(organization=org)
            .select_related("user", "role")
            .order_by("-accepted_at", "-id")
        )
        member_rows = [
            {
                "id": m.id,
                "user_email": m.user.email if m.user_id else None,
                "user_name": (
                    f"{m.user.first_name} {m.user.last_name}".strip()
                    if m.user_id else ""
                ),
                "role": m.role.name if m.role_id else None,
                "is_active": m.is_active,
                "accepted_at": m.accepted_at.isoformat() if m.accepted_at else None,
                "last_login": (
                    m.user.last_login.isoformat()
                    if m.user_id and m.user.last_login else None
                ),
            }
            for m in members
        ]
        sub = getattr(org, "subscription", None)
        base = _serialize_org(
            org=org,
            sub=sub,
            member_count=len(member_rows),
            last_seen=max(
                (m.user.last_login for m in members if m.user_id and m.user.last_login),
                default=None,
            ),
        )
        base["members"] = member_rows
        return Response(base)


class TrafficView(APIView):
    """GET /beakon/admin/traffic/ — platform-wide traffic snapshot.

    KPIs (login + audit-event counts), 14-day daily series, per-org
    engagement in the last 7 days, and currently active sessions.
    Single endpoint so the admin dashboard makes one fetch.
    """

    permission_classes = [IsAdminUser]
    WINDOW_DAYS = 14
    ENGAGEMENT_DAYS = 7

    def get(self, request):
        now = timezone.now()
        d1  = now - timedelta(hours=24)
        d7  = now - timedelta(days=7)
        d30 = now - timedelta(days=30)

        kpis = {
            "logins_today": LoginSession.objects.filter(logged_in_at__gte=d1).count(),
            "logins_7d":    LoginSession.objects.filter(logged_in_at__gte=d7).count(),
            "logins_30d":   LoginSession.objects.filter(logged_in_at__gte=d30).count(),
            # Distinct user counts — DAU/WAU/MAU are the SaaS standard.
            "dau": LoginSession.objects.filter(logged_in_at__gte=d1).values("user").distinct().count(),
            "wau": LoginSession.objects.filter(logged_in_at__gte=d7).values("user").distinct().count(),
            "mau": LoginSession.objects.filter(logged_in_at__gte=d30).values("user").distinct().count(),
            # Active organisations = distinct orgs with at least one member
            # login in the last 7 days. Uses the membership join because
            # LoginSession itself is user-scoped, not org-scoped.
            "active_orgs_7d": (
                OrganizationMember.objects
                .filter(user__login_sessions__logged_in_at__gte=d7)
                .values("organization").distinct().count()
            ),
            "total_users":   User.objects.count(),
            "total_sessions": LoginSession.objects.count(),
            "active_sessions_now": LoginSession.objects.filter(
                is_active=True, logged_out_at__isnull=True,
            ).count(),
        }

        # ── 14-day daily series — logins and audit events ──────────────
        window_start = (now - timedelta(days=self.WINDOW_DAYS - 1)).replace(
            hour=0, minute=0, second=0, microsecond=0,
        )
        logins_grouped = (
            LoginSession.objects
            .filter(logged_in_at__gte=window_start)
            .annotate(day=TruncDate("logged_in_at"))
            .values("day").annotate(c=Count("id"))
        )
        actions_grouped = (
            AuditEvent.objects
            .filter(created_at__gte=window_start)
            .annotate(day=TruncDate("created_at"))
            .values("day").annotate(c=Count("id"))
        )
        login_map  = {row["day"]: row["c"] for row in logins_grouped}
        action_map = {row["day"]: row["c"] for row in actions_grouped}

        logins_by_day = []
        actions_by_day = []
        for i in range(self.WINDOW_DAYS):
            day = (window_start + timedelta(days=i)).date()
            logins_by_day.append({"date": day.isoformat(), "count": login_map.get(day, 0)})
            actions_by_day.append({"date": day.isoformat(), "count": action_map.get(day, 0)})

        # ── Per-org engagement (last 7 days) ──────────────────────────
        org_login_counts = (
            OrganizationMember.objects
            .filter(user__login_sessions__logged_in_at__gte=d7)
            .values("organization_id", "organization__slug", "organization__name")
            .annotate(
                logins=Count("user__login_sessions"),
                active_users=Count("user", distinct=True),
            )
            .order_by("-logins")
        )
        org_action_counts = (
            AuditEvent.objects
            .filter(created_at__gte=d7)
            .values("organization_id")
            .annotate(actions=Count("id"))
        )
        action_by_org = {row["organization_id"]: row["actions"] for row in org_action_counts}

        by_org_7d = [
            {
                "org_id":     row["organization_id"],
                "org_slug":   row["organization__slug"],
                "org_name":   row["organization__name"],
                "logins":     row["logins"],
                "active_users": row["active_users"],
                "actions":    action_by_org.get(row["organization_id"], 0),
            }
            for row in org_login_counts
        ]

        # ── Currently active sessions (live now) ──────────────────────
        active_sessions = list(
            LoginSession.objects
            .filter(is_active=True, logged_out_at__isnull=True)
            .select_related("user")
            .order_by("-logged_in_at")[:10]
            .values(
                "id", "logged_in_at", "ip_address",
                "user__email", "user__first_name", "user__last_name",
            )
        )
        active_session_rows = [
            {
                "id":            s["id"],
                "user_email":    s["user__email"],
                "user_name":     f"{s['user__first_name']} {s['user__last_name']}".strip(),
                "ip":            s["ip_address"],
                "logged_in_at":  s["logged_in_at"].isoformat() if s["logged_in_at"] else None,
            }
            for s in active_sessions
        ]

        return Response({
            "kpis":           kpis,
            "logins_by_day":  logins_by_day,
            "actions_by_day": actions_by_day,
            "by_org_7d":      by_org_7d,
            "active_sessions": active_session_rows,
            "window_days":    self.WINDOW_DAYS,
        })
