# Nebula Doc

A Windows x64 Electron application for editing **binary Word 97–2003 `.doc` files**. Built with React, TypeScript, Tailwind, Lucide and TipTap. Documents are processed locally by an isolated LibreOffice/UNO worker. No account, cloud service, Microsoft Word installation or backend is required.

## Licence

Nebula Doc's original application code is licensed under the [MIT License](LICENSE), copyright 2026 Nebula Doc contributors. Bundled third-party software retains its own licences. In particular, LibreOffice is distributed under MPL 2.0 and includes components with additional terms; it is not relicensed as MIT. See [third-party notices and source availability](THIRD_PARTY_NOTICES.txt).

Windows builds include Nebula's MIT licence and the source-availability notice in `resources/licenses/`, alongside the existing LibreOffice and Electron licence notices. The original 0.1.0 installer predates these additions; use version 0.1.1 or later to include them.

## Run

Requires Node.js 22.12+ and pnpm. On Windows:

```powershell
pnpm install
pnpm setup:engine
pnpm dev
```

The engine setup downloads the official LibreOffice 26.8.1 Windows x64 installer, verifies its SHA-256 and extracts it into `.cache/libreoffice`. It does not install LibreOffice system-wide. The download is approximately 358 MB. `NEBULA_LIBREOFFICE` can instead point to an existing LibreOffice installation with `program/python.exe` and `program/soffice.exe`.

For the compiled desktop app, run `pnpm build` followed by `pnpm start`. `pnpm dev:web` shows the interface in a browser; native file operations are available only in Electron.

The engine starts in the background and warms its binary Word filter using a generated scratch document. Its private profile is reused under the application's user-data directory, separate from a normal LibreOffice installation. A single-instance lock prevents two copies of this app sharing that profile. The first open immediately after launch can still include initialization; later opens use the running engine. Text/font/bookmark traversal and edits run inside an application-owned Python UNO component in LibreOffice, with one JSON exchange per operation. Document-provided macros remain disabled. The startup message reports initialization until it has actually completed.

## Editing

- Open existing binary `.doc` files with the native file picker.
- Edit body text and text inside existing table cells.
- Change font family, point size, bold, italic, underline and text color.
- Navigate, create, rename and delete body bookmarks. Both text-range and cursor-position bookmarks are supported. Bookmark endpoints move with the editor content.
- Undo/redo, zoom, bookmark search, Save and Save a copy.
- Save real binary `.doc` files using LibreOffice's `MS Word 97` filter. The saved file's compound-file signature is verified before replacing the destination.
- A `.doc.bak` copy is created before the first overwrite of an existing destination. An external modification check protects the currently opened source file.
- Unsaved changes prompt before opening another file or closing the app.

**`.docx` is deliberately unsupported**, including renamed ZIP-based `.docx` files. RTF and HTML files renamed to `.doc` are also rejected. The input must have a `.doc` extension and an OLE compound-file header, and must load through the legacy Word filter. This version targets Word 97–2003 binary documents; earlier Word binary variants and encrypted files are not supported.

## Scope and fidelity

This is a focused document editor, not a complete Word replacement. The continuous editing view approximates table widths and does not reproduce Word's pagination. Existing paragraph and table structure is retained; Enter inserts an in-paragraph line break. Structural table editing, adding/removing paragraphs, printing and creating new documents are outside the current scope.

Paragraphs containing native fields or inline embedded objects are read only. Text around floating frames anchored to a paragraph or character is editable; the frames themselves remain in the underlying document. Headers, footers, drawings, page settings and bookmarks outside the editable body remain in the underlying LibreOffice document. Their exact appearance can vary when Word and LibreOffice lay out a document differently. Review important layouts in Word before distributing edited documents. The app does not claim byte-identical preservation of unsupported Word features, VBA or digital signatures.

The provided loan agreement was tested locally: 7 source pages, 255 body paragraphs and 36 bookmarks (33 mapped into the editable body; 3 retained outside it). The attachment is never bundled into the application or committed as a fixture.

## Verify

```powershell
pnpm test
pnpm build
pnpm test:sample 'C:\path\to\sample.doc'
pnpm test:signature 'C:\path\to\sample.doc'
pnpm test:electron 'C:\path\to\sample.doc'
```

The unit tests check styled text and bookmark positions across UTF-16 text, emoji, line breaks and table cells, as well as concurrent engine starts and cancellation before spawn. The engine integration test changes text and all supported font properties, creates/renames/deletes bookmarks, saves twice and reopens the document, checks bookmark count and the binary signature, rejects `.docx`, and verifies that the source attachment is unchanged. The signature regression runs inside the same in-process component used in production, verifies frame contents/size/anchor type and all bookmarks after saving and reopening, and also runs Python guard tests. The Electron test edits the signature label through the actual desktop UI and native bridge, saves a copy, and reopens it. Test documents and screenshots are written to ignored `test-output/`.

With `NEBULA_TEST_EXECUTABLE` pointing to the packaged app, run `node scripts/performance-smoke.mjs 'C:\path\to\sample.doc'` for the supplied sample. It records first-launch and relaunch openings separately, then checks that later openings and openings after initialization take under three seconds through the real editor UI. The native file picker is stubbed so time spent choosing a file is excluded. Measurements are written to `test-output/document-open-performance.json`; they apply to the tested document and machine, not arbitrary files or hardware.

## Build a Windows installer

```powershell
pnpm setup:engine
pnpm dist:win
```

On the local `experiment/slim-package` branch, the current NSIS installer is written to `release/fast-open/Nebula-Doc-Slim-Experiment-Setup-0.1.2-slim.2.exe`. It updates **Nebula Doc Slim Experiment**, with separate application identity, shortcuts and Electron application-data directory from the standard Nebula Doc installation. The earlier packaging-only build remains under `release/slim-experiment`. The installer is unsigned unless signing credentials are provided through electron-builder's standard signing configuration.

The packaging hook stages a reduced engine in `.cache/libreoffice-slim` without changing the full engine in `.cache/libreoffice`. It retains all native libraries/executables and fonts, the English dictionary bundle, English UI resources, Colibre themes and core document configuration. It excludes other UI translations/dictionaries, optional extensions, offline help, galleries, templates/wizards, surplus icon themes and generated Python bytecode. Electron ships only its `en-US` and `en-GB` locale packs. Text in other languages and its encoding support are retained, but their local UI translations and dictionary/hyphenation resources are absent in this experiment. Layout of multilingual documents needs local review.

The hook writes a file-by-file audit with SHA-256 hashes to `.cache/slim-package-audit.json`. After packaging, every retained engine file is verified against that audit; the packaged summary is in `resources/licenses/slim-package-summary.json`. Original third-party notices for retained resources are preserved. Version `0.1.2-slim.1` isolated packaging changes; `0.1.2-slim.2` additionally improves startup and the document bridge as described above. LibreOffice's own native files are unchanged in both builds.

`pnpm package:engine` stages the reduced runtime independently. Development commands still use the full cached engine by default; set `NEBULA_LIBREOFFICE` to the absolute `.cache/libreoffice-slim` path to test the reduced one during development. Test the packaged application using `NEBULA_TEST_EXECUTABLE` and the existing Electron smoke script. The previous installers under `release/v0.1.1` are preserved.

LibreOffice's license and third-party notices are included in the runtime distribution (`resources/libreoffice/license.txt`, `LICENSE.html`, `NOTICE` and `readmes/`). See the [LibreOffice license](https://www.libreoffice.org/licenses/) for redistribution terms and [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) for the version-specific source downloads. The app uses LibreOffice's documented [legacy Word conversion filter](https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html). Electron's renderer is sandboxed with context isolation and a narrow preload API; native macros and document link updates are disabled.
