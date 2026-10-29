import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { client } from "../../api/client";
import { useRefresh } from "../../hooks/useRefresh";
import { ErrorNotice } from "../ui/Common";
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
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const mutation = useMutation({
    mutationFn: client.create,
    onSuccess: async (data) => {
      await refresh();
      created(data.id);
      close();
    },
  });
  return (
    <div className="modal-backdrop">
      <section
        className="panel modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-title"
      >
        <div className="panel-head">
          <h2 id="new-title">New customer request</h2>
          <button
            className="ghost"
            onClick={close}
            aria-label="Close new request"
          >
            <X size={18} />
          </button>
        </div>
        <form
          className="detail-body"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <p className="subheading">
            Add a synthetic customer message to try the complete workflow.
          </p>
          {(["sender_name", "sender_email", "subject", "body"] as const).map(
            (field) => (
              <div className="form-field" key={field}>
                <label htmlFor={field}>{field.replace("_", " ")}</label>
                {field === "body" ? (
                  <textarea id={field} rows={5} {...form.register(field)} />
                ) : (
                  <input
                    id={field}
                    type={field === "sender_email" ? "email" : "text"}
                    {...form.register(field)}
                  />
                )}
                <span className="field-error">
                  {form.formState.errors[field]?.message}
                </span>
              </div>
            ),
          )}
          <ErrorNotice error={mutation.error} />
          <div className="actions">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button className="primary" disabled={mutation.isPending}>
              {mutation.isPending ? "Creating…" : "Create request"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
