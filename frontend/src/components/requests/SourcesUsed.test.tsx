import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SourcesUsed } from "./SourcesUsed";
import type { Analysis } from "../../types";
const analysis: Analysis = {
  id: "a",
  category: "billing",
  priority: "medium",
  summary: "Refund enquiry",
  customer_intent: "Verify eligibility",
  extracted_entities: {},
  suggested_response: "Verify eligibility [S1]",
  model_name: "mock-rules-v1",
  processing_duration_ms: 1,
  citations: ["S1"],
  human_verification_required: false,
  context_status: "found",
  retrieved_sources: [
    {
      citation_id: "S1",
      chunk_id: "chunk-1",
      document_id: "doc-1",
      title: "Refund Policy",
      excerpt: "Refunds require verification within 14 days.",
      similarity: 0.72,
      document_revision: 1,
      embedding_model: "mock:lexical-hash-v1:2048",
    },
  ],
};
afterEach(cleanup);
it("shows source snapshots, citation identifiers and clearly labelled mock relevance", () => {
  render(<SourcesUsed analysis={analysis} />);
  expect(screen.getByText("Refund Policy")).toBeInTheDocument();
  expect(screen.getByText("[S1]")).toBeInTheDocument();
  expect(screen.getByText("Cited")).toBeInTheDocument();
  expect(screen.getByText(/Cosine similarity 0.720/)).toBeInTheDocument();
  expect(screen.getByText("Deterministic mock retrieval")).toBeInTheDocument();
});
it("warns when no relevant company knowledge was found", () => {
  render(
    <SourcesUsed
      analysis={{
        ...analysis,
        retrieved_sources: [],
        citations: [],
        context_status: "no_relevant_sources",
        human_verification_required: true,
      }}
    />,
  );
  expect(screen.getByRole("note")).toHaveTextContent(
    "No sufficiently relevant company knowledge was found",
  );
  expect(screen.getByRole("note")).toHaveTextContent(
    "Human verification is required",
  );
});
it("warns when retrieved sources are not cited in the saved response", () => {
  render(<SourcesUsed analysis={{ ...analysis, citations: [] }} />);
  expect(screen.queryByText("Cited")).not.toBeInTheDocument();
  expect(screen.getByRole("note")).toHaveTextContent("not fully supported");
});

it("explains a missing provider index without implying an irrelevant customer request", () => {
  render(
    <SourcesUsed
      analysis={{
        ...analysis,
        retrieved_sources: [],
        citations: [],
        context_status: "index_unavailable",
      }}
    />,
  );
  expect(screen.getByRole("note")).toHaveTextContent(
    "not indexed for the active embedding provider",
  );
  expect(screen.getByRole("note")).toHaveTextContent(
    "No policy assessment was made",
  );
});
