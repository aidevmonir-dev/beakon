"""Seed the ENGINE_FLOW WorkflowDiagram for every existing organization.

The Mermaid source mirrors the eight-stage flow from the architecture
PDF (intake → AI → draft → validation → review → posted → downstream
engines → reports). Operators can edit the text in-browser; this seed
just gives them a starting point.
"""
from django.db import migrations


ENGINE_FLOW_MERMAID = """flowchart TD
    %% ── 1. Intake ──────────────────────────────────────────
    BANK[Bank CSV]:::intake
    PDF[Supplier PDF]:::intake
    JEM[Manual JE]:::intake
    INV[Customer invoice]:::intake

    %% ── 2. AI assist ──────────────────────────────────────
    OCR[OCR + extraction]:::ai
    CAT[AI categorizer<br/>account · dimensions · rebillable]:::ai

    %% ── 3. Draft ──────────────────────────────────────────
    DRAFT[DRAFT staging<br/>Bill / Invoice / JE]:::draft

    %% ── 4. Engine validation ──────────────────────────────
    BAL[Double-entry balance]:::valid
    PER[Period not closed]:::valid
    DIM[Dimension rules<br/>Tab 09 · 311 rules]:::valid
    FX[FX rate captured]:::valid
    CHECK{All checks pass?}:::gate

    %% ── 5. Human review ──────────────────────────────────
    SUB[Submitted<br/>PENDING_APPROVAL]:::human
    REV[Reviewed by 2nd user]:::human
    APP[Approved<br/>ApprovalAction logged]:::human

    %% ── 6. Posted ledger ─────────────────────────────────
    LEDGER[POSTED to ledger<br/>Immutable · audit trail]:::ledger

    %% ── 7. Downstream engines ────────────────────────────
    REC[Recognition<br/>multi-period auto-JE]:::engine
    VAT[VAT routing<br/>Output / Input split]:::engine
    DSB[Disbursements<br/>rebill cost → invoice]:::engine
    REVAL[FX revaluation]:::engine
    CLOSE[Period close<br/>P&amp;L → Retained Earnings]:::engine

    %% ── 8. Reports ───────────────────────────────────────
    TB[Trial Balance · P&amp;L · BS · CF]:::report
    VR[VAT report]:::report
    AGE[AR / AP aging]:::report
    AUD[Audit trail]:::report

    %% ── Edges ────────────────────────────────────────────
    BANK --> OCR
    PDF  --> OCR
    OCR  --> CAT
    CAT  --> DRAFT
    JEM  --> DRAFT
    INV  --> DRAFT

    DRAFT --> BAL
    DRAFT --> PER
    DRAFT --> DIM
    DRAFT --> FX
    BAL --> CHECK
    PER --> CHECK
    DIM --> CHECK
    FX  --> CHECK

    CHECK -- "No · returned" --> DRAFT
    CHECK -- Yes --> SUB
    SUB --> REV --> APP --> LEDGER

    LEDGER --> REC
    LEDGER --> VAT
    LEDGER --> DSB
    LEDGER --> REVAL
    LEDGER --> CLOSE

    REC --> TB
    VAT --> VR
    DSB --> AGE
    REVAL --> TB
    CLOSE --> TB
    LEDGER --> AUD

    %% ── Class styles ─────────────────────────────────────
    classDef intake fill:#dbeafe,stroke:#60a5fa,color:#1e3a8a
    classDef ai     fill:#ede9fe,stroke:#a78bfa,color:#4c1d95
    classDef draft  fill:#fef3c7,stroke:#fbbf24,color:#78350f
    classDef valid  fill:#ffe4e6,stroke:#fb7185,color:#881337
    classDef gate   fill:#fff,stroke:#fb7185,color:#881337,stroke-width:2px
    classDef human  fill:#fef3c7,stroke:#fbbf24,color:#78350f
    classDef ledger fill:#d1fae5,stroke:#10b981,color:#065f46
    classDef engine fill:#dbeafe,stroke:#0ea5e9,color:#0c4a6e
    classDef report fill:#f3f4f6,stroke:#9ca3af,color:#1f2937
"""


def seed(apps, schema_editor):
    WorkflowDiagram = apps.get_model("beakon_core", "WorkflowDiagram")
    Organization = apps.get_model("organizations", "Organization")
    for org in Organization.objects.all():
        WorkflowDiagram.objects.update_or_create(
            organization=org,
            code="ENGINE_FLOW",
            defaults={
                "name": "Engine workflow",
                "description": "End-to-end flow from messy inputs to reviewed financial reports.",
                "mermaid_src": ENGINE_FLOW_MERMAID.strip(),
            },
        )


def unseed(apps, schema_editor):
    WorkflowDiagram = apps.get_model("beakon_core", "WorkflowDiagram")
    WorkflowDiagram.objects.filter(code="ENGINE_FLOW").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("beakon_core", "0032_workflowdiagram"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
