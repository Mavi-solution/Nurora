import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { initialsOf } from "@/lib/format";
import type { AppointmentStatus, InvoiceStatus } from "@/lib/types";

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all " +
  "disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98] whitespace-nowrap";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 shadow-sm hover:shadow-md",
  secondary:
    "bg-card text-body border border-[var(--border-strong)] hover:bg-card-muted",
  ghost: "text-muted hover:text-body hover:bg-card-muted",
  danger:
    "bg-red-600 text-white hover:bg-red-700 shadow-sm",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-7 text-[15px]",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra = "",
) {
  return `${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/* -------------------------------------------------------------------- Card */

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`bg-card border border-hairline rounded-2xl shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-hairline">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="text-[13px] text-muted mt-0.5">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- Badge */

const statusStyles: Record<AppointmentStatus, string> = {
  scheduled:
    "bg-brand-50 text-brand-800 border-brand-200 dark:bg-brand-400/10 dark:text-brand-200 dark:border-brand-400/25",
  in_progress:
    "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25",
  completed:
    "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-400/10 dark:text-slate-300 dark:border-slate-400/25",
  cancelled:
    "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/25",
  no_show:
    "bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/25",
};

const statusLabels: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In session",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${statusStyles[status]}`}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {statusLabels[status]}
    </span>
  );
}

const invoiceStyles: Record<InvoiceStatus, string> = {
  draft:
    "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-400/10 dark:text-slate-300 dark:border-slate-400/25",
  unpaid:
    "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25",
  paid:
    "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25",
  refunded:
    "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/25",
  waived:
    "bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/25",
};

export function InvoiceBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-medium capitalize ${invoiceStyles[status]}`}
    >
      {status}
    </span>
  );
}

export function Pill({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-card-muted border border-hairline px-2.5 py-0.5 text-[12px] text-muted ${className}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Avatar */

export function Avatar({
  name,
  url,
  size = 40,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  if (url) {
    // Remote avatars come from Google/Supabase storage; plain img keeps the
    // component usable inside server and client trees alike.
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover border border-hairline shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className="rounded-full bg-brand-100 text-brand-800 dark:bg-brand-400/15 dark:text-brand-200 grid place-items-center font-semibold shrink-0 select-none"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}

/* ------------------------------------------------------------------ Fields */

export const fieldClass =
  "w-full rounded-xl border border-[var(--border-strong)] bg-card px-3.5 py-2.5 text-sm " +
  "transition-shadow placeholder:text-faint focus:border-brand-500 focus:ring-4 focus:ring-brand-500/12 focus:outline-none";

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="block text-[12px] text-faint mt-1.5">{hint}</span>}
    </label>
  );
}

/* -------------------------------------------------------------- EmptyState */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="text-center py-14 px-6">
      <div className="mx-auto mb-4 size-12 rounded-2xl aurora border border-hairline grid place-items-center text-brand-700 dark:text-brand-200">
        {icon ?? <IconCalendar />}
      </div>
      <h3 className="font-semibold text-[15px]">{title}</h3>
      {description && (
        <p className="text-[13px] text-muted mt-1.5 max-w-sm mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success";
  children: ReactNode;
}) {
  const tones = {
    info: "bg-brand-50 text-brand-900 border-brand-200 dark:bg-brand-400/10 dark:text-brand-100 dark:border-brand-400/25",
    error:
      "bg-red-50 text-red-800 border-red-200 dark:bg-red-500/10 dark:text-red-200 dark:border-red-500/25",
    success:
      "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:border-emerald-500/25",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-[13px] ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="p-5">
      <div className="text-[12px] uppercase tracking-[0.1em] text-faint font-medium">
        {label}
      </div>
      <div className="mt-2 text-2xl font-display font-semibold tabular-nums">
        {value}
      </div>
      {sub && <div className="text-[12px] text-muted mt-1">{sub}</div>}
    </Card>
  );
}

/* ------------------------------------------------------------------- Icons */

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const IconCalendar = () => (
  <svg {...iconProps}>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);
export const IconClock = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const IconWallet = () => (
  <svg {...iconProps}>
    <path d="M3 8a3 3 0 0 1 3-3h11a2 2 0 0 1 2 2v1" />
    <rect x="3" y="7" width="18" height="13" rx="3" />
    <path d="M16 13h2" />
  </svg>
);
export const IconUsers = () => (
  <svg {...iconProps}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0-2-5.2M21 20a5.5 5.5 0 0 0-3.5-5" />
  </svg>
);
export const IconSliders = () => (
  <svg {...iconProps}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="16" cy="18" r="2" />
  </svg>
);
export const IconBell = () => (
  <svg {...iconProps}>
    <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z" />
    <path d="M10.5 18a1.8 1.8 0 0 0 3 0" />
  </svg>
);
export const IconHome = () => (
  <svg {...iconProps}>
    <path d="m4 10 8-6 8 6v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    <path d="M10 21v-6h4v6" />
  </svg>
);
export const IconCheck = () => (
  <svg {...iconProps}>
    <path d="m5 13 4 4L19 7" />
  </svg>
);
export const IconArrowRight = () => (
  <svg {...iconProps} width={16} height={16}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
