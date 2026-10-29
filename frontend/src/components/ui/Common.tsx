import { RefreshCw } from "lucide-react";
export const label = (value: string) => value.replaceAll("_", " ");
export const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export function Badge({ value }: { value: string }) {
  return <span className={`pill ${value}`}>{label(value)}</span>;
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: Error | null;
  retry?: () => void;
}) {
  return error ? (
    <div className="error" role="alert">
      {error.message}
      {retry && (
        <button className="secondary small" onClick={retry}>
          <RefreshCw size={13} /> Retry
        </button>
      )}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div aria-label="Loading" className="skeleton">
      <div />
      <div />
      <div />
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
