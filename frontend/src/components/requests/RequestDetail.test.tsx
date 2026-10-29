import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestDetail } from "./RequestDetail";
import { client } from "../../api/client";
import type { CustomerRequest } from "../../types";
vi.mock("../../api/client", () => ({
  client: { save: vi.fn(), approve: vi.fn(), analyse: vi.fn() },
}));
const request: CustomerRequest = {
  id: "request-1",
  sender_name: "Sarah Mitchell",
  sender_email: "sarah@example.com",
  subject: "Invoice discrepancy",
  body: "Please check my invoice.",
  status: "needs_review",
  created_at: "2026-10-29T08:00:00Z",
  ticket: null,
  analysis: {
    id: "analysis-1",
    category: "billing",
    priority: "high",
    summary: "Invoice discrepancy.",
    customer_intent: "Review invoice.",
    extracted_entities: { invoice_number: "INV-2026-1024" },
    suggested_response: "Original suggested response",
    model_name: "mock-rules-v1",
    processing_duration_ms: 12,
  },
};
function setup(row = request) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <RequestDetail request={row} />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("human review and approval", () => {
  it("saves an edited response before explicit approval and waits for backend confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(client.save).mockResolvedValue({
      ...request.analysis!,
      suggested_response: "Reviewed reply",
    });
    let confirm: (ticket: {
      id: string;
      approved_response: string;
      title: string;
      created_at: string;
      status: string;
    }) => void = () => {};
    vi.mocked(client.approve).mockImplementation(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    setup();
    expect(client.approve).not.toHaveBeenCalled();
    const draft = screen.getByLabelText("Suggested response");
    await user.clear(draft);
    await user.type(draft, "Reviewed reply");
    await user.click(
      screen.getByRole("button", { name: /Approve & create ticket/ }),
    );
    await waitFor(() =>
      expect(client.approve).toHaveBeenCalledWith("request-1", "analysis-1"),
    );
    expect(client.save).toHaveBeenCalledWith("analysis-1", "Reviewed reply");
    expect(vi.mocked(client.save).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(client.approve).mock.invocationCallOrder[0],
    );
    expect(
      screen.queryByText("Approval recorded. Local ticket created."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    confirm({
      id: "ticket-1",
      approved_response: "Reviewed reply",
      title: request.subject,
      created_at: request.created_at,
      status: "open",
    });
    expect(
      await screen.findByText("Approval recorded. Local ticket created."),
    ).toBeInTheDocument();
  });
  it("does not approve when saving the reviewed reply fails", async () => {
    const user = userEvent.setup();
    vi.mocked(client.save).mockRejectedValue(new Error("Could not save draft"));
    setup();
    await user.type(screen.getByLabelText("Suggested response"), " changed");
    await user.click(
      screen.getByRole("button", { name: /Approve & create ticket/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save draft",
    );
    expect(client.approve).not.toHaveBeenCalled();
  });
  it("analysis never creates a ticket automatically", async () => {
    const user = userEvent.setup();
    vi.mocked(client.analyse).mockResolvedValue(request.analysis!);
    setup({ ...request, status: "new", analysis: null });
    await user.click(screen.getByRole("button", { name: "Analyse with AI" }));
    expect(
      await screen.findByText("Analysis ready for review."),
    ).toBeInTheDocument();
    expect(client.approve).not.toHaveBeenCalled();
  });
  it("shows one actionable error after an analysis retry fails", async () => {
    const user = userEvent.setup();
    vi.mocked(client.analyse).mockRejectedValue(
      new Error("Analysis failed. Check provider configuration or try again."),
    );
    setup({ ...request, status: "failed", analysis: null });
    await user.click(screen.getByRole("button", { name: "Analyse with AI" }));
    await screen.findByRole("alert");
    expect(screen.getAllByText(/analysis failed/i)).toHaveLength(1);
  });
});
