import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCheck, Clock3, Inbox, Sparkles } from "lucide-react";
import { client } from "../api/client";
import {
  Badge,
  date,
  ErrorNotice,
  Loading,
  PageHeading,
} from "../components/ui/Common";
export function Overview() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: client.stats });
  const s = stats.data;
  return (
    <>
      <PageHeading
        eyebrow={new Date()
          .toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })
          .toUpperCase()}
        title="Your workflow, under control."
        description="AI handles the first pass. Your team makes the final call."
      >
        <Link className="primary" to="/inbox">
          Open request inbox <ArrowRight size={16} />
        </Link>
      </PageHeading>
      <ErrorNotice error={stats.error} retry={() => void stats.refetch()} />
      {stats.isPending ? (
        <Loading />
      ) : (
        s && (
          <>
            <div className="grid-stats">
              {[
                {
                  title: "Requests processed",
                  value: s.processed_requests,
                  sub: `${s.total_requests} total requests received`,
                  icon: Sparkles,
                },
                {
                  title: "Awaiting review",
                  value: s.needs_review,
                  sub: "Human approval required",
                  icon: Inbox,
                },
                {
                  title: "Completed requests",
                  value: s.completed_requests,
                  sub: "Local support tickets created",
                  icon: CheckCheck,
                },
                {
                  title: "Average processing time",
                  value:
                    s.average_processing_ms === null
                      ? "—"
                      : s.average_processing_ms < 1000
                        ? `${s.average_processing_ms} ms`
                        : `${(s.average_processing_ms / 1000).toFixed(2)}s`,
                  sub: "Completed analysis runs",
                  icon: Clock3,
                },
              ].map(({ title, value, sub, icon: Icon }) => (
                <div className="stat" key={title}>
                  <div className="top">
                    {title}
                    <Icon size={19} />
                  </div>
                  <div className="num">{value}</div>
                  <div className="sub">{sub}</div>
                </div>
              ))}
            </div>
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Recent requests</h2>
                  <div className="subheading">
                    Live data from your workspace
                  </div>
                </div>
                <Link to="/inbox" className="secondary small">
                  View all <ArrowRight size={13} />
                </Link>
              </div>
              {s.recent_requests.length ? (
                s.recent_requests.map((r) => (
                  <Link
                    className="recent-row"
                    key={r.id}
                    to={`/inbox?request=${r.id}`}
                  >
                    <div className="sender-avatar">
                      {r.sender_name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </div>
                    <div className="recent-subject">
                      <strong>{r.subject}</strong>
                      <small>
                        {r.sender_name} · {date(r.created_at)}
                      </small>
                    </div>
                    <Badge value={r.status} />
                    <ArrowRight size={16} />
                  </Link>
                ))
              ) : (
                <div className="empty">
                  No requests yet. Add one in the inbox.
                </div>
              )}
            </section>
            <div className="demo-banner">
              <span className="sparkle">
                <Sparkles size={20} />
              </span>
              <div>
                <strong>A complete workflow. A person in control.</strong>
                <p>
                  Receive a request, generate a structured analysis, refine the
                  response and approve a local ticket.
                </p>
              </div>
              <Link to="/inbox">
                <ArrowRight size={20} />
              </Link>
            </div>
          </>
        )
      )}
    </>
  );
}
