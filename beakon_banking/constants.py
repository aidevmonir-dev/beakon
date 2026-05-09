"""Beakon banking constants."""

# BankTransaction lifecycle
TXN_NEW = "new"                # fresh import, not yet touched by a user
TXN_PROPOSED = "proposed"      # a draft JE exists and is working its way through approval
TXN_MATCHED = "matched"        # the proposed JE has been POSTED — bank line is accounted for
TXN_IGNORED = "ignored"        # user decided to skip (e.g. duplicate, internal transfer)

TXN_STATUS_CHOICES = [
    (TXN_NEW, "New"),
    (TXN_PROPOSED, "Proposed"),
    (TXN_MATCHED, "Matched"),
    (TXN_IGNORED, "Ignored"),
]


# FeedImport run status
FEED_PENDING = "pending"
FEED_PROCESSING = "processing"
FEED_COMPLETED = "completed"
FEED_FAILED = "failed"

FEED_STATUS_CHOICES = [
    (FEED_PENDING, "Pending"),
    (FEED_PROCESSING, "Processing"),
    (FEED_COMPLETED, "Completed"),
    (FEED_FAILED, "Failed"),
]


# Feed source
SOURCE_CSV = "csv"
SOURCE_OFX = "ofx"
SOURCE_MANUAL = "manual"
SOURCE_AI = "ai"

SOURCE_CHOICES = [
    (SOURCE_CSV, "CSV"),
    (SOURCE_OFX, "OFX"),
    (SOURCE_MANUAL, "Manual"),
    (SOURCE_AI, "AI Statement"),
]


# Error codes
ERR_CSV_PARSE = "BNK201"
ERR_MISSING_COLUMN = "BNK202"
ERR_INVALID_DATE = "BNK203"
ERR_INVALID_AMOUNT = "BNK204"
ERR_ALREADY_MATCHED = "BNK205"
ERR_BANK_ACCOUNT_CURRENCY_MISMATCH = "BNK206"
ERR_AI_PARSE = "BNK210"
