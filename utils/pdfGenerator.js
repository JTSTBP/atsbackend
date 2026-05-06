const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function generateInvoicePDF(invoice, payment, savePath) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40, size: 'A4' });

        const stream = fs.createWriteStream(savePath);
        doc.pipe(stream);

        // Helper to format currency
        const formatCurrency = (amount) => {
            return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount || 0);
        };

        // Helper to convert number to words
        const numberToWords = (num) => {
            const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
            const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

            const n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
            if (!n) return '';
            let str = '';
            str += (parseInt(n[1]) !== 0) ? (a[Number(n[1])] || b[parseInt(n[1][0])] + ' ' + a[parseInt(n[1][1])]) + 'Crore ' : '';
            str += (parseInt(n[2]) !== 0) ? (a[Number(n[2])] || b[parseInt(n[2][0])] + ' ' + a[parseInt(n[2][1])]) + 'Lakh ' : '';
            str += (parseInt(n[3]) !== 0) ? (a[Number(n[3])] || b[parseInt(n[3][0])] + ' ' + a[parseInt(n[3][1])]) + 'Thousand ' : '';
            str += (parseInt(n[4]) !== 0) ? (a[Number(n[4])] || b[parseInt(n[4][0])] + ' ' + a[parseInt(n[4][1])]) + 'Hundred ' : '';
            str += (parseInt(n[5]) !== 0) ? ((str !== '') ? 'and ' : '') + (a[Number(n[5])] || b[parseInt(n[5][0])] + ' ' + a[parseInt(n[5][1])]) + 'Only' : '';
            return str || 'Zero Only';
        };

        const drawGrid = (x, y, width, height) => {
            doc.rect(x, y, width, height).stroke();
        };

        // --- Header Section ---
        const logoPath = 'c:\\MyProjects\\OfficeProjects\\ATS\\Frontend\\src\\images\\logo.png';
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 40, 30, { width: 140 });
        }

        doc.moveDown(4);
        const topY = 90;
        
        // Main Outer Box for Header Info
        doc.rect(40, topY, 515, 85).stroke();
        
        // "Invoice" Header
        doc.rect(40, topY, 515, 20).stroke();
        doc.font('Helvetica-Bold').fontSize(12).text('Invoice', 40, topY + 5, { align: 'center', width: 515 });

        // Left Info Box (To)
        const leftBoxWidth = 220;
        doc.rect(40, topY + 20, leftBoxWidth, 65).stroke();
        doc.font('Helvetica').fontSize(10).text('To,', 45, topY + 25);
        
        const clientName = invoice.client?.companyName || '[Client Name]';
        doc.font('Helvetica-Bold').fontSize(10).text(clientName, 45, topY + 38, { width: leftBoxWidth - 10 });
        
        let addressText = '';
        if (invoice.billingAddress) addressText += invoice.billingAddress;
        if (invoice.billingState) addressText += (addressText ? ', ' : '') + invoice.billingState;
        
        if (!addressText) {
            if (invoice.client?.address) addressText += invoice.client.address;
            if (invoice.client?.state) addressText += (addressText ? ', ' : '') + invoice.client.state;
        }
        
        if (!addressText && invoice.client?.companyInfo) addressText = invoice.client.companyInfo;
        
        doc.font('Helvetica').fontSize(9).text(addressText || "No address available", 45, topY + 50, { width: leftBoxWidth - 10, height: 25 });
        
        const clientGst = invoice.gstNumber || invoice.client?.gstNumber || '';
        doc.font('Helvetica').fontSize(9).text(`GST No: ${clientGst}`, 45, topY + 75);

        // Right Info Box (Invoice Details)
        const rightBoxX = 40 + leftBoxWidth + 145; // Match image spacing roughly
        const rightBoxWidth = 150;
        
        // Divider line between left and right (the empty middle space in image)
        // Actually the image has three columns in the info box but the middle is blank.
        // Let's just draw the right box explicitly.
        
        doc.rect(390, topY + 20, 165, 65).stroke(); // Right box container
        
        const invNo = invoice.invoiceNumber || (invoice._id ? `JT/AI/26-27/${invoice._id.toString().substr(-4)}` : "JT/AI/26-27/01");
        const invDate = new Date(invoice.invoiceDate || invoice.createdAt || Date.now()).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
        
        doc.font('Helvetica').fontSize(10);
        doc.text(`Invoice No. ${invNo}`, 395, topY + 25);
        doc.moveTo(390, topY + 38).lineTo(555, topY + 38).stroke();
        
        doc.text(`Date :- ${invDate}`, 395, topY + 43);
        doc.moveTo(390, topY + 56).lineTo(555, topY + 56).stroke();
        
        doc.text(`SAC Code:-998512`, 395, topY + 61);

        // --- Table Section ---
        const tableTop = topY + 100;
        const colWidths = {
            sr: 40,
            name: 180,
            doj: 75,
            designation: 100,
            ctc: 60,
            amount: 60
        };
        const tableWidth = 515;
        
        // Table Header
        doc.rect(40, tableTop, tableWidth, 25).stroke();
        doc.font('Helvetica-Bold').fontSize(10);
        
        let currentX = 40;
        const drawHeaderCell = (text, width, align = 'center') => {
            doc.text(text, currentX, tableTop + 8, { width: width, align: align });
            doc.rect(currentX, tableTop, width, 25).stroke();
            currentX += width;
        };

        drawHeaderCell('Sr. No.', colWidths.sr);
        drawHeaderCell('Name Of the Candidate', colWidths.name);
        drawHeaderCell('D.O.J', colWidths.doj);
        drawHeaderCell('Designation', colWidths.designation);
        drawHeaderCell('CTC', colWidths.ctc);
        drawHeaderCell('Amount', colWidths.amount);

        // Table Rows
        let currentY = tableTop + 25;
        let totalAmount = 0;

        invoice.candidates.forEach((c, index) => {
            const rowHeight = 35; // Increased height to allow for multi-line designation if needed
            doc.rect(40, currentY, tableWidth, rowHeight).stroke();
            
            let rowX = 40;
            const drawCell = (text, width, align = 'center', isBold = false) => {
                doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
                doc.text(text || '', rowX, currentY + 12, { width: width, align: align });
                doc.rect(rowX, currentY, width, rowHeight).stroke();
                rowX += width;
            };

            const candidateName = c.candidateId?.dynamicFields?.candidateName || c.candidateId?.dynamicFields?.Name || '[Candidate Name]';
            const doj = c.doj ? new Date(c.doj).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
            const designation = c.designation || c.candidateId?.jobId?.title || '-';
            const ctc = c.ctc ? formatCurrency(c.ctc) : '0';
            const amount = Number(c.amount || 0);

            drawCell((index + 1).toString(), colWidths.sr);
            drawCell(candidateName, colWidths.name, 'center', true);
            drawCell(doj, colWidths.doj);
            drawCell(designation, colWidths.designation);
            drawCell(ctc, colWidths.ctc);
            drawCell(formatCurrency(amount), colWidths.amount);

            totalAmount += amount;
            currentY += rowHeight;
        });

        // Totals Rows
        const drawTotalRow = (label, value, isBold = false) => {
            const labelWidth = colWidths.sr + colWidths.name + colWidths.doj + colWidths.designation;
            const valWidth = colWidths.ctc + colWidths.amount;
            
            doc.rect(40, currentY, labelWidth, 18).stroke();
            doc.rect(40 + labelWidth, currentY, valWidth, 18).stroke();
            
            doc.font('Helvetica-Bold').fontSize(10).text(label, 40, currentY + 4, { width: labelWidth, align: 'center' });
            doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(value ? formatCurrency(value) : '', 40 + labelWidth, currentY + 4, { width: valWidth, align: 'center' });
            
            currentY += 18;
        };

        const stateToCheck = (invoice.billingState || invoice.client?.state || '').toLowerCase();
        const isKarnataka = stateToCheck === 'karnataka';
        let grandTotal = totalAmount;

        drawTotalRow('Total', totalAmount);
        
        if (isKarnataka) {
            const cgst = Math.round(totalAmount * 0.09);
            const sgst = Math.round(totalAmount * 0.09);
            grandTotal = totalAmount + cgst + sgst;
            drawTotalRow('CGST@9%', cgst);
            drawTotalRow('SGST@9%', sgst);
        } else {
            const igst = Math.round(totalAmount * 0.18);
            grandTotal = totalAmount + igst;
            drawTotalRow('IGST@18%', igst);
        }

        drawTotalRow('Grand Total', grandTotal, true);

        // Amount in Words
        currentY += 15;
        doc.font('Helvetica').fontSize(10).text(`Amount in words- ${numberToWords(Math.round(grandTotal))}.`, 40, currentY);

        // --- Bank Details Section ---
        currentY += 40;
        doc.font('Helvetica-Bold').fontSize(11).text('Bank Details', 40, currentY);
        doc.moveTo(40, currentY + 13).lineTo(105, currentY + 13).stroke();
        
        const bankDetails = [
            ['Name', ': Jobs Territory'],
            ['Bank Name', ': IDFC Bank'],
            ['Account Number', ': 89686116220'],
            ['Branch Name', ': Whitefield Branch'],
            ['IFSC Code', ': IDFB0080153'],
            ['', ''], // Spacer
            ['PAN', ':- AIPPJ6608Q'],
            ['GST No', ':- 29AIPPJ6608Q1ZB']
        ];

        let bankY = currentY + 18;
        bankDetails.forEach(([label, value]) => {
            if (!label && !value) {
                bankY += 10;
                return;
            }
            doc.font('Helvetica').fontSize(10).text(label, 40, bankY, { width: 100 });
            doc.text(value, 110, bankY);
            bankY += 14;
        });

        // Stamp/Signature Area
        const sigX = 380;
        const sigY = currentY + 30;
        
        const stampPath = 'c:\\MyProjects\\OfficeProjects\\ATS\\Frontend\\src\\images\\stamp.png';
        if (fs.existsSync(stampPath)) {
            doc.image(stampPath, sigX, sigY, { width: 100 });
        }
        
        doc.font('Helvetica-BoldOblique').fontSize(12).text('Sarun', sigX + 35, sigY + 80);
        
        // Note Box
        currentY = bankY + 20;
        doc.rect(40, currentY, 515, 25).stroke();
        doc.font('Helvetica').fontSize(10).text('Note :-', 45, currentY + 7);

        // Footer
        const footerY = 750;
        doc.font('Helvetica-Bold').fontSize(9).text('Address: ', 120, footerY, { continued: true });
        doc.font('Helvetica').text('Door No. 108, 1st Floor Brigade Arcade, Whitefield Road, Mahadevapura,');
        doc.text('Bangalore Karnataka -560048', { align: 'center', width: 515 });
        
        doc.moveDown(1);
        doc.text('www.jobsterritory.com', { align: 'center', width: 515 });

        doc.end();

        stream.on('finish', () => resolve(savePath));
        stream.on('error', (err) => reject(err));
    });
}

module.exports = { generateInvoicePDF };

