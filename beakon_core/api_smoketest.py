"""End-to-end API smoke test for the Beakon kernel endpoints.

Exercises the real HTTP surface via Django's test client — JWT auth,
x-organization-id header, all critical endpoints. Rolls back at the end.

Flow:
  1. POST /auth/login/                            → JWT tokens
  2. POST /beakon/entities/                       → HoldCo (USD)
  3. POST /beakon/accounts/                       → 4 accounts
  4. POST /beakon/periods/                        → April 2026
  5. POST /beakon/journal-entries/                → draft JE w/ 2 lines
  6. POST .../submit-for-approval/                → pending_approval
  7. POST .../approve/ (different user)           → approved
  8. POST .../post/                               → posted
  9. GET /beakon/reports/trial-balance/?as_of=... → balanced
 10. GET /beakon/reports/entry-detail/?entry_id=… → full drill-down

Run from project root:
  venv\\Scripts\\python.exe beakon_core\\api_smoketest.py
"""
import json
import os
import sys
from datetime import date
from decimal import Decimal

import django

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "digits_clone.settings")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.db import transaction  # noqa: E402
from django.test import Client  # noqa: E402

from organizations.models import Organization, OrganizationMember, Role  # noqa: E402
from beakon_core.models import Currency, FXRate  # noqa: E402


User = get_user_model()


def _json_call(client, method, path, data=None, headers=None):
    """Do a JSON request and return (status, body)."""
    kwargs = {"content_type": "application/json", "HTTP_HOST": "localhost"}
    if data is not None:
        kwargs["data"] = json.dumps(data, default=str)
    kwargs.update(headers or {})
    resp = getattr(client, method)(path, **kwargs)
    try:
        body = resp.json() if resp.content else {}
    except Exception:
        body = {"_raw": resp.content.decode("utf-8", "replace")}
    return resp.status_code, body


def ensure_user(email, password="testpass123!"):
    user, created = User.objects.get_or_create(
        email=email, defaults={"first_name": email.split("@")[0]},
    )
    user.set_password(password)
    user.is_active = True
    user.save()
    return user


def ensure_membership(org, user, role_name="Owner"):
    role, _ = Role.objects.get_or_create(
        organization=org, name=role_name,
        defaults={"permissions": {
            "view_ledger": True, "create_journal": True, "approve_journal": True,
            "post_journal": True, "create_bill": True, "approve_bill": True,
            "pay_bill": True, "create_invoice": True, "edit_reports": True,
            "close_period": True, "manage_users": True, "manage_settings": True,
            "view_audit_log": True,
        }},
    )
    mem, _ = OrganizationMember.objects.update_or_create(
        organization=org, user=user,
        defaults={"role": role, "is_active": True},
    )
    return mem


def login(client, email, password="testpass123!"):
    status, body = _json_call(client, "post", "/api/v1/auth/login/",
                              {"email": email, "password": password})
    assert status == 200, f"login failed ({status}): {body}"
    return body["access"]


def auth_headers(token, org_id):
    return {
        "HTTP_AUTHORIZATION": f"Bearer {token}",
        "HTTP_X_ORGANIZATION_ID": str(org_id),
    }


def main():
    org = Organization.objects.first()
    if not org:
        print("FAIL: no Organization")
        sys.exit(1)

    # Currencies and FX rates don't get rolled back in the savepoint below
    # because they are set up ahead of the savepoint — that's fine, they are
    # reference data.
    for code, name in [("USD", "US Dollar"), ("GBP", "Pound Sterling")]:
        Currency.objects.update_or_create(code=code, defaults={"name": name})
    FXRate.objects.update_or_create(
        from_currency="GBP", to_currency="USD", as_of=date(2026, 4, 1),
        defaults={"rate": Decimal("1.2500"), "source": "smoketest"},
    )

    with transaction.atomic():
        sid = transaction.savepoint()

        # Two users — the approver must differ from the submitter (kernel
        # blocks self-approval).
        alice = ensure_user("alice-api@beakon-smoke.local")
        bob = ensure_user("bob-api@beakon-smoke.local")
        ensure_membership(org, alice)
        ensure_membership(org, bob)

        client = Client()

        # 1. Login
        print("-- 1. login")
        alice_token = login(client, alice.email)
        bob_token = login(client, bob.email)
        alice_h = auth_headers(alice_token, org.id)
        bob_h = auth_headers(bob_token, org.id)

        # 2. Create entity
        print("-- 2. POST /entities/")
        status, body = _json_call(client, "post", "/api/v1/beakon/entities/", {
            "code": "APITEST",
            "name": "API Test Entity",
            "entity_type": "company",
            "functional_currency": "USD",
            "country": "US",
        }, alice_h)
        assert status == 201, f"create entity failed ({status}): {body}"
        entity_id = body["id"]
        print(f"  entity id={entity_id} code={body['code']}")

        # 3. Create accounts
        print("-- 3. POST /accounts/ x4")
        acc_ids = {}
        for code, name, atype, subtype in [
            ("1010", "Bank", "asset", "bank"),
            ("3000", "Capital", "equity", "capital"),
            ("4000", "Revenue", "revenue", "operating_revenue"),
            ("6000", "Opex", "expense", "operating_expense"),
        ]:
            status, body = _json_call(client, "post", "/api/v1/beakon/accounts/", {
                "code": code, "name": name,
                "entity": entity_id, "account_type": atype,
                "account_subtype": subtype,
            }, alice_h)
            assert status == 201, f"create account {code} failed: {body}"
            acc_ids[code] = body["id"]
        print(f"  accounts: {acc_ids}")

        # 4. Create period
        print("-- 4. POST /periods/")
        status, body = _json_call(client, "post", "/api/v1/beakon/periods/", {
            "entity": entity_id,
            "name": "April 2026",
            "period_type": "month",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        }, alice_h)
        assert status == 201, f"create period failed: {body}"

        # 5. Create draft JE
        print("-- 5. POST /journal-entries/  (draft)")
        status, body = _json_call(client, "post", "/api/v1/beakon/journal-entries/", {
            "entity_id": entity_id,
            "date": "2026-04-05",
            "memo": "API smoke — opening capital",
            "lines": [
                {"account_id": acc_ids["1010"], "debit": "50000"},
                {"account_id": acc_ids["3000"], "credit": "50000"},
            ],
        }, alice_h)
        assert status == 201, f"create JE failed: {body}"
        je_id = body["id"]
        print(f"  {body['entry_number']} status={body['status']} lines={len(body['lines'])}")
        assert body["status"] == "draft"

        # 6. Submit for approval (alice)
        print("-- 6. POST .../submit-for-approval/")
        status, body = _json_call(
            client, "post",
            f"/api/v1/beakon/journal-entries/{je_id}/submit-for-approval/",
            {"note": "please review"}, alice_h,
        )
        assert status == 200, body
        assert body["status"] == "pending_approval"

        # 6b. Self-approval blocked
        print("-- 6b. self-approval blocked")
        status, body = _json_call(
            client, "post",
            f"/api/v1/beakon/journal-entries/{je_id}/approve/",
            {}, alice_h,  # alice = submitter
        )
        assert status == 422, f"expected 422 self-approval, got {status}: {body}"
        print(f"  OK 422: {body['error']['code']} — {body['error']['message']}")

        # 7. Approve (bob)
        print("-- 7. POST .../approve/ (bob)")
        status, body = _json_call(
            client, "post",
            f"/api/v1/beakon/journal-entries/{je_id}/approve/",
            {"note": "LGTM"}, bob_h,
        )
        assert status == 200, body
        assert body["status"] == "approved"

        # 8. Post (bob)
        print("-- 8. POST .../post/")
        status, body = _json_call(
            client, "post",
            f"/api/v1/beakon/journal-entries/{je_id}/post/",
            {}, bob_h,
        )
        assert status == 200, body
        assert body["status"] == "posted"
        print(f"  posted_by={body['posted_by']}")

        # 9. Trial balance
        print("-- 9. GET /reports/trial-balance/")
        status, body = _json_call(
            client, "get",
            f"/api/v1/beakon/reports/trial-balance/?entity_id={entity_id}&as_of=2026-04-30",
            None, alice_h,
        )
        assert status == 200, body
        print(f"  balanced={body['totals']['is_balanced']} "
              f"DR={body['totals']['total_debits']} CR={body['totals']['total_credits']}")
        assert body["totals"]["is_balanced"] is True
        assert Decimal(body["totals"]["total_debits"]) == Decimal("50000.00")

        # 10. Entry detail drill-down
        print("-- 10. GET /reports/entry-detail/")
        status, body = _json_call(
            client, "get",
            f"/api/v1/beakon/reports/entry-detail/?entry_id={je_id}",
            None, alice_h,
        )
        assert status == 200, body
        print(f"  {body['entry_number']} status={body['status']} "
              f"lines={len(body['lines'])} history={len(body['approval_history'])}")
        assert len(body["lines"]) == 2
        assert len(body["approval_history"]) >= 3  # create, submit, approve, post

        # 11. List approval actions for this JE
        print("-- 11. GET /approval-actions/?journal_entry=…")
        status, body = _json_call(
            client, "get",
            f"/api/v1/beakon/approval-actions/?journal_entry={je_id}",
            None, alice_h,
        )
        assert status == 200, body
        # DRF default pagination returns {count, results}; our settings use
        # page-based pagination with results list.
        rows = body.get("results", body if isinstance(body, list) else [])
        print(f"  {len(rows)} actions")
        assert len(rows) >= 3

        # 12. Journal listing with status filter
        print("-- 12. GET /reports/journal-listing/")
        status, body = _json_call(
            client, "get",
            f"/api/v1/beakon/reports/journal-listing/?entity_id={entity_id}&status=posted",
            None, alice_h,
        )
        assert status == 200, body
        assert body["count"] == 1
        assert body["entries"][0]["entry_number"].startswith("JE-")
        print(f"  {body['count']} posted entries")

        print("OK: API smoke test passed -- rolling back.")
        transaction.savepoint_rollback(sid)


if __name__ == "__main__":
    main()
