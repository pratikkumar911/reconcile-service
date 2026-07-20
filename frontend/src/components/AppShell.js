import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Button } from "./ui/button";
import { LogOut, LayoutDashboard, ScrollText } from "lucide-react";

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  const active = (path) =>
    loc.pathname === path || (path !== "/" && loc.pathname.startsWith(path));

  return (
    <div className="min-h-screen bg-slate-50">
      <header
        data-testid="app-topbar"
        className="sticky top-0 z-30 border-b border-slate-200 bg-white"
      >
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-6 py-3">
          <Link
            to="/"
            data-testid="app-brand"
            className="flex items-center gap-2 font-display text-lg font-extrabold tracking-tight text-slate-900"
          >
            <ScrollText className="h-5 w-5 text-slate-900" />
            Reconcile
            <span className="text-slate-400">/</span>
            <span className="text-slate-500 font-semibold text-sm uppercase tracking-[0.15em]">
              Ledger
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            <Link
              to="/"
              data-testid="nav-dashboard"
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active("/")
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span
              data-testid="current-user-email"
              className="hidden sm:inline text-sm text-slate-600"
            >
              {user?.email}
            </span>
            <Button
              variant="outline"
              size="sm"
              data-testid="logout-btn"
              onClick={() => {
                logout();
                nav("/auth");
              }}
              className="gap-1.5"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>
    </div>
  );
}
