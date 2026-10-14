import { useState, type FormEvent } from "react";
import { LANGS, type Lang } from "../i18n";
import { supabase } from "../lib/supabase";
import { clearHistory, deleteAccount, deleteFavorite, loadUserData, savePreference, setHistoryConsent } from "../services/data";
import { computeRoutes } from "../services/routes";
import { toast, tr, useStore, useT } from "../store";

function AuthForm() {
  const t = useT();
  const session = useStore((s) => s.session);
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
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
      } else if (session?.user.is_anonymous) {
        // Convertir la session invitée en compte : les signalements restent liés
        const { error } = await supabase.auth.updateUser({ email, password });
        if (error) throw error;
        toast(tr("account.checkEmail"), "info", undefined, 9000);
      } else {
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
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label className="text-sm">
        <span className="muted block">{t("account.email")}</span>
        <input type="email" required autoComplete="email" className="surface h-11 w-full rounded-xl border hairline px-3" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="text-sm">
        <span className="muted block">{t("account.password")}</span>
        <input type="password" required minLength={8} autoComplete={mode === "signIn" ? "current-password" : "new-password"} className="surface h-11 w-full rounded-xl border hairline px-3" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button type="submit" disabled={busy} className="bg-accent mt-1 h-11 rounded-xl font-bold text-white disabled:opacity-60">
        {t(mode === "signIn" ? "account.signIn" : "account.signUp")}
      </button>
      <button type="button" className="accent text-sm font-bold" onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}>
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
    <div className="flex flex-col gap-2 text-[15px]">
      <h3 className="font-bold">{t("account.preferences")}</h3>
      <label className="flex items-center justify-between gap-3">
        {t("account.language")}
        <select className="surface h-10 rounded-lg border hairline px-2" value={lang} onChange={(e) => void savePreference("lang", e.target.value as Lang)}>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </label>
      <label className="flex items-center justify-between gap-3">
        {t("account.voice")}
        <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={voice} onChange={(e) => void savePreference("voice", e.target.checked)} />
      </label>
      <label className="flex items-center justify-between gap-3">
        {t("account.alertRadius")}
        <select className="surface h-10 rounded-lg border hairline px-2" value={radius} onChange={(e) => void savePreference("alertRadius", Number(e.target.value))}>
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
      <h2 id="account-title" className="text-lg font-bold">{t("account.title")}</h2>

      {!user && (
        <div>
          <p className="font-bold">{t("account.guest")}</p>
          <p className="muted mb-3 text-sm">{t("account.guestHelp")}</p>
          <AuthForm />
        </div>
      )}
      {user && anonymous && (
        <div>
          <p className="font-bold">{t("account.anonymous")}</p>
          <p className="muted mb-3 text-sm">{t("account.guestHelp")}</p>
          <AuthForm />
        </div>
      )}
      {user && !anonymous && (
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate">{t("account.signedInAs", { email: user.email ?? "" })}</p>
          <button type="button" className="h-10 shrink-0 rounded-lg border hairline px-3 font-bold" onClick={() => void supabase.auth.signOut()}>
            {t("account.signOut")}
          </button>
        </div>
      )}

      {profile?.role === "admin" && (
        <a href="#/admin" className="bg-accent rounded-xl px-4 py-3 text-center font-bold text-white">{t("account.admin")}</a>
      )}

      <Preferences />

      {profile && !anonymous && (
        <>
          <div>
            <h3 className="font-bold">{t("account.favorites")}</h3>
            {favorites.length === 0 ? (
              <p className="muted text-sm">{t("account.noFavorites")}</p>
            ) : (
              <ul className="mt-1 flex flex-col">
                {favorites.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 py-1">
                    <button type="button" className="min-w-0 flex-1 truncate text-start font-bold" onClick={() => void computeRoutes({ label: f.label, lngLat: [f.lng, f.lat] })}>
                      {f.kind === "home" ? `${t("search.home")} · ` : f.kind === "work" ? `${t("search.work")} · ` : ""}{f.label}
                    </button>
                    <button type="button" className="muted text-sm underline-offset-4 hover:underline" onClick={() => void deleteFavorite(f.id)}>
                      {t("account.deleteFavorite")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label className="flex items-start justify-between gap-3">
              <span>
                <span className="font-bold">{t("account.historyConsent")}</span>
                <span className="muted block text-sm">{t("account.historyConsentHelp")}</span>
              </span>
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={profile.history_consent} onChange={(e) => void setHistoryConsent(e.target.checked)} />
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
