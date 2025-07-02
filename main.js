const { app, Tray, Menu, BrowserWindow, shell, nativeImage } = require('electron');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server: WebSocketServer } = require('ws');
const usbDetect = require('usb-detection');
const printers = require('@agsolutions-at/printers');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const spooler = require('./spooler');
const BluetoothPrinterManager = require('./bluetooth-printer');
const fs = require('fs');

let tray = null;
let mainWindow = null;
const PORT = 8080;

function createTray() {
  console.log('createTray called');
  const isPackaged = app.isPackaged;
  let iconPath;
  let trayIcon;
  if (process.platform === 'darwin') {
    if (isPackaged) {
      iconPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'iconTemplate.png');
    } else {
      iconPath = path.join(__dirname, 'assets', 'iconTemplate.png');
    }
    if (!fs.existsSync(iconPath)) {
      // Fallback: 1x1 transparent PNG (base64)
      trayIcon = nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
      );
      console.log('Tray created with fallback empty icon');
    } else {
      trayIcon = nativeImage.createFromPath(iconPath);
      console.log('Tray created with icon:', iconPath);
    }
    tray = new Tray(trayIcon);
  } else {
    iconPath = path.join(__dirname, 'assets', 'icon.ico');
    tray = new Tray(iconPath);
    console.log('Tray created with icon:', iconPath);
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Browser',
      click: () => { shell.openExternal('http://localhost:8080'); }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ]);
  tray.setContextMenu(contextMenu);
  tray.setToolTip('InstaLabel');
}

function openUI() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: { nodeIntegration: false }
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  console.log('app.whenReady called');
  // Enable auto-launch on startup (macOS and Windows)
  app.setLoginItemSettings({ openAtLogin: true });

  // Start Express and WebSocket server
  const expressApp = express();
  expressApp.use(express.static(path.join(__dirname, 'ui')));
  const server = http.createServer(expressApp);
  const wss = new WebSocketServer({ server });

  // Bluetooth and printer logic
  const bluetoothManager = new BluetoothPrinterManager();

  // Broadcast JSON message to all connected clients
  function broadcast(obj) {
    const msg = JSON.stringify(obj);
    wss.clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
  }

  // Check printer status and notify UI
  function updateStatus() {
    const printerList = printers.getPrinters();
    const bluetoothPrinters = bluetoothManager.getDiscoveredPrinters();
    const connectedBluetoothPrinters = bluetoothManager.getConnectedPrinters();
    let connectedPrinters = 0;
    let munbynPrinter = null;
    
    // Only count printers that are actually thermal/label printers
    printerList.forEach(p => {
      if (p.name.includes('Munbyn') || p.name.toLowerCase().includes('thermal') || 
          p.name.toLowerCase().includes('label') || p.name.toLowerCase().includes('printer')) {
        connectedPrinters++;
        if (!munbynPrinter) munbynPrinter = p;
      }
    });
    
    const totalConnectedPrinters = connectedPrinters + connectedBluetoothPrinters.length;
    const connected = totalConnectedPrinters > 0;
    
    // Only include relevant printers in the list
    const relevantPrinters = printerList.filter(p => 
      p.name.includes('Munbyn') || p.name.toLowerCase().includes('thermal') || 
      p.name.toLowerCase().includes('label') || p.name.toLowerCase().includes('printer')
    );
    
    // Combine USB and Bluetooth printers into a unified list
    const allPrinters = [
      ...relevantPrinters.map(p => ({
        ...p,
        type: 'usb',
        connectionType: 'USB',
        isConnected: true
      }))
    ];
    bluetoothPrinters.forEach(bluetoothPrinter => {
      const alreadyExists = allPrinters.some(p => p.name === bluetoothPrinter.name);
      if (!alreadyExists) {
        allPrinters.push({
          ...bluetoothPrinter,
          type: 'bluetooth',
          connectionType: 'Bluetooth',
          isConnected: bluetoothPrinter.connected
        });
      }
    });
    let defaultPrinter = munbynPrinter;
    if (!defaultPrinter && allPrinters.length > 0) {
      defaultPrinter = allPrinters[0];
    }
    broadcast({
      type: 'status',
      connected,
      printerCount: totalConnectedPrinters,
      usbPrinterCount: connectedPrinters,
      bluetoothPrinterCount: bluetoothPrinters.length,
      connectedBluetoothCount: connectedBluetoothPrinters.length,
      printers: allPrinters,
      defaultPrinter: defaultPrinter
    });
  }

  // Bluetooth event handlers
  bluetoothManager.on('printerDiscovered', (printer) => { updateStatus(); });
  bluetoothManager.on('printerConnected', (printer) => { updateStatus(); });
  bluetoothManager.on('printerDisconnected', (printer) => { updateStatus(); });
  bluetoothManager.on('scanComplete', (printers) => { updateStatus(); });

  // Notify UI whenever the queue changes
  spooler.setStatusCallback(() => {
    const queue = spooler.getQueue();
    broadcast({ type: 'queue', jobs: queue });
  });

  // Handle incoming WebSocket connections
  wss.on('connection', ws => {
    updateStatus();
    ws.on('message', async (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.type === 'print' && Array.isArray(data.images)) {
          for (let base64png of data.images) {
            broadcast({ type: 'image', image: base64png });
            spooler.addJob(base64png, data.selectedPrinter, data.watermarkText);
          }
        } else if (data.type === 'scan_bluetooth') {
          await bluetoothManager.scanForOSBluetoothPrinters();
          broadcast({ type: 'bluetooth_scan_complete' });
        } else if (data.type === 'refresh_bluetooth') {
          await bluetoothManager.refreshPrinterStatus();
          updateStatus();
        }
      } catch (err) {
        console.error('Error handling message:', err);
      }
    });
    ws.on('close', () => {});
  });

  // USB detection for plug/unplug events
  usbDetect.startMonitoring();
  usbDetect.on('add', () => { updateStatus(); });
  usbDetect.on('remove', () => { updateStatus(); });

  // Start server
  server.listen(PORT, () => {
    updateStatus();
    setTimeout(async () => {
      await bluetoothManager.scanForOSBluetoothPrinters();
      updateStatus();
      bluetoothManager.startStatusMonitoring(10000);
    }, 2000);
  });

  // Tray (Menu Bar) Icon
  // For best results on macOS, use a black & transparent PNG template icon (iconTemplate.png)
  createTray();

  // Optionally open UI on start
  // openUI();

  // Graceful shutdown
  app.on('before-quit', () => {
    bluetoothManager.cleanup();
    usbDetect.stopMonitoring();
    server.close();
  });
}); 