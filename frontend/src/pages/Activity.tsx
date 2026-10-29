import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Activity as ActivityIcon } from "lucide-react";
import { client } from "../api/client";
import {
  date,
  ErrorNotice,
  label,
  Loading,
  PageHeading,
} from "../components/ui/Common";
export function Activity() {
  const [page, setPage] = useState(1);
  const events = useQuery({
    queryKey: ["activity", page],
    queryFn: () => client.activity(page),
  });
  return (
    <>
      <PageHeading
        eyebrow="AUDIT TRAIL"
        title="Activity log"
        description="A transparent record of analysis, response edits and human approvals."
      />
      <section className="panel">
        <div className="panel-head">
          <h2>Recent events</h2>
          <span className="subheading">
            {events.data?.total ?? "…"} recorded events
          </span>
        </div>
        <ErrorNotice error={events.error} retry={() => void events.refetch()} />
        {events.isPending ? (
          <Loading />
        ) : (
          events.data?.items.map((e) => (
            <div key={e.id} className="activity">
              <div className="activity-icon">
                <ActivityIcon size={17} />
              </div>
              <div className="grow">
                <strong>{label(e.event_type)}</strong>
                <div className="subheading">
                  {e.request_id ? (
                    <Link to={`/inbox?request=${e.request_id}`}>
                      {e.request_subject || e.request_id}
                    </Link>
                  ) : (
                    "Workspace"
                  )}
                </div>
              </div>
              <small>{date(e.created_at)}</small>
            </div>
          ))
        )}
        {events.data?.total === 0 && (
          <div className="empty">
            No activity yet. Create a request to get started.
          </div>
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
            disabled={!events.data || page * 25 >= events.data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </section>
    </>
  );
}
