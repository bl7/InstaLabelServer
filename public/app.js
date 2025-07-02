const statusElem = document.getElementById('printer-status');
const previewDiv = document.getElementById('preview');
const queueDiv = document.getElementById('queue');
const printerListDiv = document.getElementById('printer-list');

// Connect to WebSocket (same host/port)
const ws = new WebSocket(`ws://${location.host}`);

// Printer state
let allPrinters = [];
let selectedPrinter = null;

ws.onopen = () => {
  console.log('WebSocket connected');
};

ws.onmessage = event => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'status') {
    const statusText = msg.connected ? 
      `Connected (${msg.printerCount} printer${msg.printerCount > 1 ? 's' : ''})` : 
      'Disconnected';
    statusElem.textContent = statusText;
    statusElem.style.color = msg.connected ? 'green' : 'red';
    
    // Update printer list
    if (msg.printers) {
      allPrinters = msg.printers;
      updatePrinterList();
    }
    
    // Set default printer if available
    if (msg.defaultPrinter && !selectedPrinter) {
      selectedPrinter = msg.defaultPrinter;
      updatePrinterList();
    }
  }

  else if (msg.type === 'image') {
    // New label image arrived: display preview
    const img = document.createElement('img');
    img.src = 'data:image/png;base64,' + msg.image;
    img.style.maxWidth = '150px';
    img.style.margin = '5px';
    previewDiv.appendChild(img);
  }

  else if (msg.type === 'queue') {
    // Update the queue display
    queueDiv.innerHTML = '<h3>Print Queue:</h3>';
    msg.jobs.forEach(job => {
      const line = document.createElement('div');
      line.textContent = `Job ${job.id}: ${job.status}`;
      queueDiv.appendChild(line);
    });
  }
};

ws.onclose = () => {
  statusElem.textContent = 'Disconnected';
  statusElem.style.color = 'red';
};

// Update printer list in UI
function updatePrinterList() {
  printerListDiv.innerHTML = '';
  
  if (allPrinters.length === 0) {
    printerListDiv.innerHTML = '<p>No printers found.</p>';
    return;
  }

  allPrinters.forEach(printer => {
    const printerDiv = document.createElement('div');
    printerDiv.className = 'printer-item';
    
    // Add status classes
    if (selectedPrinter && selectedPrinter.name === printer.name) {
      printerDiv.classList.add('selected');
    }
    
    if (printer.isConnected) {
      printerDiv.classList.add('connected');
    } else {
      printerDiv.classList.add('disconnected');
    }

    const headerDiv = document.createElement('div');
    headerDiv.className = 'printer-header';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'printer-name';
    nameDiv.textContent = printer.name;

    const typeDiv = document.createElement('div');
    typeDiv.className = `printer-type ${printer.type}`;
    typeDiv.textContent = printer.connectionType || printer.type.toUpperCase();

    headerDiv.appendChild(nameDiv);
    headerDiv.appendChild(typeDiv);

    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'printer-details';
    
    // Build details based on printer type
    let details = '';
    if (printer.type === 'usb') {
      details = `
        System Name: ${printer.systemName || 'N/A'}<br>
        Driver: ${printer.driverName || 'N/A'}<br>
        Location: ${printer.location || 'N/A'}<br>
        State: ${printer.state || 'N/A'}
      `;
    } else if (printer.type === 'bluetooth') {
      details = `
        Address: ${printer.address || 'N/A'}<br>
        RSSI: ${printer.rssi || 'N/A'}dBm<br>
        Connectable: ${printer.connectable ? 'Yes' : 'No'}
      `;
    }
    detailsDiv.innerHTML = details;

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'printer-actions';

    // Connection status
    const statusDiv = document.createElement('div');
    statusDiv.className = `connection-status ${printer.isConnected ? 'connected' : 'disconnected'}`;
    statusDiv.innerHTML = `
      <span class="status-dot"></span>
      ${printer.isConnected ? 'Connected' : 'Disconnected'}
    `;
    actionsDiv.appendChild(statusDiv);

    // Select button
    const selectBtn = document.createElement('button');
    selectBtn.className = 'select';
    if (selectedPrinter && selectedPrinter.name === printer.name) {
      selectBtn.textContent = 'Selected';
      selectBtn.classList.add('selected');
    } else {
      selectBtn.textContent = 'Select';
    }
    
    selectBtn.onclick = () => {
      selectedPrinter = printer;
      updatePrinterList();
      console.log(`Selected printer: ${printer.name} (${printer.type})`);
    };
    
    actionsDiv.appendChild(selectBtn);

    printerDiv.appendChild(headerDiv);
    printerDiv.appendChild(detailsDiv);
    printerDiv.appendChild(actionsDiv);
    printerListDiv.appendChild(printerDiv);
  });
}

// Auto-reconnect on connection loss
setInterval(() => {
  if (ws.readyState === WebSocket.CLOSED) {
    console.log('Attempting to reconnect...');
    location.reload();
  }
}, 5000);