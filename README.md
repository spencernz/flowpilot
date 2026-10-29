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

Seed data contains nine fictional customers, six mock analyses and two approved sample tickets. Seeding is repeatable: stable UUIDs prevent duplicates, and existing work is preserved. Seed analyses are always labelled `mock-rules-v1`, even if the active provider is OpenAI.

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
Workflow service ─── Knowledge retrieval ─── Mock / OpenAI analysis service
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


## Company knowledge and retrieval-augmented generation (RAG)

The Knowledge Base extends the existing analysis workflow. It does not create tickets, send messages, or bypass review.

```text
Text / Markdown → overlapping chunks → embeddings → SQLite JSON vectors
                                              ↑
Customer subject + message → query embedding → cosine ranking / threshold
                                              ↓
                              up to 3 relevant source excerpts
                                              ↓
                       analysis model → validated draft with [S1] citations
                                              ↓
                       saved source snapshots → human review → local ticket
```

Open **Knowledge base** in the sidebar to read documents, create a plain-text or Markdown document, edit and automatically re-index its content, regenerate an index, or test retrieval. **Create a sample document** pre-fills a fictional refund policy for review before saving. Markdown is displayed as source text rather than interpreted HTML.

Run `alembic upgrade head` and `python -m app.seed` from `backend/` when updating an existing installation. Seeding adds **Refund Policy**, **Billing Guidelines**, and **Technical Support SLA** using stable IDs and an explicitly labelled mock index. It preserves existing documents, customer requests, analyses, tickets and audits. To use those policies in OpenAI mode, click **Re-index document** on each document. Real indexing sends the document title and content to OpenAI's embeddings API; the API key stays on the backend. The application then embeds the customer request when searching the matching real index.

Document edits generate and validate new embeddings before writing. Content, chunks and model metadata are replaced transactionally; an embedding failure preserves the previous document and index. A content edit invalidates all old embedding spaces for that document. Re-indexing unchanged content replaces only the active model's chunks. Revision checks reject concurrent conflicting writes, and a unique document/model/chunk-index constraint prevents duplicate chunks. Documents store creation and update timestamps.

Each embedding space is identified by provider, model/version, and vector dimensions. Real mode uses the SDK's `embeddings.create` with `text-embedding-3-small` by default and 512 dimensions. It requires an embedding-capable API model **in addition to** access to the text analysis model. Changing `EMBEDDING_MODEL` requires re-indexing. Unsupported models, invalid vectors and unavailable providers return safe errors; they never silently substitute mock vectors or successful empty results.

Retrieval computes cosine similarity in process over matching SQLite vectors, filters by the configured threshold, and takes at most three chunks. With no matching index or no sufficiently relevant result, it returns no company context. If an existing matching index has a provider failure, analysis is marked `failed` through the original workflow. No vector database, external orchestration or new infrastructure is used.

### Retrieval configuration

Add these settings to the root `.env` as needed and restart the backend:

```dotenv
EMBEDDING_MODEL=text-embedding-3-small
RAG_CHUNK_CHARS=1200
RAG_CHUNK_OVERLAP=200
RAG_MIN_SIMILARITY=0.35
RAG_MOCK_MIN_SIMILARITY=0.15
```

Chunks are deterministic overlapping character windows, preserving the source text and Markdown. Overlap must be smaller than the chunk size. Documents are limited to 100,000 characters and 300 chunks; reduce the input or increase chunk size if needed. The embedding provider batches up to 32 chunks per call. Long query input is limited to its first 1,800 characters to bound embedding input size. Character windows are intentionally simple; token-aware and section-aware chunking would be future improvements.

Cosine similarity is a relevance score, **not a probability, confidence estimate, or guarantee of factual accuracy**. Thresholds are configurable heuristics and should be evaluated against representative company questions. A low threshold can retrieve tangential passages; a high threshold can miss useful sources.

### Mock versus real retrieval

`AI_PROVIDER=mock` selects deterministic lexical feature hashing with limited word normalization and 2,048 dimensions. It supports a fully offline demonstration without an API key. Its index identity starts with `mock:`, and the UI labels it **Deterministic mock retrieval**. It is keyword similarity, not real semantic understanding; paraphrases may be missed. Real mode uses OpenAI embeddings and indexes with an `openai:` identity. Mock and real vectors are never compared, even if their dimensions happen to match. Seeding does not spend API credits or automatically create real embeddings.

### Grounding, citations and human review

Analysis keeps all existing fields and adds:

- `retrieved_sources`: immutable snapshots containing the chunk ID, document ID and title, excerpt, revision, similarity and embedding model. These remain readable after the original document is edited or re-indexed.
- `citations`: the identifiers actually referenced inline in the saved suggested response, such as `S1` for `[S1]`.
- `context_status`: `found`, `no_relevant_sources`, `index_unavailable` when documents lack the active provider index, or `not_retrieved` for older analyses.
- `retrieval_mode`: the embedding-space identity used for retrieval.
- `human_verification_required`: true when no source is cited or the model flags incomplete support. This flag never disables mandatory human approval.

Retrieved excerpts are explicitly labelled **untrusted data** in the model input. Instructions require citations for policy claims and prohibit obeying document instructions, inventing policies, deciding eligibility or claiming external actions were performed. The backend rejects citations to non-retrieved identifiers and validates that the declared citation list matches inline references. It appends an explicit human-verification warning when no relevant company context is found. Editing a response recalculates its citation references and rejects unknown identifiers.

**Sources Used** displays saved excerpts, scores and citation identifiers, and distinguishes cited sources from other retrieved candidates. It warns if there is no relevant context or the saved draft is not fully supported. Use **Re-analyse with AI** on an uncompleted request to create a fresh analysis from the current index; save unsaved response edits first. Completed tickets retain their original approved analysis and response.

Citation validation proves that a referenced passage was retrieved, not that every claim is entailed by it. A model may still misread a passage, omit a necessary citation, overstate a policy, or follow malicious text despite instructions. Human edits can also introduce unsupported claims. The warning and mandatory reviewer remain essential. The three seeded policies are fictional demonstration material, not actual business policies or eligibility decisions.

### Knowledge API

```text
GET   /api/v1/knowledge
POST  /api/v1/knowledge
PATCH /api/v1/knowledge/{id}          (edit and automatically re-index)
POST  /api/v1/knowledge/{id}/reindex
GET   /api/v1/knowledge/search?q=subscription%20refund
```

Create/update accepts JSON with `title`, `content`, and `format` (`text` or `markdown`). Search returns source excerpts and scores plus `context_found`, `mode` and `embedding_model`. The document list returns readable content, the active embedding identity, matching chunk counts, and available index identities. The original request, analysis, approval and ticket endpoints keep their contracts, with additive source fields on analyses.

Tests cover overlap and input limits, ingestion, cosine ranking and top-three retrieval, no relevant results, provider isolation, invalid/unavailable embeddings, atomic failed updates, duplicate-free re-indexing, persistent source attribution after edits, fabricated citations, mock operation without a key, the OpenAI embedding/prompt contract, and preservation of human approval and idempotent tickets. Frontend tests verify citation labels, relevance scores, mock labels and unsupported-context warnings alongside the existing approval tests.


To demonstrate a request outside the fictional refund window, open **Refund request — subscription purchased 45 days ago** from Daniel Morgan. It starts unanalysed. After indexing the Refund Policy for the active provider, analyse the message: the draft should cite the 14-day policy and explain that 45 days is outside the standard window. This is a suggested policy interpretation requiring human verification, not an automatic eligibility decision or refund action.
