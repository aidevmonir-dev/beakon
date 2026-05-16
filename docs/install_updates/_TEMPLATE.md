# {{Update title — short, plain-English}}

| Field      | Value |
|------------|-------|
| Date       | YYYY-MM-DD |
| Component  | {{e.g. FX, AP, AR, Banking, Reports, Engine, Frontend}} |
| Author     | {{name}} |
| Status     | {{Installed / Pending / Rolled back}} |
| Reversible | {{Yes / Partial / No — and a one-line why}} |

---

## 1. What this is

One short paragraph in plain English. No code, no jargon. A finance
person should be able to read this section alone and know what
changed and who it serves.

## 2. Why we built it

The business / accounting reason. Tie it to the founder working
paper, the architecture document, or a specific Thomas request when
relevant. If this enables a downstream feature, name it.

## 3. What's installed (technical)

What a developer would see in the diff:

- **Models / migrations:** new tables, new columns, migration numbers
- **Services:** new module under `beakon_core/services/...` or
  `beakon_banking/services/...`
- **API:** new endpoints, methods, request / response shapes
- **Management commands:** new `manage.py ...` commands
- **Frontend:** new pages or major components, with route paths
- **Settings / env vars:** anything new in `digits_clone/settings.py`
  or `.env`

## 4. What the admin needs to do

Step-by-step setup, in the order it must run. Use code blocks for
exact commands. Every step should be copy-pasteable.

```bash
# 1. Pull and migrate
git pull
python manage.py migrate

# 2. {{any one-time backfill}}
python manage.py {{...}}

# 3. {{schedule the recurring job, if any}}
```

If a step is platform-specific (Windows Task Scheduler vs Linux cron),
spell out both. The Allina dev box is Windows; production may not be.

## 5. How to use it

Three views of the same feature:

- **UI:** Where in the dashboard. Exact menu path / URL.
- **CLI:** The `manage.py` command, with a sample run + output.
- **API:** Endpoint, method, payload, sample response.

## 6. What runs automatically

Cron jobs, signals, scheduled Celery tasks, post-save hooks. If
nothing runs automatically, write `n/a — manually triggered only.`

## 7. Verifying it works

A concrete check the admin or Thomas can run *after* install. Should
yield a yes/no answer in under a minute. Examples:

- "Click X — the badge should show ≥ 1 row."
- A SQL query / Django shell snippet with expected output.
- An HTTP curl with expected status.

## 8. Rolling back

How to disable or undo, in order of severity:

- **Disable temporarily:** stop the cron, hide the UI button, etc.
- **Remove the data:** queryset to delete (only if safe).
- **Revert the code:** the commit hash to revert (filled in once
  merged).

## 9. Known limits

Edge cases the feature does **not** cover, intentional or not. Write
this for the Thomas of six months from now who is staring at an
unexpected result. One bullet per limit.

## 10. Files touched

Reference list — paste from `git diff --stat HEAD~1`, trimmed to the
files that actually relate to this update (skip generic refactors).

```
beakon_core/services/foo.py             | +120
beakon_core/management/commands/foo.py  |  +40
api/views/beakon.py                     |  +25
frontend/src/app/dashboard/foo/page.tsx | +200
```

## 11. References

- Founder working paper section / page (if it traces to one)
- Architecture document layer (if applicable)
- Linear / Github issue (if any)
- Prior install-update docs that this one builds on
