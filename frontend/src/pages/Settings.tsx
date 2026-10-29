import { useQuery } from "@tanstack/react-query";
import { LockKeyhole } from "lucide-react";
import { client } from "../api/client";
import { ErrorNotice, Loading, PageHeading } from "../components/ui/Common";
export function Settings() {
  const config = useQuery({ queryKey: ["config"], queryFn: client.config });
  const c = config.data;
  return (
    <>
      <PageHeading
        eyebrow="CONFIGURATION"
        title="Workspace settings"
        description="Connection details and safeguards for this demonstration."
      />
      <section className="panel settings-panel">
        <div className="panel-head">
          <h2>Automation controls</h2>
          <LockKeyhole size={17} />
        </div>
        <div className="detail-body">
          <ErrorNotice
            error={config.error}
            retry={() => void config.refetch()}
          />
          {config.isPending ? (
            <Loading />
          ) : (
            c && (
              <>
                {[
                  [
                    "Human approval",
                    "Mandatory",
                    "Every ticket requires an explicit approval.",
                  ],
                  [
                    "AI provider",
                    c.ai_provider === "mock" ? "Deterministic mock" : "OpenAI",
                    c.ai_provider === "mock"
                      ? "Rule-based sample analysis; no API key needed."
                      : "Customer messages are sent to OpenAI for analysis.",
                  ],
                  [
                    "Model",
                    c.model_name,
                    "Configured through backend environment variables.",
                  ],
                  [
                    "Provider configuration",
                    c.provider_configured ? "Configured" : "API key missing",
                    "Credentials remain exclusively on the backend.",
                  ],
                  [
                    "Database",
                    c.storage,
                    "Requests, analyses, tickets and audit events persist locally.",
                  ],
                ].map(([title, value, description]) => (
                  <div className="setting-row" key={title}>
                    <div>
                      <strong>{title}</strong>
                      <p>{description}</p>
                    </div>
                    <span className="pill category">{value}</span>
                  </div>
                ))}
                <div className="approval-note">
                  <LockKeyhole size={17} />
                  <span>
                    Configuration is read-only. Update the backend .env file and
                    restart to change AI mode.
                  </span>
                </div>
              </>
            )
          )}
        </div>
      </section>
    </>
  );
}
