# Blockschmiede Web App API

Eine minimalistische, sichere Node.js REST-API ohne Frontend. Derzeit wird nur ein Endpoint bereitgestellt, um neue Bestellungen anzulegen.

## Voraussetzungen

- Node.js \>= 18
- Eine konfigurierte `.env`-Datei (siehe `.env.example`)

## Einrichtung

1. Abhängigkeiten installieren:
   ```bash
   npm install
   ```
2. `.env` anlegen:
   ```bash
   cp .env.example .env
   # ggf. PORT anpassen
   ```
3. Entwicklung starten:
   ```bash
   npm run dev
   ```
4. Produktiv starten:
   ```bash
   npm start
   ```

## API

### `POST /api/orders`

- Erwartet einen JSON-Body mit den Bestelldaten.
- Der Inhalt wird aktuell nur serverseitig protokolliert.
- Antwort: `201 Created` mit `{ "status": "received" }`.

Nicht erlaubte Methoden auf diesem Pfad liefern `405 Method Not Allowed`.
