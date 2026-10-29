import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Inbox as InboxIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { client } from "../api/client";
import {
  Badge,
  date,
  ErrorNotice,
  Loading,
  PageHeading,
} from "../components/ui/Common";
import { RequestDetail } from "../components/requests/RequestDetail";
import { NewRequest } from "../components/requests/NewRequest";
export function Inbox() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  const query = new URLSearchParams({
    search: debounced,
    page: String(page),
    page_size: "8",
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(category ? { category } : {}),
  }).toString();
  const list = useQuery({
    queryKey: ["requests", query],
    queryFn: () => client.requests(query),
    refetchInterval: 5000,
  });
  const selected = params.get("request") || list.data?.items[0]?.id;
  const detail = useQuery({
    queryKey: ["request", selected],
    queryFn: () => client.request(selected!),
    enabled: !!selected,
    refetchInterval: (q) =>
      q.state.data?.status === "processing" ? 1000 : false,
  });
  return (
    <>
      <PageHeading
        eyebrow="AI OPERATIONS"
        title="Request inbox"
        description="Review customer requests, verify AI suggestions and approve actions."
      >
        <button className="primary" onClick={() => setShowNew(true)}>
          <Plus size={16} />
          New request
        </button>
      </PageHeading>
      <div className="workflow-strip">
        <span>
          <b>01</b> Receive
        </span>
        <i />
        <span>
          <b>02</b> Analyse
        </span>
        <i />
        <span>
          <b>03</b> Review
        </span>
        <i />
        <span>
          <b>04</b> Approve ticket
        </span>
      </div>
      <div className="layout">
        <section className="panel inbox-list">
          <div className="panel-head">
            <div>
              <h2>Customer requests</h2>
              <div className="subheading">
                {list.data?.total ?? "…"} conversations
              </div>
            </div>
            <InboxIcon size={20} className="muted" />
          </div>
          <div className="search-wrap">
            <Search size={17} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search requests…"
              aria-label="Search requests"
            />
          </div>
          <div className="filters">
            {[
              ["", "All"],
              ["needs_review", "To review"],
              ["new", "New"],
              ["completed", "Completed"],
            ].map(([v, title]) => (
              <button
                key={v}
                className={`filter ${status === v ? "active" : ""}`}
                onClick={() => {
                  setStatus(v);
                  setPage(1);
                }}
              >
                {title}
              </button>
            ))}
          </div>
          <div className="select-filters">
            <select
              aria-label="Filter priority"
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All priorities</option>
              {["low", "medium", "high", "urgent"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <select
              aria-label="Filter category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {[
                "billing",
                "technical_support",
                "sales",
                "general",
                "other",
              ].map((v) => (
                <option key={v} value={v}>
                  {v.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <ErrorNotice error={list.error} retry={() => void list.refetch()} />
          {list.isPending ? (
            <Loading />
          ) : list.data?.items.length ? (
            list.data.items.map((r) => (
              <button
                key={r.id}
                className={`request ${selected === r.id ? "selected" : ""}`}
                onClick={() => setParams({ request: r.id })}
              >
                <div className="req-top">
                  <span className="req-name">{r.sender_name}</span>
                  <span className="req-time">{date(r.created_at)}</span>
                </div>
                <div className="req-subject">{r.subject}</div>
                <div className="req-preview">{r.body}</div>
                <div className="req-bottom">
                  {r.analysis && <Badge value={r.analysis.priority} />}
                  <Badge value={r.status} />
                  {r.analysis && <Badge value={r.analysis.category} />}
                </div>
              </button>
            ))
          ) : (
            !list.error && (
              <div className="empty">
                <InboxIcon size={28} />
                <h3>No matching requests</h3>
                <p>Try different filters or add a new request.</p>
              </div>
            )
          )}
          <div className="pagination">
            <button
              className="secondary small"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              className="secondary small"
              disabled={!list.data || page * 8 >= list.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </section>
        <div className="detail-column">
          {detail.isPending && selected ? (
            <Loading />
          ) : detail.error ? (
            <ErrorNotice
              error={detail.error}
              retry={() => void detail.refetch()}
            />
          ) : detail.data ? (
            <RequestDetail key={detail.data.id} request={detail.data} />
          ) : (
            <div className="panel empty">
              <InboxIcon size={30} />
              <h3>Select a request</h3>
              <p>Your analysis and review workspace will appear here.</p>
            </div>
          )}
        </div>
      </div>
      {showNew && (
        <NewRequest
          close={() => setShowNew(false)}
          created={(id) => setParams({ request: id })}
        />
      )}
    </>
  );
}
