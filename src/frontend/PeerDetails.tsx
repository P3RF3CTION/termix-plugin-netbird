import { useEffect, useState } from "react";
import {
  useTranslation,
  type PluginApiClient,
} from "@termix-ssh/plugin-sdk/frontend";
import { CircleCheck, CircleHelp, CircleX, Loader2 } from "lucide-react";
import type { PeerDetail, RuleMatch } from "./types";

interface Props {
  api: PluginApiClient;
  peerId: string;
}

function when(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

export function PeerDetails({ api, peerId }: Props) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<PeerDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setFailed(false);
    api
      .get<PeerDetail>(`/peers/${encodeURIComponent(peerId)}`)
      .then((r) => alive && setDetail(r.data))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [api, peerId]);

  if (failed) {
    return (
      <p className="text-[10px] text-muted-foreground">{t("detail.error")}</p>
    );
  }
  if (!detail) {
    return (
      <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        {t("detail.loading")}
      </p>
    );
  }

  const rows: Array<[string, string | null]> = [
    [t("detail.version"), detail.version || null],
    [
      t("detail.os"),
      [detail.os, detail.kernel].filter(Boolean).join(" · ") || null,
    ],
    [t("detail.hostname"), detail.hostname || null],
    [t("detail.connectionIp"), detail.connectionIp],
    [t("detail.location"), detail.location],
    [t("detail.lastLogin"), when(detail.lastLogin)],
    [
      t("detail.loginExpiry"),
      detail.loginExpirationEnabled
        ? t("detail.loginExpiryOn")
        : t("detail.loginExpiryOff"),
    ],
    [
      t("detail.sshServer"),
      detail.sshServerEnabled ? t("detail.on") : t("detail.off"),
    ],
    [
      t("detail.accessible"),
      detail.accessiblePeers === null ? null : String(detail.accessiblePeers),
    ],
    [
      t("detail.dnsLabels"),
      [detail.dnsLabel, ...detail.extraDnsLabels].filter(Boolean).join(", ") ||
        null,
    ],
  ];

  const ruleLine = (m: RuleMatch) => (
    <li key={`${m.policy}-${m.rule}-${m.ports}-${m.direction}`}>
      {t("detail.ruleLine", {
        policy:
          m.rule && m.rule !== m.policy ? `${m.policy} / ${m.rule}` : m.policy,
        protocol: m.protocol.toUpperCase(),
        ports: m.ports,
      })}
      {m.direction === "reverse" && ` (${t("detail.reverse")})`}
      {m.postureChecks && ` (${t("detail.posture")})`}
    </li>
  );

  const ex = detail.explanation;
  const unknown = ex.ports.every((p) => p.state === "unknown");

  return (
    <div
      className="flex flex-col gap-2 border-t border-border pt-2 text-[10px]"
      data-testid={`detail-${detail.id}`}
    >
      {detail.loginExpired && (
        <p className="text-red-600 dark:text-red-400">
          {t("detail.loginExpired")}
        </p>
      )}
      {detail.approvalRequired && (
        <p className="text-amber-600 dark:text-amber-400">
          {t("detail.approval")}
        </p>
      )}
      {detail.ephemeral && (
        <p className="text-muted-foreground">{t("detail.ephemeral")}</p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-all">{v}</dd>
            </div>
          ))}
      </dl>

      <div className="flex flex-col gap-1">
        <span className="font-semibold">{t("detail.access")}</span>
        {unknown && (
          <p className="text-muted-foreground">
            {detail.policiesReadable
              ? t("detail.noTermixPeer")
              : t("panel.policiesHidden")}
          </p>
        )}
        {!unknown &&
          ex.ports.map((p) => (
            <div key={p.port} data-testid={`port-${p.port}`}>
              {p.state === "allowed" && (
                <>
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <CircleCheck className="size-3" />
                    {t("detail.portAllowed", { port: p.port })}
                  </span>
                  <ul className="ml-4 list-disc">
                    {p.allowedBy.map(ruleLine)}
                  </ul>
                </>
              )}
              {p.state === "blocked" && (
                <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                  <CircleX className="size-3" />
                  {t("detail.portBlocked", { port: p.port })}
                </span>
              )}
              {(p.state === "unknown" || p.state === "self") && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <CircleHelp className="size-3" />
                  {t("detail.portUnknown", { port: p.port })}
                </span>
              )}
            </div>
          ))}
        {ex.otherPorts.length > 0 && (
          <div>
            <span className="text-muted-foreground">
              {t("detail.otherPorts")}
            </span>
            <ul className="ml-4 list-disc">{ex.otherPorts.map(ruleLine)}</ul>
          </div>
        )}
        {ex.disabled.length > 0 && (
          <div>
            <span className="text-muted-foreground">
              {t("detail.disabled")}
            </span>
            <ul className="ml-4 list-disc">{ex.disabled.map(ruleLine)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}
