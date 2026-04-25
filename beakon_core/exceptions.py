"""Beakon accounting kernel exceptions.

All ledger operations should raise these. Calling code surfaces them as
422 responses with {code, message, details}.
"""


class BeakonError(Exception):
    """Base class for all accounting-kernel errors."""

    def __init__(self, message, code=None, details=None):
        self.message = message
        self.code = code
        self.details = details or {}
        super().__init__(self.message)


class ValidationError(BeakonError):
    """Journal or line failed a validation rule (unbalanced, min-lines, etc.)."""


class InvalidTransition(BeakonError):
    """State-machine transition was not allowed from the current status."""


class PeriodClosed(BeakonError):
    """Posting to / editing a closed period."""


class PostedImmutable(BeakonError):
    """Attempt to edit or re-approve a posted/reversed entry."""


class EntityMismatch(BeakonError):
    """Journal line references an account that belongs to a different entity."""


class FXRateMissing(BeakonError):
    """Required FX rate not found for the JE date and currency pair."""


class SelfApproval(BeakonError):
    """Same user tried to approve a JE they submitted or created."""


class IntercompanyUnbalanced(BeakonError):
    """Intercompany group's entity-pair-net is not zero."""
