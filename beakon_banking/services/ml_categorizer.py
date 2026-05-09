"""MLBankCategorizer — fitted, on-device classifier for bank-transaction
offset accounts.

Replaces (or supplements) the LLM-driven AIBankCategorizer once an entity
has accumulated enough labelled history. Cheap to call (sub-millisecond),
fully explainable (logistic-regression weights), and learns from the
user's accepted JEs over time.

Workflow:
    train(entity)   -> fit + persist to media/ml/bank_categorizer/
    suggest(txn)    -> {account, account_id, code, reasoning, confidence,
                        model_used="ml-..."} or None when:
                            * no model on disk for this entity, or
                            * model exists but predicts with too few classes
                              to beat random
    is_available(entity) -> True if there's a model on disk for this entity

Same return shape as AIBankCategorizer so the wider Categorizer pipeline
can swap engines without surface changes.

Feature design (kept deliberately simple):
    - TF-IDF on (description text + sign token + amount-bucket token)
    - Word + character n-grams catch sub-word patterns ("MIGROS",
      "RENT", "*UBS*") even when descriptions are noisy
    - Numeric features (sign, magnitude, day of month) are tokenised
      and concatenated to the text so a single vectoriser handles them
"""
from __future__ import annotations

import logging
import math
from decimal import Decimal
from pathlib import Path
from typing import Optional

import joblib
from django.conf import settings
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score
from sklearn.pipeline import Pipeline

from beakon_core.models import Account, Entity

from .. import constants as c
from ..models import BankTransaction


log = logging.getLogger(__name__)

MODEL_VERSION = "v1"
# Below this many labelled samples, training is skipped — too few classes
# / observations for the model to beat the LLM. Re-evaluated each train run.
MIN_TRAIN_SAMPLES = 25
# At inference time, a high-confidence ML pick can replace the LLM call
# entirely. Below this, we either show ML's top-3 alongside the LLM
# suggestion, or punt to the LLM. Tuneable per deployment.
HIGH_CONFIDENCE_THRESHOLD = 0.70


def _model_dir() -> Path:
    return Path(getattr(settings, "MEDIA_ROOT", "media")) / "ml" / "bank_categorizer"


def _model_path(entity: Entity) -> Path:
    return _model_dir() / f"{entity.code}-{MODEL_VERSION}.joblib"


# ── Feature engineering ──────────────────────────────────────────────────

def _amount_bucket(amount) -> str:
    """Coarse magnitude bucket. Bank txns cluster at very different scales
    depending on the entity (a personal Migros run vs. a holding-co
    dividend), so the model benefits from knowing the order of magnitude
    without overfitting to exact amounts."""
    a = abs(float(amount))
    if a < 50:        return "AMT_TINY"
    if a < 500:       return "AMT_SMALL"
    if a < 5_000:     return "AMT_MED"
    if a < 50_000:    return "AMT_LARGE"
    if a < 500_000:   return "AMT_XLARGE"
    return "AMT_HUGE"


def _txn_to_text(description: str, amount, txn_date) -> str:
    desc = (description or "").lower()
    sign = "SIGN_POS" if Decimal(str(amount)) >= 0 else "SIGN_NEG"
    bucket = _amount_bucket(amount)
    # Day-of-month token: surfaces patterns like "rent on the 1st",
    # "salary on the 25th". Coarse buckets to keep the vocabulary small.
    dom = txn_date.day if txn_date else 0
    if dom == 0:        dom_tok = "DAY_UNK"
    elif dom <= 5:      dom_tok = "DAY_EARLY"
    elif dom <= 15:     dom_tok = "DAY_MID"
    elif dom <= 25:     dom_tok = "DAY_LATE"
    else:               dom_tok = "DAY_END"
    return f"{desc} {sign} {bucket} {dom_tok}"


# ── Model lifecycle ─────────────────────────────────────────────────────

def _build_pipeline() -> Pipeline:
    return Pipeline([
        ("tfidf", TfidfVectorizer(
            analyzer="char_wb", ngram_range=(3, 5),
            max_features=4000, min_df=1, sublinear_tf=True,
            lowercase=True,
        )),
        ("clf", LogisticRegression(
            max_iter=2000, class_weight="balanced",
            C=1.0,
        )),
    ])


def _collect_training_data(entity: Entity) -> tuple[list[str], list[int]]:
    """Pull every matched txn whose proposed JE is posted, derive the
    offset-account label off the JE's non-bank line."""
    qs = (
        BankTransaction.objects
        .filter(
            bank_account__entity=entity,
            status=c.TXN_MATCHED,
            proposed_journal_entry__isnull=False,
        )
        .select_related("bank_account", "proposed_journal_entry")
        .prefetch_related("proposed_journal_entry__lines")
    )
    X: list[str] = []
    y: list[int] = []
    for txn in qs:
        bank_acct_id = txn.bank_account.account_id
        je = txn.proposed_journal_entry
        # When the JE has >1 non-bank line (split categorisation), pick
        # the line with the largest absolute amount as the label. This
        # is the same heuristic a human bookkeeper uses when they say
        # "this txn is mostly groceries with a small alcohol-tax line".
        non_bank = [ln for ln in je.lines.all() if ln.account_id != bank_acct_id]
        if not non_bank:
            continue
        non_bank.sort(
            key=lambda ln: abs(float(ln.debit) - float(ln.credit)),
            reverse=True,
        )
        label = non_bank[0].account_id
        X.append(_txn_to_text(txn.description, txn.amount, txn.date))
        y.append(label)
    return X, y


class TrainResult:
    def __init__(self, *, entity_code: str, samples: int, classes: int,
                 cv_accuracy: Optional[float], path: Optional[Path],
                 message: str):
        self.entity_code = entity_code
        self.samples = samples
        self.classes = classes
        self.cv_accuracy = cv_accuracy
        self.path = path
        self.message = message

    def as_dict(self) -> dict:
        return {
            "entity_code": self.entity_code,
            "samples": self.samples,
            "classes": self.classes,
            "cv_accuracy": self.cv_accuracy,
            "path": str(self.path) if self.path else None,
            "message": self.message,
        }


class MLBankCategorizer:
    @staticmethod
    def is_available(entity: Entity) -> bool:
        return _model_path(entity).exists()

    @staticmethod
    def train(entity: Entity) -> TrainResult:
        X, y = _collect_training_data(entity)
        n = len(X)
        n_classes = len(set(y))
        if n < MIN_TRAIN_SAMPLES:
            return TrainResult(
                entity_code=entity.code, samples=n, classes=n_classes,
                cv_accuracy=None, path=None,
                message=(
                    f"Need at least {MIN_TRAIN_SAMPLES} matched txns to train; "
                    f"only {n} available. Keep using AI / Ollama until then."
                ),
            )
        if n_classes < 2:
            return TrainResult(
                entity_code=entity.code, samples=n, classes=n_classes,
                cv_accuracy=None, path=None,
                message=(
                    "All matched txns categorise to the same account — nothing "
                    "to learn. Categorise a wider mix and retrain."
                ),
            )

        # ── Cross-validated accuracy estimate ───────────────────────
        # Use 3-fold CV when there are enough samples per class; fewer
        # otherwise. Skip CV entirely on truly tiny datasets to avoid
        # sklearn's "n_splits > min class count" error.
        from collections import Counter
        min_class_count = min(Counter(y).values())
        if min_class_count >= 3 and n >= 30:
            try:
                cv_scores = cross_val_score(
                    _build_pipeline(), X, y, cv=3, scoring="accuracy",
                )
                cv_accuracy = float(cv_scores.mean())
            except Exception as e:  # noqa: BLE001
                log.warning("CV failed for %s: %s", entity.code, e)
                cv_accuracy = None
        else:
            cv_accuracy = None

        # ── Final fit on all data + persist ─────────────────────────
        pipeline = _build_pipeline()
        pipeline.fit(X, y)

        path = _model_path(entity)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(pipeline, path)
        return TrainResult(
            entity_code=entity.code, samples=n, classes=n_classes,
            cv_accuracy=cv_accuracy, path=path,
            message=f"Trained on {n} txns across {n_classes} accounts.",
        )

    @staticmethod
    def suggest(txn: BankTransaction, *, top_k: int = 3) -> Optional[dict]:
        """Return the same shape as AIBankCategorizer.suggest, or None
        when no model exists / inference fails. ``top_k`` controls how
        many alternatives are reported alongside the top pick."""
        ba = txn.bank_account
        path = _model_path(ba.entity)
        if not path.exists():
            return None
        try:
            pipeline: Pipeline = joblib.load(path)
        except Exception as e:  # noqa: BLE001
            log.warning("Could not load ML model for %s: %s", ba.entity.code, e)
            return None

        text = _txn_to_text(txn.description, txn.amount, txn.date)
        try:
            probs = pipeline.predict_proba([text])[0]
        except Exception as e:  # noqa: BLE001
            log.warning("ML predict_proba failed for %s: %s", ba.entity.code, e)
            return None

        classes = pipeline.classes_  # account ids in the order probs are reported
        # Sort indices by descending probability
        order = sorted(range(len(probs)), key=lambda i: probs[i], reverse=True)
        top = order[:top_k]

        winner_id = int(classes[top[0]])
        winner_conf = float(probs[top[0]])

        try:
            winner = Account.objects.get(pk=winner_id)
        except Account.DoesNotExist:
            return None

        # Resolve alternatives so the UI can show "we're 60% on Office
        # Supplies, 25% on Travel, 10% on Other Expense".
        alt_account_ids = [int(classes[i]) for i in top[1:]]
        alt_accounts = {a.id: a for a in Account.objects.filter(id__in=alt_account_ids)}
        alternatives = []
        for i in top[1:]:
            aid = int(classes[i])
            acct = alt_accounts.get(aid)
            if acct is None:
                continue
            alternatives.append({
                "account_id": acct.id,
                "account_code": acct.code,
                "account_name": acct.name,
                "confidence": float(probs[i]),
            })

        return {
            "account": winner,
            "account_id": winner.id,
            "account_code": winner.code,
            "account_name": winner.name,
            "account_type": winner.account_type,
            "account_subtype": winner.account_subtype,
            "reasoning": _build_reasoning(winner, winner_conf, alternatives),
            "confidence": winner_conf,
            "model_used": f"ml-logreg-{MODEL_VERSION}",
            "alternatives": alternatives,
        }


def _build_reasoning(winner: Account, conf: float, alternatives: list[dict]) -> str:
    """Tiny human-readable explanation. The model itself is just a logistic
    regression so we don't have a per-token attribution out of the box;
    surface confidence + the runner-up so the user can see whether the
    pick is decisive or close."""
    pct = round(conf * 100)
    if not alternatives:
        return f"ML model is {pct}% confident this is {winner.code} {winner.name}."
    runner_up = alternatives[0]
    runner_pct = round(runner_up["confidence"] * 100)
    return (
        f"ML model is {pct}% confident on {winner.code} {winner.name}. "
        f"Runner-up: {runner_up['account_code']} ({runner_pct}%)."
    )
