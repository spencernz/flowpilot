import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Dices, RefreshCw, X } from "lucide-react";
import { client } from "../../api/client";
import { useRefresh } from "../../hooks/useRefresh";
import { ErrorNotice } from "../ui/Common";
import {
  generateRequest,
  type GeneratedRequest,
  type Scenario,
} from "./requestGenerator";
const schema = z.object({
  sender_name: z.string().trim().min(1, "Enter a name").max(120),
  sender_email: z.email("Enter a valid email").max(254),
  subject: z.string().trim().min(1, "Enter a subject").max(240),
  body: z.string().trim().min(1, "Enter a message").max(20000),
});
type Values = z.infer<typeof schema>;
export function NewRequest({
  close,
  created,
}: {
  close: () => void;
  created: (id: string) => void;
}) {
  const refresh = useRefresh();
  const [scenario, setScenario] = useState<Scenario>("random");
  const [generated, setGenerated] = useState<GeneratedRequest | null>(null);
  const submitting = useRef(false);
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const mutation = useMutation({
    mutationFn: client.create,
    onSuccess: async (data) => {
      await refresh();
      created(data.id);
      close();
    },
  });
  const busy = mutation.isPending || form.formState.isSubmitting;
  function generate() {
    if (submitting.current) return;
    const example = generateRequest(scenario, generated?.templateId);
    setGenerated(example);
    form.reset(example.preview);
    mutation.reset();
  }
  const submit = form.handleSubmit(async (values) => {
    if (submitting.current || !generated) return;
    submitting.current = true;
    try {
      await mutation.mutateAsync(values);
    } catch {
      /* The mutation error is displayed; keep the editable preview open. */
    } finally {
      submitting.current = false;
    }
  });
  return (
    <div className="modal-backdrop">
      <section
        className="panel modal request-generator-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy && !submitting.current) close();
        }}
      >
        <div className="panel-head">
          <h2 id="new-title">New customer request</h2>
          <button
            className="ghost"
            onClick={close}
            disabled={busy}
            aria-label="Close new request"
          >
            <X size={18} />
          </button>
        </div>
        <div className="generator-controls">
          <p className="subheading">
            Generate a fictional customer request locally, then review and edit
            it before adding it to the inbox.
          </p>
          <label htmlFor="scenario">Scenario</label>
          <div className="generator-row">
            <select
              id="scenario"
              autoFocus
              value={scenario}
              disabled={busy}
              onChange={(e) => setScenario(e.target.value as Scenario)}
            >
              <option value="random">Random</option>
              <option value="standard">Standard</option>
              <option value="rag">RAG</option>
            </select>
            <button className="secondary" onClick={generate} disabled={busy}>
              <Dices size={16} />
              Generate Request
            </button>
          </div>
          <p className="generator-hint">
            {scenario === "rag"
              ? "Policy questions based on the seeded Refund Policy, Billing Guidelines and Technical Support SLA."
              : scenario === "standard"
                ? "Everyday billing, login, sales and technical support requests."
                : "Randomly chooses between Standard and RAG scenarios."}
          </p>
        </div>
        <form
          className="detail-body generator-preview"
          noValidate
          onSubmit={submit}
        >
          {generated ? (
            <>
              <div className="preview-heading">
                <div>
                  <strong>Editable preview</strong>
                  <div className="subheading">
                    {generated.scenario === "rag" ? "RAG" : "Standard"} ·{" "}
                    {generated.label}
                  </div>
                </div>
                <button
                  type="button"
                  className="secondary small"
                  onClick={generate}
                  disabled={busy}
                >
                  <RefreshCw size={13} />
                  Regenerate
                </button>
              </div>
              <fieldset disabled={busy} className="request-preview-fields">
                {(
                  ["sender_name", "sender_email", "subject", "body"] as const
                ).map((field) => (
                  <div className="form-field" key={field}>
                    <label htmlFor={field}>
                      {field === "sender_name"
                        ? "Customer name"
                        : field === "sender_email"
                          ? "Email"
                          : field === "body"
                            ? "Message body"
                            : "Subject"}
                    </label>
                    {field === "body" ? (
                      <textarea
                        id={field}
                        rows={7}
                        {...form.register(field)}
                        aria-invalid={!!form.formState.errors[field]}
                        aria-describedby={`${field}-error`}
                      />
                    ) : (
                      <input
                        id={field}
                        type={field === "sender_email" ? "email" : "text"}
                        {...form.register(field)}
                        aria-invalid={!!form.formState.errors[field]}
                        aria-describedby={`${field}-error`}
                      />
                    )}
                    <span className="field-error" id={`${field}-error`}>
                      {form.formState.errors[field]?.message}
                    </span>
                  </div>
                ))}
              </fieldset>
              <p className="generator-hint">
                Creating adds a new request only. You trigger AI analysis
                separately from the inbox.
              </p>
            </>
          ) : (
            <div className="generator-empty">
              <Dices size={25} />
              <p>
                Select a scenario and click Generate Request to prepare an
                editable preview.
              </p>
            </div>
          )}
          <ErrorNotice error={mutation.error} />
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={close}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!generated || busy}
            >
              {busy ? "Creating…" : "Create Request"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
