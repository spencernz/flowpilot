# FlowPilot

FlowPilot is a proof of concept showing how to combine AI with a human-in-the-loop workflow. FlowPilot turns a customer message into validated structured analysis and an editable response. A person reviews the draft and explicitly approves creation of a local support ticket.

The interface follows [the supplied HTML reference](docs/flowpilot-mockup.html), rebuilt as reusable React components. All operational data comes from FastAPI and the database. There is no authentication, outgoing email or external CRM integration.

## Quick start

Prerequisites: Python **3.12+**, Node.js **22.12+** (or 24/26), and optionally [uv](https://docs.astral.sh/uv/).

From the repository root:

```sh
cp .env.example .env
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload --host 127.0.0.1 --port 8020
```

In a second terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open **http://127.0.0.1:5173/inbox**. API documentation: **http://127.0.0.1:8020/docs**.

Alternatively, from `backend/`, use `uv sync --frozen` followed by `uv run alembic upgrade head`, `uv run python -m app.seed`, and `uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8020`.

SQLite is created in the backend working directory. Always run backend commands from `backend/`. The root `.env` file is loaded automatically. `npm run dev` proxies `/api` to port 8020, keeping credentials and provider requests on the backend.

## Request processing workflow

1. Open **Request inbox** and select a new request, such as **Forgotten password**. Alternatively, add a synthetic message using **New request**.
2. Click **Analyse with AI**. The request moves through `processing` to `needs_review`. Classification, priority, entities, intent and response appear. No ticket exists yet.
3. Edit the suggested response. **Save draft** persists the edit independently; **Approve & create ticket** also saves unsaved edits before approval.
4. Approve the request. A local ticket appears with the approved response and a persisted timestamp. Repeat calls return the same ticket.
5. Open **Activity log** to show the received, analysis, response-edit and approval events. The simple overview reflects stored data.

Seed data contains eight fictional customers, six mock analyses and two approved sample tickets. Seeding is repeatable: stable UUIDs prevent duplicates, and existing work is preserved. Seed analyses are always labelled `mock-rules-v1`, even if the active provider is OpenAI.

## OpenAI and mock modes

Default configuration works without an API key or paid service:

```dotenv
AI_PROVIDER=mock
```

To use real OpenAI analysis, set these values in the root `.env` and restart the backend:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your-own-key
OPENAI_MODEL=gpt-4.1-mini
AI_TIMEOUT_SECONDS=30
```

Use an available model that supports Structured Outputs. `OpenAIAnalysisService` uses the SDK's `responses.parse(..., text_format=AnalysisOutput)` mechanism, following the [official structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs). It sends only the customer name, subject and message, disables response storage (`store=False`), uses a bounded timeout, and does not retry paid calls automatically. The SDK parses the result into Pydantic and the workflow validates it again before persistence. Refusals, malformed output, timeouts, rate limits and other provider failures leave a retryable `failed` request and a safe audit event.

Mock mode is an explicit deterministic alternative; OpenAI failures are **not silently replaced** with fabricated successful analyses. Switch to `AI_PROVIDER=mock` and restart for offline use. The mock uses simple keyword rules and only extracts invoice and amount fields; it is not a language model.

Entities use a fixed Pydantic object with nullable fields so OpenAI's strict JSON Schema disallows additional properties. Missing facts are `null`. Confidence remains `null`: the application does not present an LLM self-rating as a calibrated probability.

Never place an API key in frontend variables or commit `.env`. `/config` exposes only provider mode, model, configuration presence, storage type and mandatory approval status.

## Architecture

```text
React + TypeScript + Vite
        │ /api/v1 (Vite proxy)
        ▼
FastAPI routes + input validation
        │
Workflow service ─── Mock / OpenAI analysis service
        │                  │
SQLAlchemy 2        Pydantic structured output
        │
SQLite / PostgreSQL (Alembic migrations)
```

Frontend: React Router, TanStack Query, React Hook Form, Zod, Lucide and Tailwind CSS with reference-derived component CSS. Backend: Python, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, OpenAI SDK and Pytest. Dashboard charts and advanced configuration are deferred to keep the MVP focused.

- `backend/app/api`: REST routes and safe record serialization.
- `backend/app/services`: workflow transitions and analysis provider abstraction.
- `backend/app/repositories`: shared latest-analysis and ticket lookups.
- `backend/app/models`, `schemas`, `db`, `core`: persistence, validation and environment configuration.
- `frontend/src/components/requests`: reusable detail/review and request creation components.
- `frontend/src/pages`: inbox, simple overview, audit log and read-only configuration.

The database owns workflow state. Analysis claims a request with an atomic conditional update and commits `processing` before calling a provider. Concurrent analysis receives HTTP 409. A processing lease older than five minutes can be retried after a worker crash. Approval and response edits serialize through an update of the same request row. Approval checks the latest analysis, requires `approved: true`, persists the ticket and audit event in one transaction, and enforces a unique `support_tickets.request_id`. Approved responses cannot be changed through the editing endpoint.

UTC timestamps are stored by the backend, serialized with an explicit offset, and shown in browser-local time. Audit details contain metadata, not original messages, draft bodies or credentials. Customer text is untrusted input; provider instructions prohibit obeying embedded instructions or claiming that external actions were performed. No tools or external actions are available to the model.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./flowpilot.db` | SQLAlchemy connection URL |
| `AI_PROVIDER` | `mock` | `mock` or `openai` |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Structured-output-capable model |
| `OPENAI_API_KEY` | empty | Backend-only API credential |
| `AI_TIMEOUT_SECONDS` | `30` | Provider timeout, 1–120 seconds |
| `CORS_ORIGINS` | local port 5173 | Comma-separated allowed origins |

For PostgreSQL, set `DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/flowpilot` and run `alembic upgrade head` against an empty database. The driver is included. PostgreSQL is a configuration path; the automated suite exercises SQLite.

## API examples

```sh
curl http://127.0.0.1:8020/api/v1/health
curl 'http://127.0.0.1:8020/api/v1/requests?search=invoice&status=needs_review&priority=high&page=1&page_size=20'
curl -X POST http://127.0.0.1:8020/api/v1/requests \
  -H 'Content-Type: application/json' \
  -d '{"sender_name":"Alex Demo","sender_email":"alex@example.com","subject":"Pricing enquiry","body":"What does a five-seat plan cost?"}'
```

Replace `REQUEST_ID` and `ANALYSIS_ID` with IDs returned by the API:

```sh
curl -X POST http://127.0.0.1:8020/api/v1/requests/REQUEST_ID/analyse
curl -X PATCH http://127.0.0.1:8020/api/v1/analyses/ANALYSIS_ID \
  -H 'Content-Type: application/json' \
  -d '{"suggested_response":"Hi Alex, our sales team will confirm available pricing."}'
curl -X POST http://127.0.0.1:8020/api/v1/requests/REQUEST_ID/approve \
  -H 'Content-Type: application/json' \
  -d '{"approved":true,"analysis_id":"ANALYSIS_ID"}'
```

Other endpoints: `GET /requests/{id}`, `GET /activity?page=1`, `GET /dashboard/stats`, `GET /config`. Errors consistently use `{"error":{"code":"...","message":"..."}}`; validation adds field information. Creation returns 201, missing resources 404, conflicting transitions 409, invalid input 422, provider failures 502.

## Checks

```sh
cd backend
source .venv/bin/activate
pytest -q
alembic check

cd ../frontend
npm test
npm run build
npm audit
```

For backend formatting and linting, `uv sync --frozen` installs the development dependency; run `uv run ruff check app tests` and `uv run ruff format --check app tests alembic`. Frontend formatting is checked with `npm run format:check`.

Backend coverage includes creation/validation, strict output schema, mock analysis, malformed/provider failures, rejected or stale approval, edits, concurrent duplicate prevention, audit events, dashboard values, processing lease recovery, seed idempotence, and the OpenAI SDK call contract. Tests use disposable SQLite databases and do not consume OpenAI credits. Frontend tests cover saving an edited response before approval, awaiting backend confirmation, failure handling, and analysis never automatically approving. A live OpenAI call requires your own configured key and is not part of the offline suite.

An optional GitHub Actions workflow template is provided at `docs/github-actions-checks.yml`. To enable CI, copy it to `.github/workflows/checks.yml` using GitHub credentials with workflow permission.

## Limitations and next steps

This is a local proof of concept, not production-ready. It intentionally omits authentication, tenancy, real inboxes, outgoing emails, external CRMs, deployment infrastructure, background workers, charts and advanced settings. Keep it bound to loopback. Anyone with access to the API can act as the demo reviewer; the mandatory approval flag is a workflow gate, not an authenticated identity check.

Synchronous analysis occupies a request worker until completion. A crash can leave processing visible for up to the five-minute lease. The SDK's transport timeout is bounded per operation rather than a durable job deadline. Requests and audit entries are retained locally without a retention policy. Search uses SQL LIKE, sufficient for demo scale. The basic overview reads the stored dataset rather than implementing analytics infrastructure.

Next steps would be authenticated reviewer identity, access control and tenancy, retention/redaction policies, provider evaluation and prompt versioning, PostgreSQL integration tests, durable job processing, and an independently approved CRM integration.
