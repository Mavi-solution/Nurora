export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse" aria-label="Loading" role="status">
      <div className="h-9 w-48 rounded-xl bg-card-muted" />
      <div className="h-28 rounded-2xl bg-card-muted" />
      <div className="h-40 rounded-2xl bg-card-muted" />
      <div className="h-40 rounded-2xl bg-card-muted" />
    </div>
  );
}
