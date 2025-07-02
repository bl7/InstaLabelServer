// spooler.js
const printers = require('@agsolutions-at/printers');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { rgb } = require('pdf-lib');

// Simple in-memory job queue
const jobQueue = [];
let isPrinting = false;
let statusCallback = () => {};

function setStatusCallback(cb) {
  statusCallback = cb;
}

function getQueue() {
  return jobQueue.map((job, index) => ({
    id: job.id,
    status: job.status,
    position: index,
  }));
}

async function pngToPdf(pngBuffer, watermarkText = null) {
  const pdfDoc = await PDFDocument.create();
  const pngImage = await pdfDoc.embedPng(pngBuffer);
  
  // Calculate paper size in points (1 point = 1/72 inch)
  // Munbyn printer is 203 DPI, width is 5.6cm (56mm)
  const printerWidthMm = 56; // 5.6cm width
  const printerWidthPoints = (printerWidthMm * 72) / 25.4; // Convert mm to points
  
  // Calculate height based on image aspect ratio
  const aspectRatio = pngImage.height / pngImage.width;
  const printerHeightPoints = printerWidthPoints * aspectRatio;
  
  // Create page with calculated dimensions
  const page = pdfDoc.addPage([printerWidthPoints, printerHeightPoints]);
  page.drawImage(pngImage, { 
    x: 0, 
    y: 0, 
    width: printerWidthPoints, 
    height: printerHeightPoints 
  });
  
  // Add watermark if specified
  if (watermarkText) {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = Math.min(printerWidthPoints, printerHeightPoints) * 0.1; // 10% of smaller dimension
    
    // Calculate watermark position (center of page)
    const textWidth = font.widthOfTextAtSize(watermarkText, fontSize);
    const textHeight = font.heightAtSize(fontSize);
    const x = (printerWidthPoints - textWidth) / 2;
    const y = (printerHeightPoints - textHeight) / 2;
    
    // Draw watermark with transparency
    page.drawText(watermarkText, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(0.8, 0.8, 0.8), // Light gray for watermark effect
      opacity: 0.3 // 30% opacity for subtle watermark
    });
  }
  
  return await pdfDoc.save();
}

async function processQueue() {
  if (isPrinting || jobQueue.length === 0) return;
  isPrinting = true;

  const job = jobQueue[0];
  job.status = 'Printing';
  statusCallback();

  try {
    const available = printers.getPrinters();
    if (available.length === 0) {
      console.error('No printers available. Retrying in 5 seconds...');
      job.status = 'Retrying';
      statusCallback();
      setTimeout(() => { isPrinting = false; processQueue(); }, 5000);
      return;
    }

    // Use selected printer or find appropriate printer
    let printerName = job.selectedPrinter || available[0].name;
    
    // If no specific printer selected, try to find Munbyn or thermal printer
    if (!job.selectedPrinter) {
      for (const printer of available) {
        if (printer.name.includes('Munbyn') || printer.name.toLowerCase().includes('thermal')) {
          printerName = printer.name;
          break;
        }
      }
    }

    // Verify the selected printer exists
    const selectedPrinter = available.find(p => p.name === printerName);
    if (!selectedPrinter) {
      console.error(`Selected printer "${printerName}" not found. Using first available printer.`);
      printerName = available[0].name;
    }

    console.log(`Using printer: ${printerName} (Type: ${selectedPrinter?.type || 'Unknown'})`);

    const pdfBuffer = await pngToPdf(job.imageBuffer, job.watermarkText);
    
    // Calculate label height from image dimensions to set proper paper size
    const pngDoc = await PDFDocument.create();
    const pngImage = await pngDoc.embedPng(job.imageBuffer);
    const aspectRatio = pngImage.height / pngImage.width;
    const labelHeightMm = Math.round(56 * aspectRatio);
    
    // Set printer options for proper paper size
    const printOptions = [
      { key: 'media', value: `Custom.56x${labelHeightMm}mm` },
      { key: 'PageSize', value: `Custom.56x${labelHeightMm}mm` },
      { key: 'media-type', value: 'label' },
      { key: 'fit-to-page', value: 'true' },
      { key: 'scaling', value: '100' },
      { key: 'print-quality', value: '5' }, // High quality
      { key: 'ColorModel', value: 'Gray' }, // Thermal printers are typically grayscale
      { key: 'copies', value: '1' }
    ];
    
    console.log(`Printing label with size: 56mm x ${labelHeightMm}mm`);
    if (job.watermarkText) {
      console.log(`With watermark: "${job.watermarkText}"`);
    }
    
    // Print to the selected printer (works for both USB and Bluetooth)
    await printers.print(printerName, pdfBuffer, 'Label Print', printOptions);
    console.log(`Job ${job.id} printed successfully on ${printerName}`);

    job.status = 'Done';
    statusCallback();
    jobQueue.shift();
    isPrinting = false;
    processQueue();

  } catch (err) {
    console.error('Printing error:', err);
    job.status = 'Error';
    statusCallback();
    jobQueue.shift();
    isPrinting = false;
    processQueue();
  }
}

function addJob(base64Image, selectedPrinter = null, watermarkText = null) {
  const imageBuffer = Buffer.from(base64Image, 'base64');
  const job = {
    id: Date.now(),
    imageBuffer,
    selectedPrinter,
    watermarkText,
    status: 'Queued',
  };
  jobQueue.push(job);
  statusCallback();
  processQueue();
}

module.exports = {
  addJob,
  getQueue,
  setStatusCallback,
}; 