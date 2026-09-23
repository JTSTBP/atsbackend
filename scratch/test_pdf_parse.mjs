import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function test() {
  // Create a test PDF
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText('Priya Menon\npriya.menon@gmail.com 98765 43210\nLocation Bangalore\n5 years of experience\nSoftware Engineer at Wipro Technologies Pvt Ltd', {
    x: 50, y: 800, size: 14, font, color: rgb(0, 0, 0)
  });
  const bytes = await pdfDoc.save();
  const buf = Buffer.from(bytes);

  // Test pdfjs-dist
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const workerPath = resolve(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `file:///${workerPath.replace(/\\/g, '/')}`;
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buf) });
    const pdfDocParsed = await loadingTask.promise;
    let text = '';
    for (let i = 1; i <= pdfDocParsed.numPages; i++) {
      const p = await pdfDocParsed.getPage(i);
      const c = await p.getTextContent();
      text += c.items.map(x => x.str).join('\n');
    }
    console.log('pdfjs-dist text:');
    console.log(text);
  } catch (e) {
    console.error('pdfjs-dist error:', e.message);
  }
}
test();
