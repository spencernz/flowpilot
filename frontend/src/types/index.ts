export type Status =
  "new" | "processing" | "needs_review" | "completed" | "failed";
export type Category =
  "billing" | "technical_support" | "sales" | "general" | "other";
export type Priority = "low" | "medium" | "high" | "urgent";
export interface KnowledgeSource {
  citation_id: string;
  chunk_id: string;
  document_id: string;
  title: string;
  excerpt: string;
  similarity: number;
  document_revision: number;
  embedding_model: string;
}
export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  format: "text" | "markdown";
  revision: number;
  created_at: string;
  updated_at: string;
  chunk_count: number;
  indexed_models: string[];
  active_embedding_model: string;
}
export interface DocumentInput {
  title: string;
  content: string;
  format: "text" | "markdown";
}
export interface KnowledgeList {
  items: KnowledgeDocument[];
  mode: string;
  embedding_model: string;
}
export interface KnowledgeSearch {
  items: KnowledgeSource[];
  context_found: boolean;
  context_status?: "found" | "no_relevant_sources" | "index_unavailable";
  mode: string;
  embedding_model: string;
}
export interface Analysis {
  retrieved_sources?: KnowledgeSource[];
  citations?: string[];
  context_status?:
    "found" | "no_relevant_sources" | "not_retrieved" | "index_unavailable";
  retrieval_mode?: string | null;
  human_verification_required?: boolean;
  id: string;
  category: Category;
  priority: Priority;
  summary: string;
  customer_intent: string;
  extracted_entities: Record<string, string | number | null>;
  suggested_response: string;
  model_name: string;
  processing_duration_ms: number;
}
export interface Ticket {
  id: string;
  approved_response: string;
  title: string;
  created_at: string;
  status: string;
}
export interface CustomerRequest {
  analysis_error?: string | null;
  id: string;
  sender_name: string;
  sender_email: string;
  subject: string;
  body: string;
  status: Status;
  created_at: string;
  analysis: Analysis | null;
  ticket: Ticket | null;
}
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
export interface Config {
  ai_provider: string;
  model_name: string;
  human_approval_required: boolean;
  provider_configured: boolean;
  storage: string;
  timeout_seconds: number;
}
export interface AuditEvent {
  id: string;
  request_id: string | null;
  request_subject: string | null;
  event_type: string;
  created_at: string;
}
export interface Stats {
  total_requests: number;
  processed_requests: number;
  needs_review: number;
  completed_requests: number;
  average_processing_ms: number | null;
  recent_requests: CustomerRequest[];
}
