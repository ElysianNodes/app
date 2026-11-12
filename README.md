# ElysianNodes

ElysianNodes is a desktop client hub for the ElysianNodes billing area, game panel, and webhosting panel. It is built with Electron.

## Requirements

- Node.js and npm
- Windows for building the Windows installer

## Run locally

```powershell
npm install
npm start
```

For development mode:

```powershell
npm run dev
```

## Build

Create an unpacked application:

```powershell
npm run pack
```

Build the Windows installer:

```powershell
npm run dist
```

The installer is written to `dist/` and is excluded from version control.

## License

This repository does not currently include an open source license. All rights are reserved unless the project owner states otherwise.
