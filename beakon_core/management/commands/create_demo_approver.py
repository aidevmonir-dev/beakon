"""Create a demo approver — a second user with admin role on an org.

Beakon's segregation-of-duties guard refuses to let the same user submit
AND approve a journal entry. For demos that's the right behaviour, but
solo dev / first-time setup needs a second seat. This command creates
that seat in one shot.

The created user has the ``admin`` role, which carries:
    approve_journal=True, approve_bill=True, post_journal=True,
    pay_bill=True, manage_users=True, etc.

Usage:
    python manage.py create_demo_approver
        # Defaults: approver@beakon.local / approve-me / first org
        # If the email already exists, just (re)attaches them to the org.

    python manage.py create_demo_approver \\
        --email sarah@beakon.local --password secret123 \\
        --first-name Sarah --last-name Approver \\
        --org-slug thomas-foundation

After it runs, log in as the new user in an incognito/private window
and you can approve any JE / Bill / Invoice the original user submitted.
"""
from django.core.management.base import BaseCommand

from accounts.models import User
from organizations.models import Organization, OrganizationMember, Role


class Command(BaseCommand):
    help = "Create a second user with admin role for SoD-aware demo flows."

    def add_arguments(self, parser):
        parser.add_argument("--email", default="approver@beakon.local")
        parser.add_argument("--password", default="approve-me")
        parser.add_argument("--first-name", default="Sarah")
        parser.add_argument("--last-name", default="Approver")
        parser.add_argument(
            "--org-slug",
            help="Slug of the organization to attach to. Default: first org in the DB.",
        )
        parser.add_argument(
            "--role-slug", default="admin",
            help="System role slug (default: admin — has approve_journal + approve_bill).",
        )

    def handle(self, *args, **opts):
        email = opts["email"]
        password = opts["password"]

        # ── Resolve target org ──────────────────────────────────────
        if opts["org_slug"]:
            try:
                org = Organization.objects.get(slug=opts["org_slug"])
            except Organization.DoesNotExist:
                self.stderr.write(self.style.ERROR(
                    f"No organization with slug={opts['org_slug']!r}"
                ))
                return
        else:
            org = Organization.objects.order_by("created_at").first()
            if org is None:
                self.stderr.write(self.style.ERROR(
                    "No organizations exist yet. Create one first."
                ))
                return
            self.stdout.write(f"Using first org: {org.slug}")

        # ── Resolve role ────────────────────────────────────────────
        role = Role.objects.filter(organization=org, slug=opts["role_slug"]).first()
        if role is None:
            self.stderr.write(self.style.ERROR(
                f"Role '{opts['role_slug']}' not found on org '{org.slug}'. "
                f"Available: {list(org.roles.values_list('slug', flat=True))}"
            ))
            return

        # ── Find or create user ─────────────────────────────────────
        user = User.objects.filter(email=email).first()
        if user is None:
            user = User.objects.create_user(
                email=email,
                password=password,
                first_name=opts["first_name"],
                last_name=opts["last_name"],
            )
            user_action = "Created"
        else:
            user_action = "Found existing"
            # Reset password so the docs/email are accurate even after reruns.
            user.set_password(password)
            user.save(update_fields=["password"])

        # ── Attach to org (or update role) ──────────────────────────
        member, created = OrganizationMember.objects.update_or_create(
            organization=org, user=user,
            defaults={"role": role, "is_active": True},
        )
        member_action = "Created membership" if created else "Updated existing membership"

        self.stdout.write(self.style.SUCCESS(
            f"\nDone.\n"
            f"  {user_action} user: {user.email}\n"
            f"  Password (reset on every run): {password}\n"
            f"  Org: {org.slug} ({org.name})\n"
            f"  Role: {role.slug}\n"
            f"  {member_action}\n"
            f"\n"
            f"Now: open an incognito/private window, sign in as "
            f"{user.email} / {password}, and you can approve entries "
            f"your main user submits.\n"
        ))
