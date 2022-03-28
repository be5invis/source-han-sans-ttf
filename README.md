# Source Han Sans TTF

A script for building TTF version of Source Han Sans (again).

## What you need to install

- Latest version of AFDKO
- Node.js

## To build

```bash
npm install
npm run build all
```

------

The fonts generated are named under family name "SHSTTF".

To change it, modify `config.json`'s `naming.FamilyName` entries (which influence menu names) and `prefix` property (which influences filename and PostScript name), then rebuild. Building the font may take many hours.
