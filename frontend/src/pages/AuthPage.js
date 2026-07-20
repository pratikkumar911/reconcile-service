import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { ScrollText } from "lucide-react";

export default function AuthPage() {
  const nav = useNavigate();
  const { login, signup } = useAuth();
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email || password.length < 6) {
      toast.error("Enter a valid email and a password of 6+ characters.");
      return;
    }
    setBusy(true);
    try {
      if (tab === "login") {
        await login(email, password);
        toast.success("Welcome back.");
      } else {
        await signup(email, password);
        toast.success("Account created.");
      }
      nav("/");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="relative flex items-center justify-center p-6 sm:p-12 min-h-screen">
      <div className="absolute top-6 left-6 flex items-center gap-2 font-display text-lg font-extrabold text-slate-900">
        <ScrollText className="h-5 w-5" />
        Reconcile Ledger
      </div>

      <div className="w-full max-w-md">
        <h2 className="font-display text-2xl font-bold text-slate-900">
          {tab === "login" ? "Sign in to your account" : "Create your account"}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {tab === "login"
            ? "Reconcile your orders against actual payments."
            : "Start reconciling in under a minute."}
        </p>

        <Tabs value={tab} onValueChange={setTab} className="mt-6">
          <TabsList
            data-testid="auth-tabs"
            className="grid w-full grid-cols-2"
          >
            <TabsTrigger data-testid="tab-login" value="login">
              Sign in
            </TabsTrigger>
            <TabsTrigger data-testid="tab-signup" value="signup">
              Sign up
            </TabsTrigger>
          </TabsList>

          <TabsContent value={tab} forceMount>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  data-testid="auth-email-input"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  data-testid="auth-password-input"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={tab === "login" ? "current-password" : "new-password"}
                  required
                />
              </div>
              <Button
                type="submit"
                data-testid="auth-submit-btn"
                disabled={busy}
                className="w-full bg-slate-900 hover:bg-slate-800"
              >
                {busy
                  ? "Please wait…"
                  : tab === "login"
                    ? "Sign in"
                    : "Create account"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}