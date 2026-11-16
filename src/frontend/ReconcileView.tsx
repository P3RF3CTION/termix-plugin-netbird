import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useToast,
  useTranslation,
  type PluginApiClient,
} from "@termix-ssh/plugin-sdk/frontend";
import { Button, Checkbox } from "@termix-ssh/plugin-sdk/ui";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import type {
  FindingKind,
  HostFinding,
  ReconcileApplyResult,
  ReconcileResponse,
} from "./types";

interface Props {
  api: PluginApiClient;
  onClose: () => void;
  /** Called after hosts were changed, so the peer list can reload. */
  onChanged?: () => void;
  /** Asks before hosts are changed; window.confirm when absent. */
  confirm?: (options: {
    title: string;
    description?: string;
    confirmLabel?: string;
  }) => Promise<boolean>;
}

const KINDS: FindingKind[] = ["missing", "ip-changed", "stale", "offline"];

export function ReconcileView({ api, onClose, onChanged, confirm }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [data, setData] = useState<ReconcileResponse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      const response = await api.get<ReconcileResponse>("/hosts/reconcile");
      setData(response.data);
      setSelected(new Set());
    } catch (err) {
      const code = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error;
      setFailed(
        code === "signin" ? "signin" : code === "token" ? "token" : "api",
      );
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const actionable = useMemo(
    () => (data?.findings ?? []).filter((f) => f.actions.length > 0),
    [data],
  );
  const chosen = actionable.filter((f) => selected.has(f.hostId));

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const describe = (f: HostFinding): string => {
    switch (f.kind) {
      case "missing":
        if (!f.certain) return t("reconcile.missingUncertain");
        return f.peerId
          ? t("reconcile.missing", { peer: f.peerId })
          : t("reconcile.missingIp");
      case "ip-changed":
        return t("reconcile.ipChanged", {
          peer: f.peerName ?? "",
          ip: f.peerIp ?? "",
        });
      case "stale":
      case "offline":
        return f.offlineDays === null
          ? t("reconcile.offlineUnknown", { peer: f.peerName ?? "" })
          : t("reconcile.offlineDays", {
              peer: f.peerName ?? "",
              days: f.offlineDays,
            });
    }
  };

  const apply = async () => {
    if (chosen.length === 0) return;
    const updates = chosen.filter((f) => f.actions[0] === "update-ip").length;
    const removals = chosen.length - updates;
    const question = {
      title: t("reconcile.confirmTitle"),
      description: t("reconcile.confirmText", { updates, removals }),
      confirmLabel: t("reconcile.apply"),
    };
    const ok = confirm
      ? await confirm(question)
      : window.confirm(`${question.title}\n\n${question.description}`);
    if (!ok) return;

    setApplying(true);
    try {
      const response = await api.post<ReconcileApplyResult>(
        "/hosts/reconcile",
        {
          actions: chosen.map((f) => ({
            hostId: f.hostId,
            action: f.actions[0],
          })),
        },
      );
      const r = response.data;
      const message = t("reconcile.result", {
        updated: r.updated.length,
        deleted: r.deleted.length,
        skipped: r.skipped.length,
        failed: r.failed.length,
      });
      if (r.failed.length > 0) toast.error(message);
      else toast.success(message);
      if (r.updated.length + r.deleted.length > 0) onChanged?.();
    } catch {
      toast.error(t("reconcile.applyFailed"));
    } finally {
      setApplying(false);
      void load();
    }
  };

  const findings = data?.findings ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="reconcile">
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          title={t("reconcile.back")}
          aria-label={t("reconcile.back")}
          onClick={onClose}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <span className="text-xs font-semibold">{t("reconcile.title")}</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          title={t("panel.refresh")}
          aria-label={t("panel.refresh")}
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw
            className={loading ? "size-3.5 animate-spin" : "size-3.5"}
          />
        </Button>
      </div>

      {failed && (
        <p className="text-xs text-muted-foreground">
          {failed === "signin"
            ? t("panel.signInNeeded")
            : failed === "token"
              ? t("panel.tokenRejected")
              : t("panel.apiError")}
        </p>
      )}

      {data && (
        <p className="text-[10px] text-muted-foreground">
          {data.staleDays > 0
            ? t("reconcile.intro", { days: data.staleDays })
            : t("reconcile.introNoStale")}
        </p>
      )}
      {data && !data.complete && (
        <p
          className="text-[10px] text-amber-600 dark:text-amber-400"
          data-testid="reconcile-incomplete"
        >
          {t("reconcile.incomplete")}
        </p>
      )}
      {data && findings.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("reconcile.clean")}</p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {KINDS.map((kind) => {
          const rows = findings.filter((f) => f.kind === kind);
          if (rows.length === 0) return null;
          return (
            <div key={kind} className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                {t(`reconcile.kind.${kind}`, { count: rows.length })}
              </span>
              {rows.map((f) => (
                <label
                  key={f.hostId}
                  className="flex items-start gap-1.5 border border-border p-2"
                  data-testid={`finding-${f.hostId}`}
                >
                  {f.actions.length > 0 ? (
                    <Checkbox
                      checked={selected.has(f.hostId)}
                      onCheckedChange={() => toggle(f.hostId)}
                      aria-label={t("reconcile.select", { name: f.hostName })}
                    />
                  ) : (
                    <span className="size-4 shrink-0" />
                  )}
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="break-all text-xs font-semibold">
                      {f.hostName}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {f.hostIp}:{f.port}
                    </span>
                    <span className="text-[10px]">{describe(f)}</span>
                    {f.loginExpired && (
                      <span className="text-[10px] text-muted-foreground">
                        {t("reconcile.loginExpired")}
                      </span>
                    )}
                    {f.actions.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {t(`reconcile.action.${f.actions[0]}`)}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          );
        })}
      </div>

      {actionable.length > 0 && (
        <div className="flex items-center gap-2 border-t border-border pt-2">
          <span className="text-[10px] text-muted-foreground">
            {t("panel.selected", { count: chosen.length })}
          </span>
          <Button
            className="ml-auto h-7 gap-1 text-xs"
            disabled={chosen.length === 0 || applying}
            onClick={() => void apply()}
            data-testid="reconcile-apply"
          >
            {applying && <Loader2 className="size-3.5 animate-spin" />}
            {t("reconcile.apply")}
          </Button>
        </div>
      )}
    </div>
  );
}
