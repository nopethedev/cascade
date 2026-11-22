# Office Export Compatibility Audit

- **Date:** 2026-11-22
- **Renderer:** LibreOffice **26.8.2.2** (`soffice`, headless; en-GB AppImage build from Portable-Linux-Apps, based on The Document Foundation's 26.8.2.2 Debian packages)
- **Test origin:** local Cascade server on port 3000, real `/api/upload`, `/api/images/search`, `/api/images/proxy`, `/api/workspace/docs` create/update, and `/download/:id` routes.
- **Images:** one direct stored upload (`cascade-test-image.png`, PNG 640×400) and one Wikimedia Commons result selected through Cascade's image search (`Red Panda.JPG`, JPEG 960×640, credit retained).
- **Important:** Microsoft Word, Excel and PowerPoint are not installed here. LibreOffice is a genuine independent office application, but this is not an actual Microsoft Office rendering test.

## Reproducing the renderer

There was no `soffice`/`libreoffice` on `PATH`, and this cloud account has no root or usable `sudo`, so `apt-get install` was not possible. LibreOffice was run from an extracted LibreOffice 26.8.2.2 AppImage with its small Ubuntu library dependency set extracted under `/tmp` (no project or system files changed). Version:

```text
LibreOffice 26.8.2.2 9dea406ab7695df6325b11b0e19fdca8db4b7276
```

The exact commands used for each file were:

```bash
soffice -env:UserInstallation=file:///tmp/lo-profile --headless --nologo \
  --nofirststartwizard --convert-to pdf --outdir /tmp/out file.ext
```

`soffice` also converted the DOCX to `.txt` and the XLSX to CSV. No conversion process returned a non-zero exit status.

## Files created through the app

All three were created with `POST /api/workspace/docs` and populated with `PUT /api/workspace/docs/:id`, the same API used by editor autosave. The formats were then downloaded with the normal authenticated download route.

| Kind | App file | Content checked |
|---|---|---|
| Document | `QA Office Render Document` (`zC9dj9RKecr8`) | h1/h2 headings, body text, a 3-row table with header, a bullet list, header/footer, and both images with captions |
| Spreadsheet | `QA Office Render Sheet` (`cw6yQNBDPo6F`) | bold/tinted title row, channel table, `=SUM(B4:B5)` formula, explanatory text, and both images |
| Presentation | `QA Office Render Deck` (`xn5KlJ-jt0Jf`) | heading, subtitle, two images with credits, and speaker notes |

The direct stored image and the Wikimedia-selected image were uploaded separately; the latter's credit was:

```text
Red Panda.JPG — User Bernard Landgraf on de.wikipedia.org (CC BY-SA 3.0), Wikimedia Commons
```

Sheet insert/remove/reload was also exercised in the actual browser editor: **+ Image** opened the shared library, adding an owned image created a third gallery card, removing it returned to two, and a reload retained both API-created images.

## Observed results

| Export | LibreOffice open | Render result |
|---|---|---|
| `QA Office Render Document.docx` | Writer, converted to PDF and TXT | **2 pages**, **2 image blocks**, header/footer on both pages, both headings, table rows (`Check / Expected`, `Table / Borders and text`), list items, both captions, and `End of document.` No blank trailing page. |
| `QA Office Render Sheet.xlsx` | Calc, converted to PDF and CSV | **1 landscape page**, **2 image blocks** at approximately 235×147 pt and 235×156 pt, title bar, channel values, and `Total / 2000`. Formula XML contains `<f>SUM(B4:B5)</f>`; cached/rendered result is `2000`. |
| `QA Office Render Deck.pptx` | Impress, converted to PDF | **1 slide**, **2 image blocks**, heading and subtitle, both credits, and no missing text. `python-pptx` additionally reads `Cascade Office QA deck notes` from the speaker notes. |

The PDF text extraction showed a harmless kerning split in the word “Office” (`Offic e`) in the document heading; the rendered page and LibreOffice's own TXT export both show “Office” correctly. Images were confirmed both as PDF image blocks and visually in rendered page PNGs.

## Defects found and fixed

1. **Spreadsheets had no image model or export.** Added per-sheet `images` to the sheet editor, the shared image-library button and gallery, and XLSX drawing/media generation.
2. **XLSX export crashed with `Cannot read properties of undefined (reading 'tl')`.** ExcelJS uses `workbook.addImage(image)` returning an id, then `worksheet.addImage(id, range)`; the export had incorrectly passed the image object directly to the worksheet.
3. **XLSX images were clipped on a portrait print page.** The workbook now uses a landscape, fit-to-width print setup. Both images fit on one rendered page; `fitToHeight` is left automatic so large workbooks are not forced onto one page.
4. **DOCX could produce a blank trailing page.** Trailing empty editor-generated paragraphs are now omitted from the document body (interior blank paragraphs are retained for spacing); the final document retains content on both pages.
5. **Formulas and cell formatting were weak in XLSX.** Exported cells now retain bold/italic/color/fill/alignment, and formulas are written as formulas with their computed cache value rather than as plain strings.

| Defect | Reproduction | Expected | Actual (before fix) | Severity |
|---|---|---|---|---|
| Sheet images unsupported | Create a sheet; look for image insertion | Image library and XLSX image | No sheet image path at all | High — missing feature |
| XLSX 500 | PUT sheet content with `images`, then `GET /download/:id` | XLSX | 500, then `Cannot read properties of undefined (reading 'tl')` | High — data cannot be exported |
| Clipped/blank XLSX print | Open the XLSX in LibreOffice → PDF | Both images fully visible | One image clipped to a narrow strip; extra page | Medium — render incomplete |
| DOCX trailing blank page | Export a document whose content ends with an editor-generated empty paragraph | Only content pages | Blank final page | Medium — visible compatibility defect |
| Formula/format loss | Export a sheet containing `=SUM(...)`, bold/fill cells | Formula and styles retained | Plain computed text, default styling | Medium — fidelity loss |

## Automated regression coverage

`test/office-render.test.mjs` builds a DOCX, XLSX and PPTX with text, a table, a formula, an image, slide notes, and a trailing editor-style empty paragraph. It checks the required media parts, formula XML and notes XML, then — when `SOFFICE_BIN` is set — invokes LibreOffice, requires successful PDF conversion, requires an image XObject in each PDF, asserts the DOCX remains one content page (catching a reintroduced blank page), and checks extracted DOCX text and XLSX CSV values through LibreOffice's own filters. A failed conversion fails the test; without an office binary the test is explicitly skipped, not claimed as passed.

Verified commands:

```bash
npm test
# 3 passed; external-render test skipped

SOFFICE_BIN=/tmp/squashfs-root/AppRun npm test
# 4 passed; external renderer ran all three conversions
```

## Remaining limitations

- **Genuine Microsoft Word/Excel/PowerPoint was not tested.** LibreOffice 26.8.2.2 is the strongest independent renderer available in this environment. Font substitution and exact pagination can differ from Microsoft Office.
- **No import/round-trip editing test.** The files were opened and rendered by LibreOffice; they were not edited there and saved back into Cascade.
- **The renderer is not vendored in the repository.** CI without `SOFFICE_BIN` skips the external gate. Set it to a real `soffice`/`libreoffice` binary to enforce the gate.
- **XLSX image anchors use the standard oneCell drawing anchor.** LibreOffice renders them correctly. `openpyxl` does not expose oneCell-anchored images in its `_images` helper and warns that its DrawingML support is incomplete; this is an openpyxl parser limitation, not a missing XLSX drawing part.
- **Unsupported legacy image types** (for example WebP/GIF already stored in content) are skipped by the DOCX/PPTX/XLSX embedders; new image-library uploads are normalized to PNG/JPEG.
- Large-workbook stress testing and genuine Microsoft Office repair-prompt testing remain open.
