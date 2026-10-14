import { useState, type FormEvent } from "react";
import { LANGS, type Lang } from "../i18n";
import { supabase } from "../lib/supabase";
import { clearHistory, deleteAccount, loadUserData, savePreference, setHistoryConsent } from "../services/data";
import { clearRoutes } from "../services/routes";
import { setState, toast, tr, useStore, useT } from "../store";

export function AuthForm({ initialMode = "signIn" }: { initialMode?: "signIn" | "signUp" }) {
  const t = useT();
  const session = useStore((s) => s.session);
  const [mode, setMode] = useState<"signIn" | "signUp">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signIn") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        // Une session invitée (créée lors d'un signalement) est remplacée par le nouveau compte :
        // c'est plus fiable que la conversion, qui exige une confirmation de changement d'e-mail.
        if (session?.user.is_anonymous) await supabase.auth.signOut();
        const { data, error } = await supabase.auth.signUp({
          email, password, options: { emailRedirectTo: window.location.origin + window.location.pathname },
        });
        if (error) throw error;
        if (!data.session) toast(tr("account.checkEmail"), "info", undefined, 9000);
      }
      await loadUserData();
    } catch (err) {
      toast(tr("account.error", { msg: (err as Error).message }), "error", undefined, 8000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label>
        <span className="field-label">{t("account.email")}</span>
        <input type="email" required autoComplete="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        <span className="field-label">{t("account.password")}</span>
        <input type="password" required minLength={8} autoComplete={mode === "signIn" ? "current-password" : "new-password"} className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button type="submit" disabled={busy} className="btn btn-primary mt-1 w-full">
        {t(mode === "signIn" ? "account.signIn" : "account.signUp")}
      </button>
      <button type="button" className="accent py-1 text-[17px] font-bold" onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}>
        {t(mode === "signIn" ? "account.switchToSignUp" : "account.switchToSignIn")}
      </button>
    </form>
  );
}

function Preferences() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const voice = useStore((s) => s.voice);
  const radius = useStore((s) => s.alertRadius);
  return (
    <div className="flex flex-col">
      <h3 className="panel-title mb-1">{t("account.preferences")}</h3>
      <label className="pref-row">
        {t("account.language")}
        <select className="field w-auto min-h-10 font-bold" value={lang} onChange={(e) => void savePreference("lang", e.target.value as Lang)}>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </label>
      <label className="pref-row">
        {t("account.voice")}
        <input type="checkbox" className="switch" checked={voice} onChange={(e) => void savePreference("voice", e.target.checked)} />
      </label>
      <label className="pref-row">
        {t("account.alertRadius")}
        <select className="field w-auto min-h-10 font-bold" value={radius} onChange={(e) => void savePreference("alertRadius", Number(e.target.value))}>
          {[0, 1000, 2000, 5000, 10000].map((m) => <option key={m} value={m}>{m === 0 ? "—" : `${m / 1000} km`}</option>)}
        </select>
      </label>
    </div>
  );
}

export function AccountPanel() {
  const t = useT();
  const session = useStore((s) => s.session);
  const profile = useStore((s) => s.profile);
  const favorites = useStore((s) => s.favorites);
  const user = session?.user;
  const anonymous = !!user?.is_anonymous;

  return (
    <section aria-labelledby="account-title" className="flex flex-col gap-4">
      <h2 id="account-title" className="panel-title">{t("account.title")}</h2>

      {!user && (
        <div>
          <div className="note-card mb-4">
            <p className="font-bold">{t("account.guest")}</p>
            <p className="muted text-sm">{t("account.guestHelp")}</p>
          </div>
          <AuthForm />
        </div>
      )}
      {user && anonymous && (
        <div>
          <div className="note-card mb-4">
            <p className="font-bold">{t("account.anonymous")}</p>
            <p className="muted text-sm">{t("account.guestHelp")}</p>
          </div>
          <AuthForm />
        </div>
      )}
      {user && !anonymous && (
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate">{t("account.signedInAs", { email: user.email ?? "" })}</p>
          <button type="button" className="btn btn-secondary shrink-0" onClick={() => void supabase.auth.signOut()}>
            {t("account.signOut")}
          </button>
        </div>
      )}

      {profile?.role === "admin" && (
        <a href="#/admin" className="btn btn-primary w-full">{t("account.admin")}</a>
      )}

      <Preferences />

      {profile && !anonymous && (
        <>
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="panel-title block">{t("account.favorites")}</span>
              <span className="muted text-sm">{t("favorites.count", { n: favorites.length })}</span>
            </span>
            <button type="button" className="btn btn-secondary shrink-0" onClick={() => { clearRoutes(); setState({ panel: "search" }); }}>
              {t("favorites.manage")}
            </button>
          </div>
          <div>
            <label className="flex items-start justify-between gap-3">
              <span>
                <span className="font-bold">{t("account.historyConsent")}</span>
                <span className="muted block text-sm">{t("account.historyConsentHelp")}</span>
              </span>
              <input type="checkbox" className="switch mt-1" checked={profile.history_consent} onChange={(e) => void setHistoryConsent(e.target.checked)} />
            </label>
            <button type="button" className="accent mt-1 text-sm font-bold" onClick={() => void clearHistory()}>{t("account.clearHistory")}</button>
          </div>
        </>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer font-bold">{t("privacy.title")}</summary>
        <p className="muted mt-2 leading-relaxed">{t("privacy.body")}</p>
      </details>

      {user && (
        <button
          type="button"
          className="self-start text-sm font-bold text-[var(--color-alerte)] underline-offset-4 hover:underline"
          onClick={async () => {
            if (!window.confirm(tr("account.deleteConfirm"))) return;
            if (await deleteAccount()) toast(tr("account.deleted"), "success");
            else toast(tr("account.error", { msg: "delete-account" }), "error");
          }}
        >
          {t("account.deleteAccount")}
        </button>
      )}
    </section>
  );
}
