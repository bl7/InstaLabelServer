# Print Server App (Electron)

A cross-platform desktop print server for Munbyn and compatible USB/Bluetooth thermal label printers. Built with Electron, Express, and WebSocket, it provides a local web UI and system tray integration for Windows and macOS.

## Features

- 🖨️ Print server for USB and Bluetooth thermal label printers
- 🌐 Local web UI for printer status, queue, and label preview
- 🔌 Real-time USB plug/unplug detection
- 📱 OS-level Bluetooth printer support
- 🖥️ System tray with quick actions (Open UI, Show Status, Quit)
- 🚀 Auto-starts on system login (Windows & Mac)
- 🗂️ Multi-label print jobs and printer selection
- 🛠️ Easy packaging for Windows (NSIS) and Mac (DMG/PKG)

## Requirements

- Node.js v16 or newer
- Munbyn or compatible USB/Bluetooth thermal printer
- Printer drivers installed (for USB)
- Bluetooth enabled (for Bluetooth printers)

## Project Structure

```
print-server-app/
├── package.json
├── main.js                # Electron main process (Express, WS, tray)
├── spooler.js             # Print job queue and PDF logic
├── bluetooth-printer.js   # Bluetooth printer management
├── /ui                    # Web UI (HTML/JS/CSS)
├── /assets                # App/tray icons (add icon.ico, icon.icns)
└── /node_modules
```

## Setup & Development

1. **Install dependencies:**
   ```sh
   npm install
   ```
2. **Rebuild native modules (if needed):**
   ```sh
   npx electron-rebuild
   ```
   (Or rely on the `postinstall` script.)
3. **Add icons:**
   - Place `icon.ico` (Windows) and `icon.icns` (Mac) in the `assets/` folder.
4. **Run the app:**
   ```sh
   npm start
   ```
   The app will start in the background (tray) and serve the UI at [http://localhost:8080](http://localhost:8080).

## Building Installers

- **Windows (NSIS .exe):**
  ```sh
  npm run dist:win
  ```
- **macOS (DMG/PKG):**
  ```sh
  npm run dist:mac
  ```
- Output installers will be in the `/dist` folder.

## Usage

- **Web UI:**
  - Visit [http://localhost:8080](http://localhost:8080) for printer status, queue, and label preview.
- **Tray Menu:**
  - Right-click the tray icon for quick actions (Open UI, Show Status, Quit).
- **Auto-Launch:**
  - The app auto-starts on login. Disable by removing the `auto-launch` logic in `main.js` if desired.

## Print Job API

Send print jobs via WebSocket to `ws://localhost:8080`:
```json
{
  "type": "print",
  "images": ["<base64-encoded PNG>", ...],
  "selectedPrinter": "Printer Name (optional)",
  "watermarkText": "Optional watermark"
}
```

## Troubleshooting

- **Unsigned Mac builds:**
  - Gatekeeper may block the app. Right-click > Open or allow in System Preferences > Security.
- **Native module errors:**
  - Run `npx electron-rebuild` after `npm install`.
- **Printer not detected:**
  - Ensure drivers are installed and the printer is visible in your OS printer list.
- **Bluetooth printers:**
  - Pair and connect the printer in your OS before starting the app.

## Credits

- [Electron](https://www.electronjs.org/)
- [Express](https://expressjs.com/)
- [@agsolutions-at/printers](https://www.npmjs.com/package/@agsolutions-at/printers)
- [usb-detection](https://www.npmjs.com/package/usb-detection)
- [pdf-lib](https://pdf-lib.js.org/)
- [auto-launch](https://www.npmjs.com/package/auto-launch)

## Setup Tray Icon Assets

1. **Create the assets folder:**
   ```sh
   mkdir assets
   ```
2. **Add tray icon files:**
   - Place `icon.icns` (for Mac) and `icon.ico` (for Windows) in the `assets/` folder. These are required for the tray icon to appear.
   - You can use any 256x256 PNG converted to `.icns` or `.ico` format. [Online converters](https://iconverticons.com/online/) are available.

---

**MIT License** 