import type {
  Analysis,
  CustomerRequest,
  Paginated,
  Ticket,
  Config,
  Stats,
  AuditEvent,
  KnowledgeDocument,
  KnowledgeList,
  KnowledgeSearch,
  DocumentInput,
} from "../types";
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch {
    throw new Error(
      "Cannot reach FlowPilot. Check that the backend is running, then try again.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.error?.message ||
        `Request failed (${response.status}). Please try again.`,
    );
  return data as T;
}
export const client = {
  knowledge: () => api<KnowledgeList>("/knowledge"),
  createDocument: (data: DocumentInput) =>
    api<KnowledgeDocument>("/knowledge", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateDocument: (id: string, data: DocumentInput) =>
    api<KnowledgeDocument>(`/knowledge/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  reindexDocument: (id: string) =>
    api<KnowledgeDocument>(`/knowledge/${id}/reindex`, { method: "POST" }),
  searchKnowledge: (q: string) =>
    api<KnowledgeSearch>(`/knowledge/search?${new URLSearchParams({ q })}`),
  requests: (query: string) =>
    api<Paginated<CustomerRequest>>(`/requests?${query}`),
  request: (id: string) => api<CustomerRequest>(`/requests/${id}`),
  analyse: (id: string) =>
    api<Analysis>(`/requests/${id}/analyse`, { method: "POST" }),
  save: (id: string, suggested_response: string) =>
    api<Analysis>(`/analyses/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ suggested_response }),
    }),
  approve: (id: string, analysis_id: string) =>
    api<Ticket>(`/requests/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ approved: true, analysis_id }),
    }),
  config: () => api<Config>("/config"),
  stats: () => api<Stats>("/dashboard/stats"),
  activity: (page: number) =>
    api<Paginated<AuditEvent>>(`/activity?page=${page}`),
  create: (data: {
    sender_name: string;
    sender_email: string;
    subject: string;
    body: string;
  }) =>
    api<CustomerRequest>("/requests", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
