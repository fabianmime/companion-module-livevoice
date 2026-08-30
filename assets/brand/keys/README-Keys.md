# Companion Key-Backgrounds — LiveVoice Remote

Textfreie Hintergründe, vier Zustände. 72 × 72 px PNG (Companion / Stream Deck Standard),
zusätzlich `-144.png` (@2x) für XL / Plus.

| Datei | Zustand | Balken | Statusstreifen unten |
| --- | --- | --- | --- |
| `key-active.png` | Audio-Import läuft | orange, volle Höhe | volle Fläche `#F56230` |
| `key-idle.png` | verbunden, Import aus | grau, volle Höhe | gedämpft `#3A444B` |
| `key-offline.png` | kein Operator-Link | flache Punktreihe | schraffiert |
| `key-unknown.png` | Status unbekannt | grau, halbe Höhe | gestrichelt |

## Aufbau
- Keine Rundung, kein Rand, kein Glanz — quadratische Vollfläche, Companion rundet selbst.
- Kein Text im Bild: die Beschriftung kommt aus dem Companion-Textlayer.
- Statusstreifen unten ≈ 6 % der Höhe — trägt den Zustand, nie entfernen.
- Mittlere 60 % der Höhe bleibt für den Textlayer frei.

## Verwendung in Companion
Button → *Appearance → PNG background image* → passendes 72-px-PNG laden,
Text darüber. Die vier Dateien über das Import-Status-Feedback umschalten.
