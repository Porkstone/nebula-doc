# Changelog

## 1.0.1

- Reduce the installer from about 500 MB to about 290 MB (476.5 MiB to 272.9 MiB) by leaving out LibreOffice components the headless document engine does not use: spelling, hyphenation and thesaurus dictionaries and other bundled extensions, interface translations, translated configuration labels, alternative icon themes and PDF import. Document opening, editing and saving are unchanged. LibreOffice messages are shown in English.

## 1.0.0

- Show table cell shading in the editing view. Light text on a shaded cell, such as a white disclaimer on a blue footer, was previously invisible. The shading is display-only and is preserved unchanged when saving.
- Rename the Windows application to `nebula-doc`. The installer is now `nebula-doc-<version>.exe`, the installed executable is `nebula-doc.exe`, and the installer installs for all users.
- Show the application version from `package.json` in the status bar.
- Add a Chocolatey package (`nebula-doc`) and release instructions.

## 0.1.1

- Include Nebula Doc's MIT licence and the third-party source-availability notice in Windows builds.
- Allow editing text beside floating signature frames.

## 0.1.0

- Initial release: open, edit and save binary Word 97–2003 `.doc` files with text, font and bookmark editing.
