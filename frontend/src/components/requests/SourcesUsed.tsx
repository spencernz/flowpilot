import { BookOpen, TriangleAlert } from "lucide-react";
import type { Analysis, KnowledgeSource } from "../../types";

export function SourceCard({
  source,
  cited,
}: {
  source: KnowledgeSource;
  cited?: boolean;
}) {
  return (
    <article className="source-card">
      <div className="source-title">
        <span className="source-id">[{source.citation_id}]</span>
        <strong>{source.title}</strong>
        {cited && <span className="pill done">Cited</span>}
      </div>
      <p>{source.excerpt}</p>
      <div className="source-meta">
        Cosine similarity {source.similarity.toFixed(3)} · Revision{" "}
        {source.document_revision}
        <span>
          {source.embedding_model.startsWith("mock:")
            ? "Deterministic mock retrieval"
            : source.embedding_model}
        </span>
      </div>
    </article>
  );
}
export function SourcesUsed({ analysis }: { analysis: Analysis }) {
  const sources = analysis.retrieved_sources || [];
  const noContext = analysis.context_status === "no_relevant_sources";
  return (
    <section className="sources-used" aria-label="Sources Used">
      <div className="section-title">
        <BookOpen size={15} /> Sources Used
      </div>
      {sources.map((source) => (
        <SourceCard
          key={source.chunk_id}
          source={source}
          cited={analysis.citations?.includes(source.citation_id)}
        />
      ))}
      {sources.length > 0 && (
        <p className="source-caption">
          Saved excerpts from the time of analysis. Similarity measures
          relevance, not factual accuracy. Only sources marked Cited are
          referenced in the saved response.
        </p>
      )}
      {!sources.length && (
        <div className="knowledge-warning" role="note">
          <TriangleAlert size={17} />
          <span>
            {analysis.context_status === "index_unavailable"
              ? "Company documents are not indexed for the active embedding provider. Re-index them in Knowledge Base after checking embedding model access. No policy assessment was made."
              : noContext
                ? "No sufficiently relevant company knowledge was found. Human verification is required before confirming policy or eligibility."
                : "This analysis has no retrieved company sources. Re-analyse an uncompleted request to check the knowledge base."}
          </span>
        </div>
      )}
      {sources.length > 0 &&
        (analysis.human_verification_required ||
          !analysis.citations?.length) && (
          <div className="knowledge-warning" role="note">
            <TriangleAlert size={17} />
            <span>
              The response is not fully supported by cited company knowledge.
              Verify unsupported claims before approving.
            </span>
          </div>
        )}
    </section>
  );
}
