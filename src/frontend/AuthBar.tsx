import { useCallback, useEffect, useRef, useState } from "react";
import {
  useToast,
  useTranslation,
  type PluginApiClient,
} from "@termix-ssh/plugin-sdk/frontend";
import { Button } from "@termix-ssh/plugin-sdk/ui";
import { KeyRound, LogIn, LogOut, Users } from "lucide-react";
import type { AuthStatus } from "./types";

interface Props {
  api: PluginApiClient;
  /** Called after a sign-in or sign-out so the panel reloads its peers. */
  onChange: () => void;
}

/** How often and how long the panel looks for a finished sign-in. */
const POLL_MS = 2_000;
const POLL_LIMIT_MS = 10 * 60_000;

/**
 * Shows which credential the panel uses and offers single sign-on.
 *
 * Plugin API 2 runs this panel in a sandboxed frame: window.open goes to the
 * Termix shell, which opens the IdP in a new tab without an opener, and only
 * right after a click. So the login URL is fetched inside the click and
 * opened at once, and the panel asks the server for the sign-in state until
 * the callback has stored the session (or ten minutes have passed). A user
 * who already has a session at the IdP sees the tab finish right away.
 */
export function AuthBar({ api, onChange }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.get<AuthStatus>("/auth/status");
      setStatus(response.data);
      return response.data;
    } catch {
      setStatus(null);
      return null;
    }
  }, [api]);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => stopPolling, [stopPolling]);

  const signIn = async () => {
    setBusy(true);
    let url: string;
    try {
      const response = await api.post<{ url: string }>("/auth/login");
      url = response.data.url;
    } catch {
      setBusy(false);
      toast.error(t("auth.failed"));
      return;
    }
    // In a frame this returns null and the shell opens the tab.
    window.open(url, "_blank", "noopener,noreferrer");
    toast.info(t("auth.continueInTab"));

    stopPolling();
    const started = Date.now();
    pollRef.current = window.setInterval(() => {
      void load().then((next) => {
        if (next?.ssoSignedIn) {
          stopPolling();
          setBusy(false);
          onChange();
        } else if (Date.now() - started > POLL_LIMIT_MS) {
          stopPolling();
          setBusy(false);
        }
      });
    }, POLL_MS);
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await api.post("/auth/logout");
    } finally {
      setBusy(false);
      await load();
      onChange();
    }
  };

  if (!status) return null;

  const ownSignIn = status.mode !== "service";
  let label: string | null = null;
  let Icon = KeyRound;
  if (status.active === "sso") {
    label = status.ssoIdentity
      ? t("auth.signedInAs", { name: status.ssoIdentity })
      : t("auth.signedIn");
    Icon = LogIn;
  } else if (status.active === "user") {
    label = t("auth.usingUserToken");
  } else if (status.active === "service") {
    label = t("auth.usingService");
    Icon = Users;
  }

  return (
    <div className="flex flex-col gap-1 border border-border p-2 text-[10px]">
      <div className="flex items-center justify-between gap-2">
        {label && (
          <span
            className="flex min-w-0 items-center gap-1 text-muted-foreground"
            data-testid="auth-label"
          >
            <Icon className="size-3 shrink-0" />
            <span className="truncate">{label}</span>
          </span>
        )}
        {ownSignIn && status.ssoAvailable && !status.ssoSignedIn && (
          <Button
            variant="outline"
            className="ml-auto h-7 shrink-0 gap-1 text-xs"
            onClick={() => void signIn()}
            disabled={busy}
          >
            <LogIn className="size-3.5" />
            {t("auth.signInSso")}
          </Button>
        )}
        {status.ssoSignedIn && (
          <Button
            variant="ghost"
            className="ml-auto h-7 shrink-0 gap-1 text-xs"
            onClick={() => void signOut()}
            disabled={busy}
          >
            <LogOut className="size-3.5" />
            {t("auth.signOut")}
          </Button>
        )}
      </div>
      {status.userTokenIgnored && (
        <p
          className="text-amber-600 dark:text-amber-400"
          data-testid="user-token-ignored"
        >
          {t("auth.userTokenIgnored")}
        </p>
      )}
      {ownSignIn && !status.ssoAvailable && !status.active && (
        <p className="text-muted-foreground">
          {t("auth.notConfigured")} {t("auth.orToken")}
        </p>
      )}
      {ownSignIn && status.ssoAvailable && !status.ssoSignedIn && (
        <p
          className="break-all text-muted-foreground"
          data-testid="redirect-uri"
        >
          {t("auth.redirectUri", { uri: status.redirectUri })}
        </p>
      )}
    </div>
  );
}
