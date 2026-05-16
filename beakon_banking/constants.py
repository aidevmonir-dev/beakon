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


# AvaloqFeedDrop lifecycle (one zip from a custodian's daily push)
DROP_RECEIVED = "received"
DROP_INGESTING = "ingesting"
DROP_INGESTED = "ingested"
DROP_FAILED = "failed"

DROP_STATUS_CHOICES = [
    (DROP_RECEIVED, "Received"),
    (DROP_INGESTING, "Ingesting"),
    (DROP_INGESTED, "Ingested"),
    (DROP_FAILED, "Failed"),
]


# ReconciliationBreak — what *kind* of mismatch
BREAK_POSITION_COUNT = "position_count_mismatch"
BREAK_QTY_MISMATCH = "position_qty_mismatch"
BREAK_UNKNOWN_ISIN = "unknown_isin"
BREAK_MISSING_PORTFOLIO = "missing_portfolio"
BREAK_FX_MISSING = "fx_rate_missing"

BREAK_TYPE_CHOICES = [
    (BREAK_POSITION_COUNT, "Position count mismatch"),
    (BREAK_QTY_MISMATCH, "Position quantity mismatch"),
    (BREAK_UNKNOWN_ISIN, "Unknown ISIN — no TaxLot"),
    (BREAK_MISSING_PORTFOLIO, "Portfolio not found in Beakon"),
    (BREAK_FX_MISSING, "FX rate missing for currency"),
]


# ReconciliationBreak — *why* the break exists (auto-classified at
# reconciliation time). The same break_type can land in different
# categories: a quantity mismatch caused by a T+2 settlement is a
# `timing` break; the same mismatch caused by an unbooked trade is
# `missing_trade`. Categories drive the visual grouping in the UI and
# the action-queue copy ("5 require investigation, 3 will resolve by T+2").
BREAK_CAT_TIMING = "timing"
BREAK_CAT_FX = "fx"
BREAK_CAT_MISSING_TRADE = "missing_trade"
BREAK_CAT_CORP_ACTION = "corp_action"
BREAK_CAT_TRUE_ERROR = "true_error"
BREAK_CAT_UNKNOWN = "unknown"

BREAK_CATEGORY_CHOICES = [
    (BREAK_CAT_TIMING, "Timing — likely resolves by T+2"),
    (BREAK_CAT_FX, "FX — rate / valuation differential"),
    (BREAK_CAT_MISSING_TRADE, "Missing trade — no record in ledger"),
    (BREAK_CAT_CORP_ACTION, "Corporate action — split / dividend"),
    (BREAK_CAT_TRUE_ERROR, "True error — investigate"),
    (BREAK_CAT_UNKNOWN, "Unknown — needs human review"),
]


# Avaloq file suffixes (the five files inside one daily zip)
AVALOQ_FILE_CASH = "cash"
AVALOQ_FILE_SECURITIES = "securities"
AVALOQ_FILE_ORDERBOOK = "orderbook"
AVALOQ_FILE_POSITIONS = "positions"
AVALOQ_FILE_PERF = "perf"

AVALOQ_FILE_TYPES = [
    AVALOQ_FILE_CASH,
    AVALOQ_FILE_SECURITIES,
    AVALOQ_FILE_ORDERBOOK,
    AVALOQ_FILE_POSITIONS,
    AVALOQ_FILE_PERF,
]


# Add the Avaloq SFTP source so FeedImport rows can be tagged as feed-sourced
SOURCE_AVALOQ_SFTP = "avaloq_sftp"
SOURCE_CHOICES = SOURCE_CHOICES + [(SOURCE_AVALOQ_SFTP, "Avaloq SFTP feed")]
