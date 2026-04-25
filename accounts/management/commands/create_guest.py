from django.core.management.base import BaseCommand

from accounts.models import User
from ledger.seed import seed_chart_of_accounts
from organizations.services import OrganizationService


class Command(BaseCommand):
    help = "Create a guest user with a demo organization"

    def handle(self, *args, **options):
        email = "guest@beakon.local"
        password = "guest1234"

        user, created = User.objects.get_or_create(
            email=email,
            defaults={
                "first_name": "Guest",
                "last_name": "User",
                "is_email_verified": True,
            },
        )

        if created:
            user.set_password(password)
            user.save()
            self.stdout.write(self.style.SUCCESS(f"Created user: {email}"))
        else:
            self.stdout.write(f"User {email} already exists")

        # Create org if user has none
        if not user.memberships.exists():
            org = OrganizationService.create_organization(
                name="Demo Company",
                user=user,
                currency="USD",
                country="US",
            )
            seed_chart_of_accounts(org)
            self.stdout.write(self.style.SUCCESS(f"Created organization: {org.name}"))
        else:
            self.stdout.write("Organization already exists")

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Guest login ready:"))
        self.stdout.write(f"  Email:    {email}")
        self.stdout.write(f"  Password: {password}")
