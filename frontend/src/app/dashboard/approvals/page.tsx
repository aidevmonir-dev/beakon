"use client";

/* Approvals — the unified bookkeeper review queue.
 *
 * Per Thomas's Accounting_Engine_Developer_Instructions.docx §3 step 4:
 * the bookkeeper sees ONE review screen for everything pending sign-off.
 *
 * Three sources feed each bucket:
 *   - JEs    in the matching status   → /journal-entries/{id}/...
 *   - Bills  in the matching status   → /bills/{id}/...
 *   - Invoices in matching status     → /invoices/{id}/...
 *     (note: "approved" maps to invoice status "issued" — AR-side terminology)
 *
 * Each row shows a TYPE badge so the bookkeeper knows which object they are
 * acting on; the action button is always labelled by the verb the
 * bookkeeper cares about — Approve / Reject / Post / Pay → / Receive → /
 * To draft — the underlying endpoint is picked from row.kind.
 *
 * Polish vs. plain queue:
 *   - Aging column (color-coded by days since document date)
 *   - Entity filter (multi-entity controllers only see their slice)
 *   - Inline rejection reason form (no browser prompt())
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckSquare, Check, X, RotateCcw, Filter, Loader2, Send,
} from "lucide-react";
import { api } from "@/lib/api";
import { fmt2, fmtDate, fmtLabel } from "@/lib/format";


type RowKind = "je" | "bill" | "invoice";

interface PendingRow {
  kind: RowKind;
  id: number;
  /** "JE-000123" / "BILL-000004" / "INV-000005" */
  reference: string;
  entity_code: string;
  date: string;
  source_label: string;
  memo: string;
  total: string;
  currency: string;
  submitted_by: string | null;
  /** /dashboard/journal-entries/{id} | /dashboard/bills | /dashboard/invoices */
  detail_href: string;
}

interface JESummary {
  id: number;
  entry_number: string;
  entity_code: string;
  date: string;
  status: string;
  source_type: string;
  memo: string;
  total: string;
  functional_currency: string;
  created_by: string | null;
  approved_by: string | null;
}

interface BillSummary {
  id: number;
  reference: string;
  bill_number: string;
  entity_code: string;
  vendor_code: string;
  vendor_name: string;
  invoice_date: string;
  currency: string;
  total: string;
  status: string;
}

interface InvoiceSummary {
  id: number;
  reference: string;
  invoice_number: string;
  entity_code: string;
  customer_code: string;
  customer_name: string;
  invoice_date: string;
  currency: string;
  total: string;
  status: string;
}


function kindBadge(kind: RowKind): { label: string; cls: string } {
  switch (kind) {
    case "bill":    return { label: "Bill",     cls: "bg-amber-50 text-amber-800 border-amber-200" };
    case "invoice": return { label: "Invoice",  cls: "bg-sky-50 text-sky-800 border-sky-200" };
    case "je":      return { label: "Journal",  cls: "bg-canvas-100 text-gray-700 border-canvas-200" };
  }
}


/** Days between two ISO dates (YYYY-MM-DD), ignoring time. */
function daysSince(isoDate: string): number {
  const d = new Date(isoDate + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ms = today.getTime() - d.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}


/** Color tier for aging — matches what controllers expect. */
function ageBadge(days: number): { label: string; cls: string } {
  if (days <= 1)  return { label: days === 0 ? "today" : "1d", cls: "bg-canvas-100 text-gray-600" };
  if (days <= 3)  return { label: `${days}d`, cls: "bg-amber-50 text-amber-800" };
  if (days <= 7)  return { label: `${days}d`, cls: "bg-orange-50 text-orange-800" };
  return { label: `${days}d`, cls: "bg-red-50 text-red-800 font-semibold" };
}


export default function ApprovalsPage() {
  const [bucket, setBucket] = useState<"pending_approval" | "approved" | "rejected">("pending_approval");
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Inline rejection form state — one row at a time.
  const [rejectingKey, setRejectingKey] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>("");

  // Bulk-action state — only meaningful in the pending_approval tab.
  // Keys are `${kind}-${id}`; matches `rowKey` used in the row render.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState<{ done: number; total: number } | null>(null);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const jeStatus = bucket;
      const billStatus = bucket;
      const invoiceStatus =
        bucket === "approved" ? "issued"
        : bucket === "rejected" ? "rejected"
        : "pending_approval";

      const [jeRes, billRes, invRes] = await Promise.all([
        api.get<{ entries: JESummary[] }>(
          "/beakon/reports/journal-listing/", { status: jeStatus, limit: "500" },
        ).catch(() => ({ entries: [] as JESummary[] })),
        api.get<BillSummary[] | { results: BillSummary[] }>(
          "/beakon/bills/", { status: billStatus, page_size: "500" },
        ).catch(() => [] as BillSummary[]),
        api.get<InvoiceSummary[] | { results: InvoiceSummary[] }>(
          "/beakon/invoices/", { status: invoiceStatus, page_size: "500" },
        ).catch(() => [] as InvoiceSummary[]),
      ]);

      const bills: BillSummary[] = Array.isArray(billRes)
        ? billRes
        : ((billRes as any)?.results ?? []);
      const invoices: InvoiceSummary[] = Array.isArray(invRes)
        ? invRes
        : ((invRes as any)?.results ?? []);

      const merged: PendingRow[] = [
        ...(jeRes.entries || []).map<PendingRow>((e) => ({
          kind: "je",
          id: e.id,
          reference: e.entry_number,
          entity_code: e.entity_code,
          date: e.date,
          source_label: fmtLabel(e.source_type),
          memo: e.memo,
          total: e.total,
          currency: e.functional_currency,
          submitted_by: e.created_by,
          detail_href: `/dashboard/journal-entries/${e.id}`,
        })),
        ...bills.map<PendingRow>((b) => ({
          kind: "bill",
          id: b.id,
          reference: b.reference || b.bill_number || `BILL-${b.id}`,
          entity_code: b.entity_code,
          date: b.invoice_date,
          source_label: `Vendor · ${b.vendor_code}`,
          memo: b.vendor_name,
          total: b.total,
          currency: b.currency,
          submitted_by: null,
          detail_href: `/dashboard/bills?focus=${b.id}`,
        })),
        ...invoices.map<PendingRow>((iv) => ({
          kind: "invoice",
          id: iv.id,
          reference: iv.reference || iv.invoice_number || `INV-${iv.id}`,
          entity_code: iv.entity_code,
          date: iv.invoice_date,
          source_label: `Customer · ${iv.customer_code}`,
          memo: iv.customer_name,
          total: iv.total,
          currency: iv.currency,
          submitted_by: null,
          detail_href: `/dashboard/invoices?focus=${iv.id}`,
        })),
      ];

      // Stable order: oldest dates first so Bob clears the backlog.
      merged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      setRows(merged);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [bucket]);

  // Reset any in-flight inline rejection form on tab switch.
  useEffect(() => {
    setRejectingKey(null);
    setRejectReason("");
  }, [bucket]);

  // Entity options derived from the current rows. Stable order, "all" first.
  const entityOptions = useMemo(() => {
    const codes = Array.from(new Set(rows.map((r) => r.entity_code).filter(Boolean))).sort();
    return ["all", ...codes];
  }, [rows]);

  // Reset entity filter if the current selection disappears (e.g. tab switch).
  useEffect(() => {
    if (entityFilter !== "all" && !entityOptions.includes(entityFilter)) {
      setEntityFilter("all");
    }
  }, [entityOptions, entityFilter]);

  const visibleRows = useMemo(
    () => entityFilter === "all"
      ? rows
      : rows.filter((r) => r.entity_code === entityFilter),
    [rows, entityFilter],
  );

  const counts = useMemo(() => ({
    je:      visibleRows.filter((r) => r.kind === "je").length,
    bill:    visibleRows.filter((r) => r.kind === "bill").length,
    invoice: visibleRows.filter((r) => r.kind === "invoice").length,
  }), [visibleRows]);

  const act = async (
    row: PendingRow,
    action: "approve" | "reject" | "post" | "return-to-draft",
    extra: Record<string, string> = {},
  ) => {
    const key = `${row.kind}:${row.id}:${action}`;
    setBusyKey(key);
    setErr(null);
    try {
      if (action === "approve") {
        if (row.kind === "je") {
          await api.post(`/beakon/journal-entries/${row.id}/approve/`, extra);
        } else if (row.kind === "bill") {
          await api.post(`/beakon/bills/${row.id}/approve/`, extra);
        } else {
          // Invoices use "issue" as the approval action — same idea, AR-side terminology.
          await api.post(`/beakon/invoices/${row.id}/issue/`, extra);
        }
      } else if (action === "reject") {
        if (row.kind === "je") {
          await api.post(`/beakon/journal-entries/${row.id}/reject/`, extra);
        } else if (row.kind === "bill") {
          await api.post(`/beakon/bills/${row.id}/reject/`, extra);
        } else {
          await api.post(`/beakon/invoices/${row.id}/reject/`, extra);
        }
      } else if (action === "post") {
        await api.post(`/beakon/journal-entries/${row.id}/post/`, extra);
      } else if (action === "return-to-draft") {
        if (row.kind === "je") {
          await api.post(`/beakon/journal-entries/${row.id}/return-to-draft/`, extra);
        } else if (row.kind === "bill") {
          await api.post(`/beakon/bills/${row.id}/return-to-draft/`, extra);
        } else {
          await api.post(`/beakon/invoices/${row.id}/return-to-draft/`, extra);
        }
      }
      await load();
    } catch (e: any) {
      setErr(e?.error?.message || e?.message || `Failed to ${action} ${row.reference}`);
    } finally {
      setBusyKey(null);
    }
  };

  // Reset selection on tab/filter changes — picks could refer to rows
  // that are no longer visible, which would silently no-op.
  useEffect(() => { setSelected(new Set()); setBulkSummary(null); }, [bucket, entityFilter]);

  const rowKeyOf = (r: PendingRow) => `${r.kind}-${r.id}`;
  const findRowByKey = (key: string) => visibleRows.find((r) => rowKeyOf(r) === key);

  const allSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(rowKeyOf(r)));
  const someSelected = !allSelected && visibleRows.some((r) => selected.has(rowKeyOf(r)));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const r of visibleRows) next.delete(rowKeyOf(r));
      } else {
        for (const r of visibleRows) next.add(rowKeyOf(r));
      }
      return next;
    });
  };

  const toggleOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Bulk approve (and optionally post). Runs sequentially so the user
  // sees a deterministic progress count and so the backend doesn't
  // serialize-then-fail under a parallel storm. JEs go approve → post
  // when ``alsoPost`` is true; bills/invoices just approve/issue.
  const runBulk = async (alsoPost: boolean) => {
    const keys = Array.from(selected);
    const targets = keys.map(findRowByKey).filter((r): r is PendingRow => Boolean(r));
    if (targets.length === 0) return;

    setBulkRunning({ done: 0, total: targets.length });
    setBulkSummary(null);
    setErr(null);

    const failures: { ref: string; msg: string }[] = [];
    let posted = 0;
    let approved = 0;

    for (let i = 0; i < targets.length; i++) {
      const r = targets[i];
      try {
        if (r.kind === "je") {
          await api.post(`/beakon/journal-entries/${r.id}/approve/`, {});
          approved += 1;
          if (alsoPost) {
            await api.post(`/beakon/journal-entries/${r.id}/post/`, {});
            posted += 1;
          }
        } else if (r.kind === "bill") {
          await api.post(`/beakon/bills/${r.id}/approve/`, {});
          approved += 1;
        } else {
          // invoice — "issue" is the AR-side approval verb
          await api.post(`/beakon/invoices/${r.id}/issue/`, {});
          approved += 1;
        }
      } catch (e: any) {
        failures.push({
          ref: r.reference,
          msg: e?.error?.message || e?.message || "Failed",
        });
      }
      setBulkRunning({ done: i + 1, total: targets.length });
    }

    setBulkRunning(null);
    setSelected(new Set());

    let summary = `${approved} of ${targets.length} approved`;
    if (alsoPost) summary += ` · ${posted} posted`;
    if (failures.length > 0) {
      summary += ` · ${failures.length} failed (${failures.slice(0, 3).map((f) => f.ref).join(", ")}${failures.length > 3 ? "…" : ""})`;
    }
    setBulkSummary(summary);
    if (failures.length > 0) {
      setErr(failures.map((f) => `${f.ref}: ${f.msg}`).slice(0, 5).join(" · "));
    }
    await load();
  };

  const submitReject = async (row: PendingRow) => {
    const reason = rejectReason.trim();
    if (!reason) {
      setErr("A reason is required to reject — short note is fine.");
      return;
    }
    await act(row, "reject", { reason });
    setRejectingKey(null);
    setRejectReason("");
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Approvals</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Unified bookkeeper review queue — Bills, Invoices and Journal Entries.
            Per Thomas&apos;s Accounting Engine spec §3 step 4: control before posting.
          </p>
        </div>
      </div>

      <div className="card p-4">
        {/* ── Tabs + entity filter + counter ─────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 mb-4 border-b border-canvas-100 pb-3">
          {(["pending_approval", "approved", "rejected"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBucket(b)}
              className={
                "px-3 py-1.5 rounded-lg text-xs font-medium " +
                (bucket === b
                  ? "bg-brand-50 text-brand-800"
                  : "text-gray-600 hover:bg-canvas-50")
              }
            >
              {b.replace("_", " ")}
            </button>
          ))}

          <div className="ml-2 inline-flex items-center gap-1.5 border-l border-canvas-100 pl-3">
            <Filter className="w-3 h-3 text-gray-400" />
            <label className="text-[11px] text-gray-500 mr-1">Entity</label>
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="text-xs px-2 py-1 rounded border border-canvas-200 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-300"
            >
              {entityOptions.map((code) => (
                <option key={code} value={code}>
                  {code === "all" ? "All entities" : code}
                </option>
              ))}
            </select>
          </div>

          <span className="ml-auto text-xs text-gray-400">
            {loading
              ? "loading…"
              : `${visibleRows.length} ${bucket.replace("_", " ")} · ${counts.bill} bills · ${counts.invoice} invoices · ${counts.je} JEs`}
          </span>
        </div>

        {/* ── Bulk action bar (pending tab only) ─────────────────────── */}
        {bucket === "pending_approval" && selected.size > 0 && (
          <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50/60 p-2.5 flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium text-brand-900">
              {selected.size} selected
            </span>
            <span className="text-gray-300">·</span>
            <button
              onClick={() => runBulk(false)}
              disabled={bulkRunning !== null}
              className="text-xs px-3 py-1 rounded bg-mint-600 hover:bg-mint-700 text-white font-medium disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5 inline mr-0.5" />
              Approve {selected.size}
            </button>
            <button
              onClick={() => runBulk(true)}
              disabled={bulkRunning !== null}
              className="text-xs px-3 py-1 rounded bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
              title="JEs are also posted; bills/invoices stop at approve (Pay/Receive lives on the detail page)"
            >
              <Send className="w-3.5 h-3.5 inline mr-0.5" />
              Approve &amp; Post
            </button>
            <button
              onClick={() => setSelected(new Set())}
              disabled={bulkRunning !== null}
              className="text-xs text-gray-600 hover:underline disabled:opacity-50"
            >
              Clear
            </button>
            {bulkRunning && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-brand-800">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Processing {bulkRunning.done}/{bulkRunning.total}…
              </span>
            )}
          </div>
        )}

        {bulkSummary && (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800 flex items-start gap-2">
            <Check className="w-3.5 h-3.5 text-emerald-700 mt-0.5 shrink-0" />
            <span className="flex-1">{bulkSummary}</span>
            <button
              onClick={() => setBulkSummary(null)}
              className="text-emerald-500 hover:text-emerald-800"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {err && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {err}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : visibleRows.length === 0 ? (
          <div className="py-12 text-center">
            <CheckSquare className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              Nothing in this queue
              {entityFilter !== "all" ? ` for ${entityFilter}` : ""}.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  {bucket === "pending_approval" && (
                    <th className="pb-2 pr-2 w-7">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleAll}
                        className="cursor-pointer accent-brand-600"
                        aria-label="Select all rows"
                      />
                    </th>
                  )}
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Reference</th>
                  <th className="pb-2 pr-4 font-medium">Entity</th>
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Age</th>
                  <th className="pb-2 pr-4 font-medium">Source</th>
                  <th className="pb-2 pr-4 font-medium">Memo</th>
                  <th className="pb-2 pl-4 font-medium text-right">Total</th>
                  <th className="pb-2 pl-4 font-medium">Submitted by</th>
                  <th className="pb-2 pl-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {visibleRows.map((r) => {
                  const b = kindBadge(r.kind);
                  const days = daysSince(r.date);
                  const ab = ageBadge(days);
                  const rowKey = `${r.kind}-${r.id}`;
                  const rejectKey = `${r.kind}:${r.id}`;
                  const isRejecting = rejectingKey === rejectKey;
                  const approveBusy = busyKey === `${r.kind}:${r.id}:approve`;
                  const rejectBusy  = busyKey === `${r.kind}:${r.id}:reject`;
                  const postBusy    = busyKey === `${r.kind}:${r.id}:post`;
                  const returnBusy  = busyKey === `${r.kind}:${r.id}:return-to-draft`;
                  return (
                    <Fragment key={rowKey}>
                      <tr className={
                        "hover:bg-canvas-50 " +
                        (selected.has(rowKey) ? "bg-brand-50/40" : "")
                      }>
                        {bucket === "pending_approval" && (
                          <td className="py-2 pr-2">
                            <input
                              type="checkbox"
                              checked={selected.has(rowKey)}
                              onChange={() => toggleOne(rowKey)}
                              className="cursor-pointer accent-brand-600"
                              aria-label={`Select ${r.reference}`}
                            />
                          </td>
                        )}
                        <td className="py-2 pr-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-medium ${b.cls}`}>
                            {b.label}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          <Link
                            href={r.detail_href}
                            className="font-mono text-xs text-brand-700 hover:underline"
                          >
                            {r.reference}
                          </Link>
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs text-gray-700">{r.entity_code}</td>
                        <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(r.date)}</td>
                        <td className="py-2 pr-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] tabular-nums ${ab.cls}`}
                            title={`${days} day${days === 1 ? "" : "s"} since document date`}
                          >
                            {ab.label}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-xs text-gray-500">{r.source_label}</td>
                        <td className="py-2 pr-4 text-xs text-gray-600 max-w-xs truncate">{r.memo}</td>
                        <td className="py-2 pl-4 text-xs text-gray-700 text-right font-mono tabular-nums whitespace-nowrap">
                          <span className="text-gray-400">{r.currency}</span> {fmt2(r.total)}
                        </td>
                        <td className="py-2 pl-4 text-xs text-gray-500">{r.submitted_by || "—"}</td>
                        <td className="py-2 pl-4 text-right">
                          <div className="inline-flex gap-1">
                            {bucket === "pending_approval" && !isRejecting && (
                              <>
                                <button
                                  disabled={approveBusy}
                                  onClick={() => act(r, "approve")}
                                  className="text-xs text-mint-700 hover:underline disabled:opacity-50"
                                  title={r.kind === "invoice" ? "Issue (approve)" : "Approve"}
                                >
                                  <Check className="w-3 h-3 inline mr-0.5" />Approve
                                </button>
                                <span className="text-gray-300">·</span>
                                <button
                                  disabled={rejectBusy}
                                  onClick={() => {
                                    setRejectingKey(rejectKey);
                                    setRejectReason("");
                                    setErr(null);
                                  }}
                                  className="text-xs text-red-700 hover:underline disabled:opacity-50"
                                  title="Reject"
                                >
                                  <X className="w-3 h-3 inline mr-0.5" />Reject
                                </button>
                              </>
                            )}
                            {bucket === "approved" && r.kind === "je" && (
                              <button
                                disabled={postBusy}
                                onClick={() => act(r, "post")}
                                className="text-xs text-brand-700 hover:underline disabled:opacity-50"
                                title="Post the approved JE to the ledger"
                              >
                                Post
                              </button>
                            )}
                            {bucket === "approved" && r.kind === "bill" && (
                              <Link
                                href={r.detail_href}
                                className="text-xs text-brand-700 hover:underline"
                                title="Mark paid (DR AP / CR Bank) — needs bank account + date"
                              >
                                Pay →
                              </Link>
                            )}
                            {bucket === "approved" && r.kind === "invoice" && (
                              <Link
                                href={r.detail_href}
                                className="text-xs text-brand-700 hover:underline"
                                title="Record payment (DR Bank / CR AR) — needs bank account + date"
                              >
                                Receive →
                              </Link>
                            )}
                            {bucket === "rejected" && (
                              <button
                                disabled={returnBusy}
                                onClick={() => act(r, "return-to-draft")}
                                className="text-xs text-gray-700 hover:underline disabled:opacity-50"
                              >
                                <RotateCcw className="w-3 h-3 inline mr-0.5" />To draft
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isRejecting && (
                        <tr className="bg-red-50/50">
                          <td
                            colSpan={bucket === "pending_approval" ? 11 : 10}
                            className="py-3 px-4"
                          >
                            <div className="flex flex-col gap-2">
                              <label className="text-xs text-red-800 font-medium">
                                Reject {r.reference} — reason (required)
                              </label>
                              <textarea
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                rows={2}
                                placeholder="Short note for the audit trail, e.g. 'Wrong account — please use 6010 not 6000.'"
                                className="w-full text-xs px-2 py-1.5 rounded border border-red-200 bg-white text-gray-800 focus:outline-none focus:ring-1 focus:ring-red-300"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    setRejectingKey(null);
                                    setRejectReason("");
                                  }
                                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                    void submitReject(r);
                                  }
                                }}
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => void submitReject(r)}
                                  disabled={rejectBusy || !rejectReason.trim()}
                                  className="text-xs px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                                >
                                  Confirm rejection
                                </button>
                                <button
                                  onClick={() => {
                                    setRejectingKey(null);
                                    setRejectReason("");
                                  }}
                                  className="text-xs px-2 py-1 text-gray-600 hover:underline"
                                >
                                  Cancel
                                </button>
                                <span className="text-[10px] text-gray-400 ml-auto">
                                  Esc to cancel · Ctrl+Enter to confirm
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
