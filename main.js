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
  expressApp.use(express.static(path.join(__dirname, 'public')));
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
    console.log('DEBUG: Detected printers:', printerList);

    const bluetoothPrinters = bluetoothManager.getDiscoveredPrinters();
    const connectedBluetoothPrinters = bluetoothManager.getConnectedPrinters();
    
    // Filter for Munbyn or thermal printers (USB)
    let connectedPrinters = 0;
    let munbynPrinter = null;
    
    printerList.forEach(p => {
      if (p.name.includes('Munbyn') || p.name.toLowerCase().includes('thermal')) {
        connectedPrinters++;
        if (!munbynPrinter) munbynPrinter = p;
      }
    });
    // Fallback: if no Munbyn/thermal printers found, count all printers
    if (connectedPrinters === 0 && printerList.length > 0) {
      connectedPrinters = printerList.length;
    }
    
    // Add Bluetooth printers to the count
    const totalConnectedPrinters = connectedPrinters + connectedBluetoothPrinters.length;
    const connected = totalConnectedPrinters > 0;

    // Debug: Log detailed printer info
    console.log(`Found ${connectedPrinters} USB printer(s) and ${bluetoothPrinters.length} Bluetooth printer(s)`);
    console.log(`Connected: ${connectedPrinters} USB + ${connectedBluetoothPrinters.length} Bluetooth`);
    console.log('=== USB Printers ===');
    printerList.forEach(p => {
      console.log(`Printer: ${p.name}`);
      console.log(`  System Name: ${p.systemName}`);
      console.log(`  Driver: ${p.driverName}`);
      console.log(`  State: ${p.state}`);
      console.log(`  Location: ${p.location}`);
      console.log(`  Is Default: ${p.isDefault}`);
      console.log('---');
    });
    console.log('=== Bluetooth Printers ===');
    bluetoothPrinters.forEach(p => {
      console.log(`Printer: ${p.name}`);
      console.log(`  Address: ${p.address}`);
      console.log(`  RSSI: ${p.rssi}dBm`);
      console.log(`  Connectable: ${p.connectable}`);
      console.log(`  Connected: ${connectedBluetoothPrinters.some(cp => cp.id === p.id)}`);
      console.log('---');
    });
    
    // Combine USB and Bluetooth printers into a unified list
    const allPrinters = [
      ...printerList.map(p => ({ 
        ...p, 
        type: 'usb',
        connectionType: 'USB',
        isConnected: true // USB printers are always connected if detected
      }))
    ];
    
    // Add Bluetooth printers that aren't already in the main printer list
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
    
    // Determine default printer (prefer USB Munbyn, then first available)
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
  usbDetect.on('add', () => { console.log('USB device added'); updateStatus(); });
  usbDetect.on('remove', () => { console.log('USB device removed'); updateStatus(); });

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