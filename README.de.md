<div align="center">

<img src="https://termix.site/img/logo.svg" width="120" alt="Termix Logo" />

<h1>NetBird für Termix</h1>

<p>NetBird-Peers in Termix sehen, mit einem Klick als Host anlegen und prüfen, ob die Policies Termix den SSH-Port erreichen lassen</p>

<p><a href="README.md">English</a></p>

</div>

<br />

## Was das Plugin macht

[NetBird](https://netbird.io) verbindet Ihre Rechner in einem privaten Netz. In [Termix](https://github.com/Termix-SSH/Termix) öffnen Sie die SSH-Sitzungen dorthin. Das Plugin verbindet beides:

- **Peer-Liste.** Ein NetBird-Panel in der Termix-Seitenleiste zeigt jeden Peer mit NetBird-IP, DNS-Label, Betriebssystem, Gruppen und Online-Status. Mit Suche, IP-Kopieren und Aktualisieren.
- **Als Host hinzufügen.** Ein Klick öffnet den Host-Editor von Termix mit Name, NetBird-IP und SSH-Port. Benutzername und Anmeldung wählen Sie dort selbst und speichern.
- **SSH-Erreichbarkeit.** Für jeden Peer liest das Plugin Ihre NetBird-Access-Policies und zeigt, ob der Termix-Server den SSH-Port öffnen darf und welche Policy das erlaubt. So sehen Sie den Grund eines Verbindungsfehlers, bevor Sie einen Timeout auswerten.

Es funktioniert mit NetBird Cloud und mit einem selbst betriebenen Management-Server. Es liest nur aus NetBird und ändert dort nichts.

<br />

## Voraussetzungen

- Termix 26.10 oder neuer und ein Admin-Konto darin
- Ein NetBird-Netz (Cloud oder selbst betrieben) und das Recht, dort einen Service-User anzulegen
- Für die Erreichbarkeitsprüfung: Der Termix-Server ist selbst ein NetBird-Peer

<br />

## Installation

**Aus der Plugin-Liste.** In Termix **Plugins** öffnen, nach **NetBird** suchen und installieren.

> Das Plugin ist noch nicht in der Community-Registry. Bis dahin bitte die Installation aus Datei nutzen.

**Aus Datei.** `netbird-<version>.tmxplug` von der [Releases](https://github.com/P3RF3CTION/termix-plugin-netbird/releases)-Seite laden und in Termix unter **Plugins, Install from file** installieren. Termix kennzeichnet eine Dateiinstallation als nicht verifiziert. Vergleichen Sie vorher den `sha256` der Datei mit dem Wert in den Release-Notes.

<br />

## Einrichtung

### 1. Lesendes Token in NetBird anlegen

1. Im NetBird-Dashboard einen Service-User anlegen, zum Beispiel `termix`.
2. Ihm die Rolle **Auditor** geben, sofern Ihre NetBird-Version sie anbietet, sonst die niedrigste Rolle, die Peers und Policies lesen darf.
3. Ein Personal Access Token dafür erzeugen und kopieren. NetBird zeigt es nur einmal an.

Nehmen Sie einen Service-User statt des eigenen Kontos. Dann bleibt das Token gültig, wenn Personen ausscheiden, und es darf nicht mehr, als das Plugin braucht.

### 2. Einstellungen ausfüllen

In Termix **Einstellungen, Plugins, NetBird** öffnen:

| Einstellung    | Eintrag                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Management-URL | Ihr selbst betriebener Server, zum Beispiel `https://vpn.example.com`. Für NetBird Cloud leer lassen. `/api` wird ergänzt.               |
| API-Token      | Das Token aus Schritt 1. Termix speichert es verschlüsselt, es erreicht nie den Browser.                                                 |
| Termix-Peer    | Der Peer, auf dem der Termix-Server läuft: Name, DNS-Label oder NetBird-IP. Optional, ohne ihn entfällt aber die Erreichbarkeitsprüfung. |
| SSH-Port       | Der zu prüfende Port, auch für neue Hosts. Standard `22`.                                                                                |

### 3. Sichtbarkeit festlegen

Das Panel braucht die Berechtigung **NetBird-Peers ansehen**. Standardmäßig haben sie nur Admins, weil die Liste das ganze Netz zeigt. Weitere Rollen berechtigen Sie in Termix bei Bedarf selbst.

<br />

## Nutzung

**NetBird** in der Seitenleiste öffnen. Jeder Peer trägt ein Kennzeichen:

| Kennzeichen                    | Bedeutung                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **SSH 22 erlaubt**             | Mindestens eine aktive Policy erlaubt dem Termix-Peer TCP 22 zu diesem Peer. Beim Überfahren erscheinen die Policies.          |
| **Keine Regel erlaubt SSH 22** | Keine aktive Policy passt. Legen Sie eine Policy von einer Gruppe des Termix-Peers zu einer Gruppe dieses Peers für TCP 22 an. |
| **Nicht geprüft**              | Kein Termix-Peer eingestellt, oder er wurde im Netz nicht gefunden.                                                            |
| **Das ist der Termix-Server**  | Der Peer, auf dem Termix läuft.                                                                                                |

Die Prüfung liest die Policies, sie baut keine Verbindung auf. Eine erlaubte Verbindung kann trotzdem scheitern, wenn der Peer offline ist, eine Host-Firewall den Port sperrt oder ein Posture Check fehlschlägt. Hat eine passende Policy Posture Checks, weist das Kennzeichen darauf hin.

<br />

## Fehlerbehebung

| Meldung                                                                   | Was tun                                                                                                     |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| _Hinterlege das NetBird-API-Token unter Einstellungen, Plugins, NetBird._ | Es ist noch kein Token gespeichert. Siehe [Einrichtung](#einrichtung).                                      |
| _NetBird hat das API-Token abgelehnt._                                    | Token falsch, abgelaufen oder gelöscht. Neues Token erzeugen und erneut speichern.                          |
| _Die NetBird-Management-API war nicht lesbar._                            | Management-URL prüfen und ob der Termix-Server sie erreicht (DNS, Firewall, TLS-Zertifikat).                |
| _Der Termix-Peer aus den Einstellungen ist nicht in diesem Netz._         | Schreibweise prüfen. Name, DNS-Label und NetBird-IP funktionieren. Der Peer muss im Netz des Tokens liegen. |
| Das NetBird-Panel fehlt                                                   | Ihrer Rolle fehlt **NetBird-Peers ansehen**, oder das Plugin ist unter **Plugins** deaktiviert.             |

<br />

## Datenschutz und Sicherheit

- Das Plugin spricht nur mit der eingestellten Management-URL und dem eingestellten Token. Keine Telemetrie, keine anderen Server.
- Es liest Peers und Policies und schreibt nie in NetBird.
- Es hat keinen Zugriff auf Termix-Hosts, Zugangsdaten oder SSH-Sitzungen. Ein Host entsteht erst, wenn Sie ihn im Host-Editor speichern.
- Das Token liegt verschlüsselt auf dem Termix-Server und wird nie an den Browser gesendet. Gelangt es nach außen, verrät es Peers und Policies; widerrufen Sie es dann in NetBird.

Angeforderte Capabilities:

| Capability         | Wofür                                                                               |
| ------------------ | ----------------------------------------------------------------------------------- |
| `network:outbound` | NetBird-Management-API unter der eingestellten URL lesen                            |
| `network:serve`    | Eine lesende Route für das Panel, hinter der Berechtigung **NetBird-Peers ansehen** |
| `ui:surface`       | Das Panel in der Seitenleiste                                                       |

Sicherheitsproblem gefunden? Bitte vertraulich über [GitHub Security Advisories](https://github.com/P3RF3CTION/termix-plugin-netbird/security/advisories/new) melden, nicht in einem öffentlichen Issue.

<br />

## Mitwirken

Fehlermeldungen und Ideen gern als [Issue](https://github.com/P3RF3CTION/termix-plugin-netbird/issues). Zur Entwicklung siehe [CONTRIBUTING.md](CONTRIBUTING.md).

<br />

## Lizenz

Apache-2.0. Keine Verbindung zur NetBird GmbH; „NetBird" bezeichnet den Dienst, mit dem sich das Plugin verbindet.
