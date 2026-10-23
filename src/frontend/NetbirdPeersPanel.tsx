import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useToast,
  useTranslation,
  type HostDraft,
  type PluginApiClient,
} from "@termix-ssh/plugin-sdk/frontend";
import { Badge, Button, Checkbox, Input } from "@termix-ssh/plugin-sdk/ui";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  CircleX,
  Copy,
  Download,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { AuthBar } from "./AuthBar";
import { ImportDialog } from "./ImportDialog";
import { PeerDetails } from "./PeerDetails";
import type { PeersResponse, PeerView } from "./types";

export type { PeersResponse, PeerView } from "./types";

interface Props {
  api: PluginApiClient;
  /** Absent when the shell cannot open the host editor. */
  onAddHost?: (draft: HostDraft) => void;
  /** The user holds netbird.peers.import. */
  canImport?: boolean;
}

function errorBody(err: unknown): PeersResponse | null {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  return data && typeof data === "object" && "peers" in data
    ? (data as PeersResponse)
    : null;
}

export function NetbirdPeersPanel({
  api,
  onAddHost,
  canImport = false,
}: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [data, setData] = useState<PeersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<PeersResponse>("/peers");
      setData(response.data);
    } catch (err) {
      setData(
        errorBody(err) ?? {
          configured: true,
          source: null,
          termixPeer: null,
          termixPeerMissing: false,
          policiesReadable: true,
          peers: [],
          error: "api",
        },
      );
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const peers = data?.peers ?? [];
    if (!q) return peers;
    return peers.filter((p) =>
      [p.name, p.ip, p.dnsLabel, p.os, ...p.groups].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }, [data, query]);

  const copyIp = (ip: string) => {
    navigator.clipboard
      .writeText(ip)
      .then(() => toast.success(t("panel.ipCopied")))
      .catch(() => toast.error(t("panel.copyFailed")));
  };

  const reachBadge = (peer: PeerView) => {
    const r = peer.reachability;
    if (r.state === "self") {
      return <Badge variant="outline">{t("panel.self")}</Badge>;
    }
    if (r.state === "allowed") {
      const title = [
        t("reach.allowedBy", { policies: r.policies.join(", ") }),
        r.postureChecks ? t("reach.postureChecks") : "",
      ]
        .filter(Boolean)
        .join(" ");
      return (
        <span
          className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400"
          title={title}
          data-testid={`reach-${peer.id}`}
        >
          <CircleCheck className="size-3" />
          {t("reach.allowed", { port: peer.sshPort })}
        </span>
      );
    }
    if (r.state === "blocked") {
      return (
        <span
          className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400"
          title={t("reach.blockedHint", { port: peer.sshPort })}
          data-testid={`reach-${peer.id}`}
        >
          <CircleX className="size-3" />
          {t("reach.blocked", { port: peer.sshPort })}
        </span>
      );
    }
    return (
      <span
        className="flex items-center gap-1 text-[10px] text-muted-foreground"
        data-testid={`reach-${peer.id}`}
      >
        <CircleHelp className="size-3" />
        {t("reach.unknown")}
      </span>
    );
  };

  const selectable = shown.filter(
    (p) => p.ip && !p.imported && p.reachability.state !== "self",
  );
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected =
    selectable.length > 0 && selectable.every((p) => selected.has(p.id));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) selectable.forEach((p) => next.delete(p.id));
      else selectable.forEach((p) => next.add(p.id));
      return next;
    });

  let notice: string | null = null;
  if (data?.error === "signin") notice = t("panel.signInNeeded");
  else if (data && !data.configured) notice = t("panel.notConfigured");
  else if (data?.error === "token") notice = t("panel.tokenRejected");
  else if (data?.error === "api") notice = t("panel.apiError");

  let checkInfo: string | null = null;
  if (data?.configured && !data.error && !data.policiesReadable) {
    checkInfo = t("panel.policiesHidden");
  } else if (data?.configured && !data.error) {
    if (data.termixPeer)
      checkInfo = t("panel.termixPeer", { name: data.termixPeer });
    else if (data.termixPeerMissing) checkInfo = t("panel.termixPeerMissing");
    else checkInfo = t("panel.termixPeerUnset");
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <AuthBar api={api} onChange={() => void load()} />
      <div className="flex items-center gap-1.5">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("panel.search")}
          aria-label={t("panel.search")}
          className="h-8 text-xs"
        />
        <Button
          variant="ghost"
          size="icon"
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

      {checkInfo && (
        <p className="text-[10px] text-muted-foreground">{checkInfo}</p>
      )}

      {canImport && !notice && selectable.length > 0 && (
        <div className="flex items-center gap-2 text-[10px]">
          <label className="flex items-center gap-1.5">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              aria-label={t("panel.selectAll")}
            />
            {t("panel.selectAll")}
          </label>
          {selected.size > 0 && (
            <>
              <span className="text-muted-foreground">
                {t("panel.selected", { count: selected.size })}
              </span>
              <Button
                className="ml-auto h-7 gap-1 text-xs"
                onClick={() => setImportOpen(true)}
              >
                <Download className="size-3.5" />
                {t("panel.importSelected")}
              </Button>
            </>
          )}
        </div>
      )}

      {loading && !data && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("panel.loading")}
        </p>
      )}

      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}

      {data && !notice && data.peers.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("panel.empty")}</p>
      )}
      {data && !notice && data.peers.length > 0 && shown.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("panel.noMatches")}</p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {!notice &&
          shown.map((peer) => (
            <div
              key={peer.id}
              className="flex flex-col gap-1.5 border border-border p-2"
              data-testid={`peer-${peer.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 items-start gap-1.5">
                  {canImport && (
                    <Checkbox
                      checked={selected.has(peer.id)}
                      disabled={
                        !peer.ip ||
                        peer.imported ||
                        peer.reachability.state === "self"
                      }
                      onCheckedChange={() => toggle(peer.id)}
                      aria-label={t("panel.selectPeer", { name: peer.name })}
                    />
                  )}
                  <span className="min-w-0 break-all text-xs font-semibold">
                    {peer.name}
                  </span>
                </span>
                <span
                  className={
                    peer.connected
                      ? "shrink-0 text-[10px] text-emerald-600 dark:text-emerald-400"
                      : "shrink-0 text-[10px] text-muted-foreground"
                  }
                  title={
                    peer.lastSeen
                      ? t("panel.lastSeen", {
                          when: new Date(peer.lastSeen).toLocaleString(),
                        })
                      : undefined
                  }
                >
                  {peer.connected ? t("panel.online") : t("panel.offline")}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {peer.ip}
                </span>
                {peer.ip && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5 text-muted-foreground hover:text-foreground"
                    title={t("panel.copyIp")}
                    aria-label={t("panel.copyIp")}
                    onClick={() => copyIp(peer.ip)}
                  >
                    <Copy className="size-3" />
                  </Button>
                )}
                {peer.os && (
                  <span className="ml-auto border border-border px-1 text-[10px] text-muted-foreground">
                    {peer.os}
                  </span>
                )}
              </div>

              {peer.dnsLabel && (
                <span className="break-all text-[10px] text-muted-foreground">
                  {peer.dnsLabel}
                </span>
              )}

              {peer.groups.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {peer.groups.map((g) => (
                    <Badge key={g} variant="secondary" className="text-[10px]">
                      {g}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                {reachBadge(peer)}
                {peer.imported && (
                  <Badge variant="outline" className="text-[10px]">
                    {t("panel.imported")}
                  </Badge>
                )}
                {onAddHost &&
                  !peer.imported &&
                  peer.reachability.state !== "self" && (
                    <Button
                      variant="outline"
                      className="h-7 shrink-0 gap-1 text-xs"
                      disabled={!peer.ip}
                      onClick={() =>
                        onAddHost({
                          name: peer.name,
                          // The NetBird IP, not the DNS label: the label only
                          // resolves where NetBird DNS is on, which servers
                          // often switch off (--disable-dns).
                          ip: peer.ip,
                          port: peer.sshPort,
                        })
                      }
                    >
                      <Plus className="size-3.5" />
                      {t("panel.addHost")}
                    </Button>
                  )}
              </div>

              <Button
                variant="ghost"
                className="h-6 justify-start gap-1 px-1 text-[10px] text-muted-foreground"
                onClick={() =>
                  setExpanded((cur) => (cur === peer.id ? null : peer.id))
                }
                aria-expanded={expanded === peer.id}
              >
                {expanded === peer.id ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                {expanded === peer.id
                  ? t("panel.hideDetails")
                  : t("panel.details")}
              </Button>
              {expanded === peer.id && (
                <PeerDetails api={api} peerId={peer.id} />
              )}
            </div>
          ))}
      </div>

      {canImport && (
        <ImportDialog
          api={api}
          peerIds={[...selected]}
          defaultPort={data?.peers[0]?.sshPort ?? 22}
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onDone={() => {
            setImportOpen(false);
            setSelected(new Set());
            void load();
          }}
        />
      )}
    </div>
  );
}
