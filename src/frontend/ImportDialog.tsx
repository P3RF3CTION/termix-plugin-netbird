import { useEffect, useState } from "react";
import {
  useToast,
  useTranslation,
  type PluginApiClient,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@termix-ssh/plugin-sdk/ui";
import { Loader2 } from "lucide-react";
import type { CredentialOption, ImportResult } from "./types";

interface Props {
  api: PluginApiClient;
  peerIds: string[];
  defaultPort: number;
  open: boolean;
  onClose: () => void;
  onDone: (result: ImportResult) => void;
}

const NO_CREDENTIAL = "none";

export function ImportDialog({
  api,
  peerIds,
  defaultPort,
  open,
  onClose,
  onDone,
}: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [folder, setFolder] = useState("NetBird");
  const [username, setUsername] = useState("");
  const [port, setPort] = useState(String(defaultPort));
  const [credential, setCredential] = useState(NO_CREDENTIAL);
  const [tagGroups, setTagGroups] = useState(true);
  const [credentials, setCredentials] = useState<CredentialOption[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPort(String(defaultPort));
    api
      .get<CredentialOption[]>("/credentials")
      .then((r) => setCredentials(Array.isArray(r.data) ? r.data : []))
      .catch(() => setCredentials([]));
  }, [api, open, defaultPort]);

  const submit = async () => {
    setBusy(true);
    try {
      const response = await api.post<ImportResult>("/hosts/import", {
        peerIds,
        folder: folder.trim(),
        username: username.trim(),
        port: Number.parseInt(port, 10),
        credentialId:
          credential === NO_CREDENTIAL ? null : Number.parseInt(credential, 10),
        tagGroups,
      });
      const r = response.data;
      toast.success(
        t("import.result", {
          created: r.created.length,
          skipped: r.skipped.length,
          failed: r.failed.length,
        }),
      );
      onDone(r);
    } catch {
      toast.error(t("import.error"));
    } finally {
      setBusy(false);
    }
  };

  const chosen = credentials.find((c) => String(c.id) === credential);

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("import.title", { count: peerIds.length })}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="nb-folder">{t("import.folder")}</Label>
            <Input
              id="nb-folder"
              value={folder}
              placeholder={t("import.folderPlaceholder")}
              onChange={(e) => setFolder(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="nb-user">{t("import.username")}</Label>
              <Input
                id="nb-user"
                value={username}
                placeholder={chosen?.username || "root"}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="flex w-24 flex-col gap-1">
              <Label htmlFor="nb-port">{t("import.port")}</Label>
              <Input
                id="nb-port"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("import.credential")}</Label>
            <Select value={credential} onValueChange={setCredential}>
              <SelectTrigger aria-label={t("import.credential")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CREDENTIAL}>
                  {t("import.credentialNone")}
                </SelectItem>
                {credentials.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.username ? `${c.name} (${c.username})` : c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={tagGroups}
              onCheckedChange={(v) => setTagGroups(v === true)}
            />
            {t("import.tagGroups")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("import.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {t("import.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
