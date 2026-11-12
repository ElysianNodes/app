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

## Updates

The installed Windows app checks GitHub Releases for updates when it starts. You can also check from **Settings → Software updates**, download an available update, and restart to install it. Updates are offered only by published GitHub releases.

To publish a release, update the version in `package.json`, commit the matching `package-lock.json`, then push a matching version tag such as `v1.0.1`. GitHub Actions builds the Windows installer and publishes the release files and update metadata. The first updater-enabled version must be installed manually; later versions can update through the app.

## License

This project is licensed under the GNU General Public License v3.0 only. See [LICENSE](LICENSE) for the full terms.
