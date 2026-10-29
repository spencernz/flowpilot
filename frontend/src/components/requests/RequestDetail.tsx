import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Check,
  CheckCheck,
  Clock3,
  LoaderCircle,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { client } from "../../api/client";
import type { CustomerRequest } from "../../types";
import { Badge, date, ErrorNotice, label } from "../ui/Common";
import { useRefresh } from "../../hooks/useRefresh";
export function RequestDetail({
  request,
  onSaved,
}: {
  request: CustomerRequest;
  onSaved?: () => void;
}) {
  const refresh = useRefresh();
  const [draft, setDraft] = useState(
    request.analysis?.suggested_response || "",
  );
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setDraft(request.analysis?.suggested_response || "");
    setNotice("");
  }, [request.id, request.analysis?.id, request.analysis?.suggested_response]);
  const analysis = request.analysis;
  const finished = request.status === "completed";
  const work = useMutation({
    mutationFn: async (action: "analyse" | "save" | "approve") => {
      setNotice("");
      if (action === "analyse") {
        await client.analyse(request.id);
        return "Analysis ready for review.";
      }
      if (!analysis || !draft.trim())
        throw new Error("Add a suggested response before continuing.");
      if (draft.trim() !== analysis.suggested_response)
        await client.save(analysis.id, draft.trim());
      if (action === "approve") {
        await client.approve(request.id, analysis.id);
        return "Approval recorded. Local ticket created.";
      }
      return "Suggested response saved.";
    },
    onSuccess: async (message) => {
      setNotice(message);
      await refresh();
      onSaved?.();
    },
    onError: () => {
      void refresh();
    },
  });
  const busy = work.isPending || request.status === "processing";
  const dirty = draft.trim() !== analysis?.suggested_response;
  return (
    <section className="panel detail" aria-label="Selected request">
      <div className="detail-head">
        <div className="req-top">
          <Badge value={request.status} />
          <span className="subheading">{date(request.created_at)}</span>
        </div>
        <h2>{request.subject}</h2>
        <div className="detail-meta">
          From <strong>{request.sender_name}</strong> &lt;{request.sender_email}
          &gt;
        </div>
      </div>
      <div className="detail-body">
        <div className="section-title first">Original message</div>
        <div className="message">{request.body}</div>
        <div className="ai-title">
          <div className="ai-label">
            <span className="sparkle">
              <Sparkles size={17} />
            </span>{" "}
            AI ASSISTANT
          </div>
          <span className="subheading">
            {analysis?.model_name.startsWith("mock")
              ? "DETERMINISTIC MOCK"
              : analysis
                ? analysis.model_name
                : "Ready to analyse"}
          </span>
        </div>
        <ErrorNotice
          error={
            work.error ||
            (!busy && request.status === "failed"
              ? new Error(
                  request.analysis_error ||
                    "The last analysis failed. Check the provider settings and retry.",
                )
              : null)
          }
        />
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {busy && (
          <div className="processing" role="status">
            <LoaderCircle size={18} className="spin" /> Analysing request… This
            can take up to a minute.
          </div>
        )}
        {analysis && (
          <>
            <div className="analysis">
              <div className="facts">
                <div>
                  <label>Classification</label>
                  <Badge value={analysis.category} />
                </div>
                <div>
                  <label>Priority</label>
                  <Badge value={analysis.priority} />
                </div>
                {Object.entries(analysis.extracted_entities)
                  .filter(([, v]) => v !== null)
                  .map(([key, value]) => (
                    <div key={key}>
                      <label>{label(key)}</label>
                      <strong>{String(value)}</strong>
                    </div>
                  ))}
              </div>
              <p className="summary">{analysis.summary}</p>
              <p className="intent">
                <strong>Customer intent</strong>
                <br />
                {analysis.customer_intent}
              </p>
              <div className="subheading">
                {analysis.processing_duration_ms} ms · Structured output
                validated
              </div>
            </div>
            <div className="section-title">
              <label htmlFor="draft">Suggested response</label>
              <span> · review and edit before approval</span>
            </div>
            <textarea
              id="draft"
              className="draft"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              readOnly={finished}
              disabled={busy || request.status !== "needs_review"}
              maxLength={10000}
              rows={8}
            />
            {!draft.trim() && (
              <p className="field-error">A response is required.</p>
            )}
          </>
        )}
        {!finished && (
          <div className="actions">
            {!analysis || request.status === "failed" ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => work.mutate("analyse")}
              >
                <Sparkles size={16} />
                {busy ? "Analysing…" : "Analyse with AI"}
              </button>
            ) : (
              request.status === "needs_review" && (
                <>
                  <button
                    className="secondary"
                    disabled={busy || !dirty || !draft.trim()}
                    onClick={() => work.mutate("save")}
                  >
                    <Save size={15} />
                    Save draft
                  </button>
                  <button
                    className="primary"
                    disabled={busy || !draft.trim()}
                    onClick={() => work.mutate("approve")}
                  >
                    <Check size={16} />
                    {busy ? "Saving…" : "Approve & create ticket"}
                  </button>
                </>
              )
            )}
          </div>
        )}
        {request.ticket ? (
          <div className="ticket-success">
            <CheckCheck size={21} />
            <div>
              <strong>
                Ticket created · FP-
                {request.ticket.id.slice(0, 8).toUpperCase()}
              </strong>
              <p>
                {date(request.ticket.created_at)} · Open · Approval recorded
              </p>
              <small>
                Your approved response is stored with this ticket. No email has
                been sent.
              </small>
            </div>
          </div>
        ) : (
          <div className="approval-note">
            <ShieldCheck size={17} />
            <span>
              Human approval required. Analysis creates a draft; your approval
              creates a local ticket.
            </span>
          </div>
        )}
        <div className="detail-foot">
          <Clock3 size={13} /> Stored in the workspace database
        </div>
      </div>
    </section>
  );
}
