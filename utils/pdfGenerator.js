const PDFDocument = require('pdfkit');
const fs = require('fs');

function generateInvoicePDF(invoice, payment, path) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });

        const stream = fs.createWriteStream(path);
        doc.pipe(stream);

        // Helper to format currency
        const formatCurrency = (amount) => {
            return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount || 0).replace('₹', '');
        };

        // Helper to convert number to words
        const numberToWords = (num) => {
            const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
            const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

            const n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
            if (!n) return ''; var str = '';
            str += (n[1] != 0) ? (a[Number(n[1])] || b[n[1][0]] + ' ' + a[n[1][1]]) + 'Crore ' : '';
            str += (n[2] != 0) ? (a[Number(n[2])] || b[n[2][0]] + ' ' + a[n[2][1]]) + 'Lakh ' : '';
            str += (n[3] != 0) ? (a[Number(n[3])] || b[n[3][0]] + ' ' + a[n[3][1]]) + 'Thousand ' : '';
            str += (n[4] != 0) ? (a[Number(n[4])] || b[n[4][0]] + ' ' + a[n[4][1]]) + 'Hundred ' : '';
            str += (n[5] != 0) ? ((str != '') ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0]] + ' ' + a[n[5][1]]) + 'Only' : '';
            return str || 'Zero Only';
        };

        // --- Header Section ---
        const logoPath = 'c:\\MyProjects\\OfficeProjects\\ATS\\Frontend\\src\\images\\logo.png';
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 50, 45, { width: 100 });
        }

        const invNo = invoice.invoiceNumber || (invoice._id ? `JT/RO/25-26/${invoice._id.toString().substr(-4)}` : "JT/RO/25-26/XXXX");
        doc.font('Helvetica-Bold').fontSize(11).text(`Invoice No. ${invNo}`, 400, 50, { align: 'right' });
        doc.font('Helvetica').fontSize(10).text(`Date: ${new Date(invoice.invoiceDate || invoice.createdAt || Date.now()).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`, { align: 'right' });

        doc.moveDown(4);

        // "To" Address
        const startY = 120;
        doc.fontSize(10).font('Helvetica').text('To,', 50, startY);

        const clientName = invoice.client?.companyName || '[Client Name]';
        doc.fontSize(14).font('Helvetica-Bold').text(clientName, 50, startY + 15);

        let addressText = '';
        if (invoice.billingAddress) addressText += invoice.billingAddress;
        if (invoice.billingState) {
            if (addressText) addressText += ', ';
            addressText += invoice.billingState;
        }

        if (!addressText) {
            if (invoice.client?.address) addressText += invoice.client.address;
            if (invoice.client?.state) {
                if (addressText) addressText += ', ';
                addressText += invoice.client.state;
            }
        }

        if (!addressText && invoice.client?.companyInfo) {
            addressText = invoice.client.companyInfo;
        }

        doc.fontSize(10).font('Helvetica').text(addressText || "No address available", 50, startY + 35, { width: 300 });

        // SAC and GST Info (Left Side below address)
        const infoY = doc.y + 15;
        doc.font('Helvetica-Bold').text('SAC Code: 998512', 50, infoY);

        const clientGst = invoice.gstNumber || invoice.client?.gstNumber;
        if (clientGst) {
            doc.text(`GST No: ${clientGst}`, 50, infoY + 15);
        }

        doc.moveDown(2);

        // --- Table Section ---
        const tableTop = doc.y + 20;
        const itemCodeX = 50;
        const descriptionX = 90;
        const dojX = 250;
        const designationX = 320;
        const ctcX = 420;
        const amountX = 500;

        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('Sr. No.', itemCodeX, tableTop);
        doc.text('Name Of the Candidate', descriptionX, tableTop);
        doc.text('D.O.J', dojX, tableTop);
        doc.text('Designation', designationX, tableTop);
        doc.text('CTC', ctcX, tableTop);
        doc.text('Amount', amountX, tableTop, { align: 'right', width: 50 });

        // Header Line
        doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

        let currentY = tableTop + 25;
        let totalAmount = 0;

        invoice.candidates.forEach((c, index) => {
            doc.font('Helvetica').fontSize(10);
            doc.text((index + 1).toString(), itemCodeX, currentY);

            const candidateName = c.candidateId?.dynamicFields?.candidateName || c.candidateId?.dynamicFields?.Name || '[Candidate Name]';
            doc.font('Helvetica-Bold').text(candidateName, descriptionX, currentY, { width: 150 });

            const doj = c.doj ? new Date(c.doj).toLocaleDateString('en-GB') : '-';
            doc.font('Helvetica').text(doj, dojX, currentY);

            const designation = c.designation || c.candidateId?.jobId?.title || '-';
            doc.text(designation, designationX, currentY, { width: 90 });

            const ctc = c.ctc ? `INR ${Number(c.ctc).toLocaleString()}` : '-';
            doc.text(ctc, ctcX, currentY);

            const amount = Number(c.amount || 0);
            doc.font('Helvetica-Bold').text(`INR ${amount.toLocaleString()}`, amountX, currentY, { align: 'right', width: 50 });

            totalAmount += amount;
            currentY += 25;
        });

        // Row Line
        doc.moveTo(50, currentY).lineTo(550, currentY).stroke();

        // --- Totals Section ---
        let totalsY = currentY + 15;
        const stateToCheck = invoice.billingState || invoice.client?.state;
        const isKarnataka = stateToCheck?.toLowerCase() === 'karnataka';
        let grandTotal = totalAmount;

        const labelX = 350;
        const valX = 450;

        doc.font('Helvetica-Bold').text('Sub Total', labelX, totalsY, { align: 'right', width: 100 });
        doc.text(`INR ${totalAmount.toLocaleString()}`, valX, totalsY, { align: 'right', width: 100 });

        totalsY += 15;
        if (isKarnataka) {
            const halfTax = Math.round(totalAmount * 0.09);
            grandTotal = totalAmount + (halfTax * 2);

            doc.font('Helvetica-Oblique').text('CGST @9%', labelX, totalsY, { align: 'right', width: 100 });
            doc.text(`INR ${halfTax.toLocaleString()}`, valX, totalsY, { align: 'right', width: 100 });

            totalsY += 15;
            doc.text('SGST @9%', labelX, totalsY, { align: 'right', width: 100 });
            doc.text(`INR ${halfTax.toLocaleString()}`, valX, totalsY, { align: 'right', width: 100 });
        } else {
            const tax = Math.round(totalAmount * 0.18);
            grandTotal = totalAmount + tax;

            doc.font('Helvetica-Oblique').text('IGST @18%', labelX, totalsY, { align: 'right', width: 100 });
            doc.text(`INR ${tax.toLocaleString()}`, valX, totalsY, { align: 'right', width: 100 });
        }

        totalsY += 20;
        doc.moveTo(labelX + 50, totalsY - 5).lineTo(550, totalsY - 5).stroke();
        doc.font('Helvetica-Bold').fontSize(12).text('Grand Total', labelX, totalsY, { align: 'right', width: 100 });
        doc.text(`INR ${grandTotal.toLocaleString()}`, valX, totalsY, { align: 'right', width: 100 });

        // Amount in Words
        doc.moveDown(3);
        doc.font('Helvetica-Oblique').fontSize(10);
        doc.text(`Amount in words -- ${numberToWords(Math.round(grandTotal))}`, 50);

        // --- Bank Details Section ---
        doc.moveDown(2);
        const bankStartY = doc.y;
        doc.font('Helvetica-Bold').fontSize(11).text('Bank Details:', 50, bankStartY);
        doc.font('Helvetica').fontSize(10);

        const bankDetails = [
            ['Name:', 'Jobs Territory'],
            ['Bank Name:', 'HDFC Bank'],
            ['Account Number:', '59207259123253'],
            ['Branch Name:', 'Cambridge Road'],
            ['IFSC Code:', 'HDFC0001298'],
            ['PAN:', 'AOBPR6552H'],
            ['GST No:', '29AOBPR6552H1ZL']
        ];

        let currentBankY = bankStartY + 18;
        bankDetails.forEach(([label, value]) => {
            doc.font('Helvetica-Bold').text(label, 50, currentBankY);
            doc.font('Helvetica').text(value, 150, currentBankY);
            currentBankY += 14;
        });

        // Signature Section (Relative to Bank Details)
        const sigTop = bankStartY + 18;
        doc.font('Helvetica-Bold').fontSize(10).text('For Jobs Territory', 350, sigTop, { align: 'center', width: 200 });
        doc.moveTo(370, sigTop + 60).lineTo(530, sigTop + 60).stroke();
        doc.text('Authorised Signatory', 350, sigTop + 70, { align: 'center', width: 200 });

        // Footer
        doc.fontSize(10).font('Helvetica-Bold').text('Jobs Territory', 50, 780, { align: 'center', width: 500 });
        doc.fontSize(8).font('Helvetica').text('Lines 1 & 2, 1st Floor, RPC Layout, Vijayanagar, Bangalore - 560040', 50, 792, { align: 'center', width: 500 });

        doc.end();

        stream.on('finish', () => resolve(path));
        stream.on('error', (err) => reject(err));
    });
}

module.exports = { generateInvoicePDF };
