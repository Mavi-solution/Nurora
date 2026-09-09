"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "./ui";
import { ThemeToggle } from "./theme-toggle";
import { NotificationBell } from "./notification-bell";
import type { Profile } from "@/lib/types";

type NavItem = { href: string; label: string; icon: React.ReactNode };

const icon = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function AppNav({
  profile,
  unreadCount,
}: {
  profile: Profile;
  unreadCount: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Any navigation closes the mobile drawer.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const staff = profile.role === "counsellor" || profile.role === "admin";

  const items: NavItem[] = staff
    ? [
        { href: "/schedule", label: "Schedule", icon: <CalendarIcon /> },
        { href: "/clients", label: "Clients", icon: <UsersIcon /> },
        { href: "/availability", label: "Availability", icon: <SlidersIcon /> },
        { href: "/payments", label: "Payments", icon: <WalletIcon /> },
        { href: "/timesheet", label: "Timesheet", icon: <ClockIcon /> },
        { href: "/team", label: "Team", icon: <ChatIcon /> },
      ]
    : [
        { href: "/my", label: "My sessions", icon: <CalendarIcon /> },
        { href: "/my/book", label: "Book a session", icon: <PlusIcon /> },
      ];

  return (
    <>
      {/* -------------------------------------------------- top bar */}
      <header className="sticky top-0 z-40 h-14 flex items-center gap-3 px-4 lg:px-6 border-b border-hairline bg-card/85 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="lg:hidden size-9 -ml-1.5 grid place-items-center rounded-full text-muted hover:text-body hover:bg-card-muted transition-colors"
          aria-label="Open navigation"
        >
          <svg {...icon} width={20} height={20}>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <Link
          href={staff ? "/schedule" : "/my"}
          className="font-display text-lg font-semibold tracking-tight lg:hidden"
        >
          Nurora
        </Link>

        <div className="flex-1" />

        <NotificationBell initialCount={unreadCount} />
        <ThemeToggle />

        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-full pl-1 pr-1 lg:pr-3 py-1 hover:bg-card-muted transition-colors"
        >
          <Avatar name={profile.full_name || "You"} url={profile.avatar_url} size={28} />
          <span className="hidden lg:block text-[13px] font-medium max-w-32 truncate">
            {profile.full_name || "Set your name"}
          </span>
        </Link>
      </header>

      {/* ---------------------------------------------- side drawer */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed z-50 lg:z-30 top-0 left-0 h-dvh w-64 bg-card border-r border-hairline
          flex flex-col transition-transform duration-300 ease-out
          ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        <div className="h-14 flex items-center px-5 border-b border-hairline">
          <Link href={staff ? "/schedule" : "/my"} className="font-display text-lg font-semibold tracking-tight">
            Nurora
          </Link>
          <span className="ml-2 text-[11px] uppercase tracking-[0.12em] text-faint">
            {profile.role}
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {items.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/my" && pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "bg-brand-50 text-brand-800 font-medium dark:bg-brand-400/12 dark:text-brand-100"
                    : "text-muted hover:text-body hover:bg-card-muted"
                }`}
              >
                <span className={active ? "text-brand-600 dark:text-brand-300" : ""}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-hairline">
          <Link
            href="/settings"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted hover:text-body hover:bg-card-muted transition-colors"
          >
            <SettingsIcon />
            Settings
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted hover:text-body hover:bg-card-muted transition-colors"
            >
              <SignOutIcon />
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

const CalendarIcon = () => (
  <svg {...icon}>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);
const UsersIcon = () => (
  <svg {...icon}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0-2-5.2M21 20a5.5 5.5 0 0 0-3.5-5" />
  </svg>
);
const SlidersIcon = () => (
  <svg {...icon}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="16" cy="18" r="2" />
  </svg>
);
const WalletIcon = () => (
  <svg {...icon}>
    <rect x="3" y="6" width="18" height="14" rx="3" />
    <path d="M3 10h18M16.5 15h1.5" />
  </svg>
);
const ClockIcon = () => (
  <svg {...icon}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const ChatIcon = () => (
  <svg {...icon}>
    <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-5.5A8 8 0 1 1 21 12Z" />
  </svg>
);
const PlusIcon = () => (
  <svg {...icon}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const SettingsIcon = () => (
  <svg {...icon}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14V14a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 17 4.6l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </svg>
);
const SignOutIcon = () => (
  <svg {...icon}>
    <path d="M15 17l5-5-5-5M20 12H9M12 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
  </svg>
);
