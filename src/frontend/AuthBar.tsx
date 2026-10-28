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

/**
 * Shows which credential the panel uses and offers single sign-on. The login
 * runs in a window: the IdP redirects back to the plugin's callback, which
 * posts a message to this window and closes itself. A user who already has
 * a session at the IdP sees the window close right away.
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
    } catch {
      setStatus(null);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; ok?: boolean } | null;
      if (!data || data.type !== "netbird-sso") return;
      if (!data.ok) toast.error(t("auth.failed"));
      void load().then(onChange);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [load, onChange, t, toast]);

  const signIn = async () => {
    // Open the window inside the click, so pop-up blockers allow it, and
    // point it at the IdP once the URL is known.
    const popup = window.open("", "netbird-sso", "width=520,height=700");
    if (!popup) {
      toast.error(t("auth.popupBlocked"));
      return;
    }
    setBusy(true);
    try {
      const response = await api.post<{ url: string }>("/auth/login");
      popup.location.href = response.data.url;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(pollRef.current!);
          pollRef.current = null;
          setBusy(false);
          void load().then(onChange);
        }
      }, 700);
    } catch {
      popup.close();
      setBusy(false);
      toast.error(t("auth.failed"));
    }
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
