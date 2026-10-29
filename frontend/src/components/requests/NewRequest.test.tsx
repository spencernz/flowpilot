import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { NewRequest } from "./NewRequest";
import { Inbox } from "../../pages/Inbox";
import { client } from "../../api/client";
import type { CustomerRequest } from "../../types";
vi.mock("../../api/client", () => ({
  client: {
    create: vi.fn(),
    analyse: vi.fn(),
    requests: vi.fn(),
    request: vi.fn(),
  },
}));
const row: CustomerRequest = {
  id: "new-request-id",
  sender_name: "Alex Example",
  sender_email: "alex@example.com",
  subject: "Newly generated request",
  body: "A synthetic message.",
  status: "new",
  created_at: "2026-10-29T10:00:00Z",
  analysis: null,
  ticket: null,
};
function provider(children: React.ReactNode) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
}
function setup() {
  const close = vi.fn(),
    created = vi.fn();
  render(provider(<NewRequest close={close} created={created} />));
  return { close, created, user: userEvent.setup() };
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("generates an editable local preview and creates only after explicit submission", async () => {
  const { user, close, created } = setup();
  expect(screen.getByRole("button", { name: "Create Request" })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("Scenario"), "rag");
  await user.click(screen.getByRole("button", { name: "Generate Request" }));
  expect(screen.getByText(/RAG ·/)).toBeInTheDocument();
  expect(client.create).not.toHaveBeenCalled();
  const subject = screen.getByLabelText("Subject");
  await user.clear(subject);
  await user.type(subject, "Edited refund enquiry");
  const body = screen.getByLabelText("Message body");
  await user.clear(body);
  await user.type(body, "Please verify my refund eligibility.");
  vi.mocked(client.create).mockResolvedValue(row);
  await user.click(screen.getByRole("button", { name: "Create Request" }));
  await waitFor(() => expect(created).toHaveBeenCalledWith(row.id));
  expect(client.create).toHaveBeenCalledWith(
    expect.objectContaining({
      subject: "Edited refund enquiry",
      body: "Please verify my refund eligibility.",
    }),
    expect.anything(),
  );
  expect(close).toHaveBeenCalledOnce();
  expect(client.analyse).not.toHaveBeenCalled();
});
it("regenerates another example without submitting anything", async () => {
  const { user } = setup();
  await user.selectOptions(screen.getByLabelText("Scenario"), "standard");
  await user.click(screen.getByRole("button", { name: "Generate Request" }));
  const previous = (screen.getByLabelText("Subject") as HTMLInputElement).value;
  await user.click(screen.getByRole("button", { name: "Regenerate" }));
  expect(screen.getByLabelText("Subject")).not.toHaveValue(previous);
  expect(client.create).not.toHaveBeenCalled();
});
it("validates edits before calling the API", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Generate Request" }));
  await user.clear(screen.getByLabelText("Email"));
  await user.type(screen.getByLabelText("Email"), "invalid");
  await user.clear(screen.getByLabelText("Message body"));
  await user.click(screen.getByRole("button", { name: "Create Request" }));
  expect(await screen.findByText("Enter a valid email")).toBeInTheDocument();
  expect(screen.getByText("Enter a message")).toBeInTheDocument();
  expect(client.create).not.toHaveBeenCalled();
});
it("preserves edits on API failure and supports retry", async () => {
  const { user, close } = setup();
  await user.click(screen.getByRole("button", { name: "Generate Request" }));
  await user.clear(screen.getByLabelText("Subject"));
  await user.type(screen.getByLabelText("Subject"), "Keep my edited subject");
  vi.mocked(client.create)
    .mockRejectedValueOnce(new Error("Backend unavailable"))
    .mockResolvedValueOnce(row);
  await user.click(screen.getByRole("button", { name: "Create Request" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Backend unavailable",
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByLabelText("Subject")).toHaveValue(
    "Keep my edited subject",
  );
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Create Request" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(client.create).toHaveBeenCalledTimes(2);
});
it("blocks repeated submissions and stays open until backend success", async () => {
  const { user, close } = setup();
  await user.click(screen.getByRole("button", { name: "Generate Request" }));
  let resolve: (value: CustomerRequest) => void = () => {};
  vi.mocked(client.create).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await user.dblClick(screen.getByRole("button", { name: "Create Request" }));
  expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByLabelText("Customer name")).toBeDisabled();
  fireEvent.submit(
    screen.getByRole("button", { name: "Creating…" }).closest("form")!,
  );
  await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
  expect(close).not.toHaveBeenCalled();
  resolve(row);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});
it("Cancel closes without creating a request", async () => {
  const { user, close } = setup();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce();
  expect(client.create).not.toHaveBeenCalled();
});
it("opens from the inbox and selects the newly created request without analysis", async () => {
  const user = userEvent.setup();
  vi.mocked(client.requests).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 8,
  });
  vi.mocked(client.request).mockResolvedValue(row);
  vi.mocked(client.create).mockResolvedValue(row);
  function Route() {
    const location = useLocation();
    return <output data-testid="route">{location.search}</output>;
  }
  render(
    provider(
      <MemoryRouter initialEntries={["/inbox"]}>
        <Inbox />
        <Route />
      </MemoryRouter>,
    ),
  );
  await user.click(screen.getByRole("button", { name: "New request" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Generate Request" }));
  await user.click(screen.getByRole("button", { name: "Create Request" }));
  expect(
    await screen.findByRole("heading", { name: row.subject }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("route")).toHaveTextContent(`request=${row.id}`);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(client.analyse).not.toHaveBeenCalled();
});
