# Our Gear

Purchases, receipts and warranties for everything we own, at home and at the rentals.
Offline Android web app. Records live on the phone and sync through Dropbox.

**Version 1.0** · App: https://sskehan.github.io/ourgear/

## Files to upload to the repo

- `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `README.md`
- `icons/` folder: `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`

The `src/` folder holds the same code split into parts for editing. It doesn't need to be uploaded.

## Dropbox app settings

- Access type: App folder
- Redirect URI: `https://sskehan.github.io/ourgear/`
- Allow public clients (Implicit Grant & PKCE): Allow
- Permissions: files.metadata.read, files.metadata.write, files.content.read, files.content.write

## Dropbox folder layout

- `data/ourgear-data.json`: all records
- `Inbox/`: files not yet filed to an item
- `Files/<Property>/<Item>/`: filed receipts, invoices, manuals and photos
- `Archive/<year>/<Property>/<Item>/`: archived items' files
- `.thumbs/`: small previews
