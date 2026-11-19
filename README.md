# Our Gear

Purchases, receipts and warranties for everything we own, at home and at the rentals.
Offline Android web app. Records live on the phone and sync through Dropbox.

**Version 1.06** · App: https://sskehan.github.io/ourgear/

## Files to upload to the repo

- `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `README.md`
- Icons: `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`
- Receipt reader (v1.01): `tesseract.min.js`, `worker.min.js`, `tesseract-core-simd-lstm.wasm.js`, `eng.traineddata.gz`
- PDF viewer (v1.02): `pdf.min.mjs`, `pdf.worker.min.mjs`, `openjpeg.wasm`, `jbig2.wasm`
- PDF maker (v1.03): `pdf-lib.min.js`

All files go in the main folder of the repo. No subfolders needed.

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

## Version history

- 1.11: viewing a receipt or photo from its details no longer loses what you'd typed (date, store, total, kind); the details come back when you close the picture
- 1.10: several items on one receipt (one screen, one row per item, running total against the receipt; the receipt is stored once and shows on every item); add a receipt to another item, remove it from one item, and archiving or deleting one item keeps the receipt for the others; forms are no longer cleared when a sync finishes while you're typing
- 1.09: Send to Our Tax hands the details and receipt straight to Our Tax (needs Our Tax 1.05, both apps installed from the same browser), sends it to the person the item belongs to, and shows the item as In Our Tax once saved there
- 1.08: faster with thousands of items (Items list shows 100 at a time with Show more), sync skips the download when nothing changed, data file stored compressed. Update both phones on the same day
- 1.07: full app name in the header (sync status moved underneath), easier-to-read text in a few colour schemes, clearer sync error
- 1.06: item count on Home; five more colour schemes including a dark one; Edit picture for saved photos (crop, rotate, straighten, switch to black and white), replacing the file in Dropbox and refreshing the other phone
- 1.05: Snap asks what you're adding (receipt, item photo, other document); item photos saved in colour with no form; boxes shown depend on the kind of file; "Belongs to" uses an editable people list (Settings > Lists) with a filter on Items
- 1.04: fault report PDF (when and how it was reported, every follow-up, gaps with no contact), follow-up dates shown on Home, who-contacted-whom on updates, claim summary panel, new icons, Home tiles open matching lists, warranty filter on Items, service jobs screen, clearer forms
- 1.03: claims and fault log (Claims tab, timeline with tickets, contacts and attachments), one-tap claim pack PDF, insurance inventory (PDF and spreadsheet), service jobs with due dates, Send to Our Tax for work items
- 1.02: view PDFs and photos inside the app (pages, zoom), PDF previews in lists, read store/date/total from PDF invoices, crop a receipt out of any PDF page (kept together with the PDF), share any file type to the app
- 1.01: receipt reading on the phone (store, date, total), share notes and several files at once with details picked up from the note text, Evernote .enex import with review queue (Lifetime / Last 5 years / Older piles, duplicate check, merge, archive older in one go)
- 1.0: first release
