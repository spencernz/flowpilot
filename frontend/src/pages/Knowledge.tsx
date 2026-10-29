import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BookOpen, FileText, Plus, RefreshCw, Search } from "lucide-react";
import { client } from "../api/client";
import { useRefresh } from "../hooks/useRefresh";
import { SourceCard } from "../components/requests/SourcesUsed";
import {
  PageHeading,
  ErrorNotice,
  Loading,
  date,
} from "../components/ui/Common";
import type { KnowledgeDocument, DocumentInput } from "../types";

const schema = z.object({
  title: z.string().trim().min(1, "Enter a title").max(200),
  content: z.string().trim().min(1, "Enter document content").max(100000),
  format: z.enum(["text", "markdown"]),
});
const sample: DocumentInput = {
  title: "Sample Refund Policy",
  format: "markdown",
  content:
    "# Refund Policy\n\nFictional demonstration policy. Eligible subscriptions can be refunded within 14 days of purchase, subject to verification. A person must verify purchase date and eligibility before confirming a refund.",
};

export function Knowledge() {
  const documents = useQuery({
    queryKey: ["knowledge"],
    queryFn: client.knowledge,
  });
  const refresh = useRefresh();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const form = useForm<DocumentInput>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", content: "", format: "markdown" },
  });
  const document =
    documents.data?.items.find((d) => d.id === selected) ||
    (!creating ? documents.data?.items[0] : undefined);
  const save = useMutation({
    mutationFn: (values: DocumentInput) =>
      creating
        ? client.createDocument(values)
        : client.updateDocument(document!.id, values),
    onSuccess: async (data) => {
      setSelected(data.id);
      setEditing(false);
      setCreating(false);
      setNotice("Document saved and indexed.");
      await refresh();
    },
  });
  const reindex = useMutation({
    mutationFn: (id: string) => client.reindexDocument(id),
    onSuccess: async () => {
      setNotice(
        "Index regenerated. Existing analysis source snapshots are preserved.",
      );
      await refresh();
    },
  });
  const search = useMutation({ mutationFn: client.searchKnowledge });
  function choose(d: KnowledgeDocument) {
    setSelected(d.id);
    setCreating(false);
    setEditing(false);
    setNotice("");
    save.reset();
    reindex.reset();
  }
  function create(values: DocumentInput) {
    form.reset(values);
    setSelected(null);
    setCreating(true);
    setEditing(true);
    setNotice("");
    save.reset();
    reindex.reset();
  }
  const busy = save.isPending || reindex.isPending;
  return (
    <>
      <PageHeading
        eyebrow="COMPANY KNOWLEDGE"
        title="Knowledge base"
        description="Ground suggested responses in company policies, with traceable source excerpts."
      >
        <button
          className="primary"
          onClick={() => create({ title: "", content: "", format: "markdown" })}
        >
          <Plus size={16} />
          New document
        </button>
      </PageHeading>
      <div className="knowledge-mode">
        <BookOpen size={17} />
        <span>
          {documents.data?.mode === "mock"
            ? "Deterministic mock retrieval · lexical matching, no external API calls"
            : "OpenAI semantic retrieval · only matching OpenAI indexes are searched"}
        </span>
      </div>
      <ErrorNotice
        error={documents.error}
        retry={() => void documents.refetch()}
      />
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <div className="knowledge-layout">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Company documents</h2>
              <span className="subheading">
                {documents.data?.items.length ?? "…"} documents
              </span>
            </div>
            <FileText size={18} />
          </div>
          {documents.isPending ? (
            <Loading />
          ) : (
            documents.data?.items.map((d) => (
              <button
                key={d.id}
                className={`request ${document?.id === d.id ? "selected" : ""}`}
                onClick={() => choose(d)}
              >
                <div className="req-subject">{d.title}</div>
                <div className="req-preview">{d.content}</div>
                <div className="req-bottom">
                  <span className={`pill ${d.chunk_count ? "done" : "medium"}`}>
                    {d.chunk_count
                      ? `${d.chunk_count} indexed chunks`
                      : "Re-index needed"}
                  </span>
                  <span className="subheading">Revision {d.revision}</span>
                </div>
              </button>
            ))
          )}
          {documents.data?.items.length === 0 && (
            <div className="empty">
              <BookOpen size={26} />
              <h3>No documents yet</h3>
              <p>Add a company policy to make it available for retrieval.</p>
            </div>
          )}
          <div className="knowledge-sample">
            <button className="secondary small" onClick={() => create(sample)}>
              <Plus size={13} />
              Create a sample document
            </button>
            <p>Sample policies are fictional and for demonstration only.</p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>
              {editing
                ? creating
                  ? "New document"
                  : "Edit and re-index"
                : document?.title || "Document content"}
            </h2>
            {document && !editing && (
              <button
                className="secondary small"
                onClick={() => {
                  form.reset({
                    title: document.title,
                    content: document.content,
                    format: document.format,
                  });
                  setEditing(true);
                  save.reset();
                  setNotice("");
                }}
              >
                Edit document
              </button>
            )}
          </div>
          <div className="detail-body">
            <ErrorNotice error={save.error || reindex.error} />
            {editing ? (
              <form
                onSubmit={form.handleSubmit((values) => save.mutate(values))}
              >
                <div className="form-field">
                  <label htmlFor="kb-title">Title</label>
                  <input id="kb-title" {...form.register("title")} />
                  <span className="field-error">
                    {form.formState.errors.title?.message}
                  </span>
                </div>
                <div className="form-field">
                  <label htmlFor="kb-format">Format</label>
                  <select id="kb-format" {...form.register("format")}>
                    <option value="markdown">Markdown</option>
                    <option value="text">Plain text</option>
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="kb-content">Content</label>
                  <textarea
                    id="kb-content"
                    rows={12}
                    {...form.register("content")}
                  />
                  <span className="field-error">
                    {form.formState.errors.content?.message}
                  </span>
                </div>
                <p className="subheading">
                  Saving chunks and embeds the full document. Provider failures
                  preserve the previous content and index.
                </p>
                <div className="actions">
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(false);
                      setCreating(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button className="primary" disabled={busy}>
                    {save.isPending ? "Indexing…" : "Save & index"}
                  </button>
                </div>
              </form>
            ) : document ? (
              <>
                <div className="document-meta">
                  <span className="pill category">{document.format}</span>
                  <span>Updated {date(document.updated_at)}</span>
                </div>
                <pre className="knowledge-content">{document.content}</pre>
                <div className="index-details">
                  <strong>Active index</strong>
                  <span>{document.active_embedding_model}</span>
                  <span>{document.chunk_count} matching chunks</span>
                  {document.chunk_count === 0 && (
                    <div className="knowledge-warning">
                      This document has no index for the active provider.
                      Re-index it before using it with this AI mode.
                    </div>
                  )}
                </div>
                <div className="actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setNotice("");
                      reindex.mutate(document.id);
                    }}
                  >
                    <RefreshCw
                      size={15}
                      className={reindex.isPending ? "spin" : ""}
                    />
                    {reindex.isPending ? "Re-indexing…" : "Re-index document"}
                  </button>
                </div>
              </>
            ) : (
              <div className="empty">
                Select a document or create a new one.
              </div>
            )}
          </div>
        </section>
      </div>
      <section className="panel knowledge-search">
        <div className="panel-head">
          <div>
            <h2>Test retrieval</h2>
            <div className="subheading">
              Retrieve up to three relevant excerpts. Search does not generate a
              reply or create a ticket.
            </div>
          </div>
          <Search size={18} />
        </div>
        <div className="detail-body">
          <form
            className="knowledge-search-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) search.mutate(query.trim());
            }}
          >
            <input
              className="search"
              aria-label="Search company knowledge"
              placeholder="e.g. Can a customer get a subscription refund after ten days?"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={1800}
            />
            <button
              className="primary"
              disabled={!query.trim() || search.isPending}
            >
              {search.isPending ? "Searching…" : "Search"}
            </button>
          </form>
          <ErrorNotice error={search.error} />
          {search.data && (
            <div className="search-results">
              <div className="subheading">
                {search.data.mode === "mock"
                  ? "Deterministic mock retrieval"
                  : "OpenAI semantic retrieval"}{" "}
                · {search.data.items.length} relevant sections
              </div>
              {search.data.items.map((source) => (
                <SourceCard key={source.chunk_id} source={source} />
              ))}
              {!search.data.context_found && (
                <div className="knowledge-warning">
                  {search.data.context_status === "index_unavailable"
                    ? "Company documents are not indexed for the active embedding provider. Check embedding model access and re-index the documents before searching."
                    : "No sufficiently relevant company context was found. Try another question or index a matching document. A response would require human verification."}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
