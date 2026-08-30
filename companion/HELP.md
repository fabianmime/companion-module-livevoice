## LiveVoice Remote

Steuert [LiveVoice](https://livevoice.io) direkt über die interne HTTP-/ActionCable-Schnittstelle des
Operator-Webclients - **kein Browser, kein Selenium, keine PowerShell-Hilfsskripte**. Das Modul liest API-Key,
Client-Identifier, Join-Code und Auth-URL automatisch aus der geladenen Operator-Seite; diese Werte müssen nicht
manuell eingetragen werden.

«LiveVoice» und das LiveVoice-Logo sind Marken der LiveVoice GmbH. Dieses Projekt ist ein unabhängiges
Community-Modul, steht in keiner Verbindung zu LiveVoice und verwendet weder deren Logo noch deren Wortmarke als
Produktname. Der Operator-Link wird ausschliesslich lokal in der Companion-Instanz gespeichert; es werden keine
Audio-Daten, Event-Daten oder Zugangsdaten an Dritte übertragen.

### Wichtig: Wartungsrisiko

Diese Integration basiert auf dem beobachteten Verhalten des LiveVoice-Webclients, nicht auf einer dokumentierten
öffentlichen API. LiveVoice kann die HTML-Struktur, Header oder ActionCable-Nachrichten jederzeit ohne Vorwarnung
ändern. Das Modul ist defensiv gebaut (robuster HTML-Parser statt Regex, unbekannte States werden nie geraten,
unbekannte Nachrichten werden ignoriert statt zum Absturz zu führen), aber ein Bruch bei einem LiveVoice-Update
ist grundsätzlich möglich.

### Konfiguration

- **Operator-Link** — der vollständige LiveVoice-Operator-Link (`https://livevoice.io/.../operator/<token>`).
  Wird wie ein Zugangsdaten-Geheimnis behandelt (maskiertes Eingabefeld, nicht vollständig geloggt).
- **Bevorzugter Import-Channel** — `auto` wählt automatisch den erkannten Quell-Channel (Audio ohne Untertitel,
  siehe unten). Nach der ersten erfolgreichen Verbindung wird hier automatisch ein Dropdown mit den echten
  Channels des aktuellen Events angeboten (Konfigurationsdialog dafür einmal neu öffnen).
- **Debug-Logging** — protokolliert Discovery-/Auth-/ActionCable-Details (Ping/Pong, State-Übergänge) auf
  Debug-Level. Event/Channel-Erkennung wird unabhängig davon immer auf Info-Level geloggt.

### Automatische Channel-Erkennung

Ohne explizite Auswahl (`auto`) wählt das Modul den Channel mit `hasAudio === true` und `hasSubtitles === false`.
Gibt es davon genau einen, wird er verwendet; bei mehreren wird zusätzlich der Name "Original Audio" als Hinweis
herangezogen. Bleibt die Auswahl mehrdeutig, wählt das Modul **keinen** Default - dann muss der Channel explizit
über die Channel-ID in der Action/im Feedback oder in der Konfiguration gewählt werden. Es wird nie von einer
festen Channel-ID zwischen Events ausgegangen.

### Aktionen

- **Import starten** / **Import stoppen** — mit Channel-Dropdown (`Auto / Quellkanal` oder ein konkreter Channel).
- **Import umschalten** — schaltet basierend auf dem **tatsächlichen** LiveVoice-Serverstatus um (nicht auf dem
  zuletzt gesendeten Befehl). Ist der Status unbekannt, wird die Aktion abgelehnt statt blind umzuschalten.

### Feedbacks

- **Import ist aktiv** / **Import ist inaktiv** (inaktiv **oder** offline) / **Import ist offline** / **Import-Status
  unbekannt** — basieren
  auf dem vom Server gemeldeten Status (`channel_updated`/`init_event`), nicht auf lokal ausgelösten Actions.
  Reagieren daher auch, wenn der Import im LiveVoice-Web-UI manuell gestartet/gestoppt wird.
- **LiveVoice verbunden** — aktiv, sobald die ActionCable-Verbindung offen **und** der V2Channel subscribed ist
  (nicht bereits nach erfolgreichem HTTP-Authenticate).
- **Listener-Anzahl vergleichen** — Channel + Vergleichsoperator (`=`, `>`, `<`, `>=`, `<=`) + Wert.

### Variablen

`event_name`, `event_id`, `join_code`, `connection_status`, `import_channel_name`, `import_channel_id`,
`import_state` (`active`/`inactive`/`offline`/`unknown`), `listener_count` — letztere vier beziehen sich auf den
über "Bevorzugter Import-Channel" ausgewählten bzw. automatisch erkannten Channel.

### Presets

**LiveVoice Start Import**, **LiveVoice Stop Import**, **LiveVoice Start & Stop** - alle auf `Auto / Quellkanal`,
direkt einsatzbereit.

Beide sind mehrschichtige (`layered`) Buttons mit den Key-Grafiken aus
[assets/brand/keys/](../assets/brand/keys/README-Keys.md) und einem eigenen Textlayer im mittleren Band.

- **Start Import** / **Stop Import** zeigen immer ihr jeweiliges Aktions-Icon (`key-active`/`key-idle`) - reine
  Auslöse-Buttons, kein Status-Feedback nötig.
- **Start & Stop** stapelt alle vier Zustandsbilder (`bg-idle`/`bg-active`/`bg-offline`/`bg-unknown`)
  übereinander; "idle" ist per Default sichtbar (deckt auch "inactive" ab), die anderen blenden sich per
  Feedback ein/aus. Text zeigt zusätzlich `$(livevoice:import_state)`.

### Bekannte Einschränkung (Stand 30.08.2026, bestätigt auf Companion 5.0.4)

Companion übernimmt die drei
mitgelieferten Feedbacks (`Import ist aktiv`/`inaktiv`/`unbekannt`) auf dem "Start & Stop"-Preset beim Ziehen
auf einen Button nicht automatisch - der Feedbacks-Tab bleibt leer, während Elemente und Steps korrekt
übernommen werden. Live verifiziert per JSON-Export-Vergleich (frisch gezogener vs. manuell nachgerüsteter
Button, sonst identische Elementstruktur) und reproduziert nach kompletter Neuinstallation, nach einem
Companion-Update auf 5.0.4 sowie mit mehreren strukturellen Preset-Varianten (u.a. einem einzelnen
Bild-Element statt gestapelter Layer) - der Effekt bleibt in allen Fällen gleich. Bestätigter offener Bug:
[bitfocus/companion#4410](https://github.com/bitfocus/companion/issues/4410) "Linked Preset not working with
Advanced Feedbacks" (Milestone v5.1, kein verifizierter Fix) - ein Umgehen über eine andere Preset-Struktur
hat sich nicht als möglich erwiesen. Workaround bis Companion das behebt: nach dem Ziehen des Presets einmalig
manuell drei Feedbacks hinzufügen:

- `Import ist aktiv` → `Hintergrund (idle)` Enabled aus + `Hintergrund (aktiv)` Enabled an
- `Import ist inaktiv` → `Hintergrund (aktiv)` Enabled aus + `Hintergrund (idle)` Enabled an + `Haupttext` Farbe Weiss
- `Import-Status unbekannt` → `Hintergrund (idle)` Enabled aus + `Hintergrund (unbekannt)` Enabled an

Kein eigenes `importOffline`-Feedback, da "Import ist inaktiv" laut Definition bereits "inactive" **und**
"offline" abdeckt - ein zusätzliches `importOffline`-Feedback würde sich damit überlappen und im selben
Bild-Element um den Vorrang konkurrieren. Das Bild "Hintergrund (offline)" bleibt trotzdem als Layer
vorhanden, falls manuell ein eigenes Feedback dafür ergänzt werden soll.

### Nicht implementiert (bewusst)

Audio-Wiedergabe über Janus, Chat, Untertitel-Ausgabe, Event-/Channel-Administration - dieses Modul steuert
ausschliesslich Import-Start/-Stop und liest Status/Statistik.
