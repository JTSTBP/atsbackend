const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const Payment = require('../models/Payment');
const Expense = require('../models/Expense');

// Get Financial Summary
router.get('/summary', async (req, res) => {
    try {
        const { filter } = req.query;
        const now = new Date();
        let startDate = new Date();

        if (filter === 'weekly') {
            startDate.setDate(now.getDate() - 7);
        } else if (filter === 'monthly') {
            startDate.setMonth(now.getMonth() - 1);
        } else if (filter === 'yearly') {
            startDate.setFullYear(now.getFullYear() - 1);
        } else {
            // Default to all time if no filter or 'all'
            startDate = new Date(0);
        }

        // Calculate Total Income (from Payments)
        console.log(`Summary Filter: ${filter}, StartDate: ${startDate}`);

        const payments = await Payment.find({}); // DEBUG: Removed date filter
        console.log(`Payments Found: ${payments.length}`);
        const totalIncome = payments.reduce((sum, payment) => sum + payment.amountReceived, 0);
        console.log(`Total Income: ${totalIncome}`);

        // Calculate Total Expenses
        const expenses = await Expense.find({}); // DEBUG: Removed date filter
        console.log(`Expenses Found: ${expenses.length}`);
        const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
        console.log(`Total Expenses: ${totalExpenses}`);

        // Calculate Net Profit and Margin
        const netProfit = totalIncome - totalExpenses;
        const profitMargin = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(2) : 0;

        res.status(200).json({
            totalIncome,
            totalExpenses,
            netProfit,
            profitMargin
        });
    } catch (error) {
        console.error("Error fetching financial summary:", error);
        res.status(500).json({ message: "Error fetching summary", error: error.message });
    }
});

// Create a new invoice
router.post('/create', async (req, res) => {
    try {
        const { client: clientId, candidates, agreementPercentage, createdBy, invoiceNumber, invoiceDate, billingAddress, billingState, gstNumber, payoutOption, flatPayAmount, billingLocationType, billingLocationIndex } = req.body;

        // Fetch client details to check for existence
        const clientDetails = await Client.findById(clientId);
        if (!clientDetails) {
            return res.status(404).json({ message: "Client not found" });
        }

        // Calculate Total Amount from candidates
        const totalAmount = candidates.reduce((sum, candidate) => sum + (parseFloat(candidate.amount) || 0), 0);

        let igst = 0;
        let cgst = 0;
        let sgst = 0;

        // Apply taxes based on the provided billing state (or fallback to client default)
        const effectiveState = (billingState || clientDetails.state || '').toLowerCase();
        if (effectiveState === 'karnataka') {
            cgst = Math.round(totalAmount * 0.09);
            sgst = Math.round(totalAmount * 0.09);
        } else {
            igst = Math.round(totalAmount * 0.18);
        }

        // Auto-save/update/edit billing details for the client
        if (billingAddress && billingAddress.trim()) {
            const cleanAddress = billingAddress.trim().toLowerCase();
            const cleanState = (billingState || '').trim();
            const cleanGst = (gstNumber || '').trim();

            if (billingLocationType === 'primary') {
                // User explicitly selected and edited the primary billing location
                let updated = false;
                if (clientDetails.address !== billingAddress.trim()) {
                    clientDetails.address = billingAddress.trim();
                    updated = true;
                }
                if (clientDetails.state !== cleanState) {
                    clientDetails.state = cleanState;
                    updated = true;
                }
                if (clientDetails.gstNumber !== cleanGst) {
                    clientDetails.gstNumber = cleanGst;
                    updated = true;
                }
                if (updated) {
                    await clientDetails.save();
                }
            } else if (billingLocationType === 'secondary' && billingLocationIndex !== undefined && billingLocationIndex !== null && Number(billingLocationIndex) >= 0) {
                // User explicitly selected and edited an existing secondary billing location
                const idx = Number(billingLocationIndex);
                if (clientDetails.billingDetails && clientDetails.billingDetails[idx]) {
                    let updated = false;
                    const detail = clientDetails.billingDetails[idx];
                    if (detail.address !== billingAddress.trim()) {
                        detail.address = billingAddress.trim();
                        updated = true;
                    }
                    if (detail.state !== cleanState) {
                        detail.state = cleanState;
                        updated = true;
                    }
                    if (detail.gstNumber !== cleanGst) {
                        detail.gstNumber = cleanGst;
                        updated = true;
                    }
                    if (updated) {
                        clientDetails.markModified('billingDetails');
                        await clientDetails.save();
                    }
                }
            } else {
                // Fallback: No explicit location selected, or marked as 'new'. Use address matching.
                const hasRootAddress = !!(clientDetails.address && clientDetails.address.trim());
                
                if (!hasRootAddress) {
                    // Case 1: Client has no root address. Save to root.
                    clientDetails.address = billingAddress.trim();
                    if (billingState) clientDetails.state = cleanState;
                    if (gstNumber) clientDetails.gstNumber = cleanGst;
                    await clientDetails.save();
                } else {
                    // Case 2: Client has root address. Check if entered address matches root.
                    const rootAddressMatches = clientDetails.address.trim().toLowerCase() === cleanAddress;
                    
                    if (rootAddressMatches) {
                        // Update root state/gst if they are different or were empty
                        let updated = false;
                        if (cleanState && (clientDetails.state || '').trim() !== cleanState) {
                            clientDetails.state = cleanState;
                            updated = true;
                        }
                        if (cleanGst && (clientDetails.gstNumber || '').trim() !== cleanGst) {
                            clientDetails.gstNumber = cleanGst;
                            updated = true;
                        }
                        if (updated) {
                            await clientDetails.save();
                        }
                    } else {
                        // Case 3: Entered address does not match root. Check the billingDetails array.
                        if (!clientDetails.billingDetails) {
                            clientDetails.billingDetails = [];
                        }
                        
                        const existingDetailIndex = clientDetails.billingDetails.findIndex(detail => 
                            (detail.address || '').trim().toLowerCase() === cleanAddress
                        );
                        
                        if (existingDetailIndex !== -1) {
                            // Found matching address in billingDetails. Update state/gst if different.
                            let updated = false;
                            const existingDetail = clientDetails.billingDetails[existingDetailIndex];
                            if (cleanState && (existingDetail.state || '').trim() !== cleanState) {
                                existingDetail.state = cleanState;
                                updated = true;
                            }
                            if (cleanGst && (existingDetail.gstNumber || '').trim() !== cleanGst) {
                                existingDetail.gstNumber = cleanGst;
                                updated = true;
                            }
                            if (updated) {
                                clientDetails.markModified('billingDetails');
                                await clientDetails.save();
                            }
                        } else {
                            // Not found in billingDetails. Append as a new location.
                            clientDetails.billingDetails.push({
                                address: billingAddress.trim(),
                                state: cleanState,
                                gstNumber: cleanGst
                            });
                            await clientDetails.save();
                        }
                    }
                }
            }
        }

        // Auto-save/update commercial details for the client
        let clientUpdated = false;
        if (payoutOption && clientDetails.payoutOption !== payoutOption) {
            clientDetails.payoutOption = payoutOption;
            clientUpdated = true;
        }
        if (agreementPercentage !== undefined && agreementPercentage !== null && agreementPercentage !== "" && clientDetails.agreementPercentage !== Number(agreementPercentage)) {
            clientDetails.agreementPercentage = Number(agreementPercentage);
            clientUpdated = true;
        }
        if (flatPayAmount !== undefined && flatPayAmount !== null && flatPayAmount !== "" && clientDetails.flatPayAmount !== Number(flatPayAmount)) {
            clientDetails.flatPayAmount = Number(flatPayAmount);
            clientUpdated = true;
        }
        if (clientUpdated) {
            await clientDetails.save();
        }

        const newInvoice = new Invoice({
            client: clientId,
            candidates,
            agreementPercentage,
            payoutOption,
            flatPayAmount,
            gstNumber: gstNumber || clientDetails.gstNumber,
            billingAddress,
            billingState,
            igst,
            cgst,
            sgst,
            createdBy,
            invoiceNumber,
            invoiceDate: invoiceDate || new Date()
        });

        const savedInvoice = await newInvoice.save();
        res.status(201).json(savedInvoice);
    } catch (error) {
        console.error("Error creating invoice:", error);
        res.status(500).json({ message: "Error creating invoice", error: error.message });
    }
});

// Get all invoices
router.get('/all', async (req, res) => {
    try {
        const { client, candidate, status, startDate, endDate } = req.query;
        let query = {};

        if (client) query.client = client;
        if (candidate) {
            query['candidates.candidateId'] = candidate;
        }
        if (status) query.status = status;
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        const invoices = await Invoice.find(query)
            .populate('client')
            .populate('candidates.candidateId', 'dynamicFields')
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 });
        res.status(200).json(invoices);
    } catch (error) {
        console.error("Error fetching invoices:", error);
        res.status(500).json({ message: "Error fetching invoices", error: error.message });
    }
});

// Mark invoice as paid
router.post('/mark-paid', async (req, res) => {
    try {
        const { invoiceId, amountReceived, receivedDate, recordedBy } = req.body;

        const invoice = await Invoice.findById(invoiceId);
        if (!invoice) {
            return res.status(404).json({ message: "Invoice not found" });
        }

        // Update invoice status
        invoice.status = 'Paid';

        // Backfill amount for legacy invoices that don't have it
        if (!invoice.amount) {
            invoice.amount = amountReceived;
        }

        await invoice.save();

        // Create payment record
        const newPayment = new Payment({
            invoiceId,
            clientId: invoice.client,
            candidateId: invoice.candidates[0]?.candidateId, // Use the first candidate
            amountReceived,
            receivedDate,
            recordedBy
        });

        await newPayment.save();

        res.status(200).json({ message: "Invoice marked as paid", invoice, payment: newPayment });
    } catch (error) {
        console.error("Error marking invoice as paid:", error);
        console.error("Request body:", req.body);
        res.status(500).json({ message: "Error processing payment", error: error.message });
    }
});

// Get all payments
router.get('/payments', async (req, res) => {
    try {
        const { client, candidate, startDate, endDate } = req.query;
        let query = {};

        if (client) query.clientId = client;
        if (candidate) query.candidateId = candidate;
        if (startDate || endDate) {
            query.receivedDate = {};
            if (startDate) query.receivedDate.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.receivedDate.$lte = end;
            }
        }

        const payments = await Payment.find(query)
            .populate('clientId', 'companyName')
            .populate('candidateId', 'dynamicFields')
            .populate('invoiceId', 'agreementPercentage amount')
            .populate('recordedBy', 'name')
            .sort({ receivedDate: -1 });
        res.status(200).json(payments);
    } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).json({ message: "Error fetching payments", error: error.message });
    }
});

// Delete payment
router.delete('/payments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const payment = await Payment.findByIdAndDelete(id);

        if (!payment) {
            return res.status(404).json({ message: "Payment not found" });
        }

        // If payment was associated with an invoice, reset invoice status to Pending
        if (payment.invoiceId) {
            const invoice = await Invoice.findById(payment.invoiceId);
            if (invoice) {
                invoice.status = 'Pending';
                await invoice.save();
            }
        }

        res.status(200).json({ message: "Payment deleted successfully" });
    } catch (error) {
        console.error("Error deleting payment:", error);
        res.status(500).json({ message: "Error deleting payment", error: error.message });
    }
});

// Delete invoice
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deletedInvoice = await Invoice.findByIdAndDelete(id);

        if (!deletedInvoice) {
            return res.status(404).json({ message: "Invoice not found" });
        }

        res.status(200).json({ message: "Invoice deleted successfully" });
    } catch (error) {
        console.error("Error deleting invoice:", error);
        res.status(500).json({ message: "Error deleting invoice", error: error.message });
    }
});

const { generateInvoicePDF } = require('../utils/pdfGenerator');
const fs = require('fs');
const path = require('path');
const { sendMail, formatEmailErrorResponse, getEmailProvider } = require('../services/emailService');

// Send Invoice Email
router.post('/send-email', async (req, res) => {
    try {
        const { invoiceId, emailBody, senderEmail, senderPassword, recipients, cc } = req.body;

        const invoice = await Invoice.findById(invoiceId)
            .populate('client')
            .populate({
                path: 'candidates.candidateId',
                populate: { path: 'jobId', select: 'title' }
            });

        if (!invoice) {
            return res.status(404).json({ message: "Invoice not found" });
        }

        const clientEmail = recipients || invoice.client.pocs[0]?.email;
        if (!clientEmail) {
            return res.status(400).json({ message: "No recipients provided and no client POC email found" });
        }

        // Generate PDF
        const pdfPath = path.join(__dirname, `../temp/invoice_${invoice._id}.pdf`);

        // Ensure temp directory exists
        if (!fs.existsSync(path.join(__dirname, '../temp'))) {
            fs.mkdirSync(path.join(__dirname, '../temp'));
        }

        await generateInvoicePDF(invoice, null, pdfPath);

        const emailUser = senderEmail || process.env.SMTP_USER || process.env.EMAIL_ID || process.env.EMAIL_USER || process.env.RESEND_FROM_EMAIL;
        const emailPass = senderPassword || process.env.SMTP_PASS || process.env.APP_PASSWORD || process.env.EMAIL_PASS;

        console.log("Sending email from:", emailUser);
        console.log("Sending email to:", clientEmail);

        if (!emailUser || (getEmailProvider() === "smtp" && !emailPass)) {
            throw new Error("Email credentials missing. Please update your profile or check server config.");
        }

        await sendMail({
            fromName: "Jobs Territory Finance",
            from: emailUser,
            to: clientEmail,
            cc: cc,
            replyTo: senderEmail || undefined,
            subject: `Invoice - ${invoice.client.companyName}`,
            text: emailBody || `Hi,\n\nKindly find the attached invoice soft copy.\n\nKarthika\nFinance\nM: 9686116232\nE: sarun@jobsterritory.com\nW: www.jobsterritory.com`,
            attachments: [
                {
                    filename: `Invoice_${invoice._id}.pdf`,
                    path: pdfPath
                }
            ],
            auth: {
                user: emailUser,
                pass: emailPass,
            },
        });

        // Clean up temp file
        fs.unlinkSync(pdfPath);

        res.status(200).json({ message: "Email sent successfully" });
    } catch (error) {
        console.error("Error sending email:", error);
        if (fs.existsSync(path.join(__dirname, `../temp/invoice_${req.body.invoiceId}.pdf`))) {
            fs.unlinkSync(path.join(__dirname, `../temp/invoice_${req.body.invoiceId}.pdf`));
        }
        res.status(500).json({
            message: "Error sending email",
            ...formatEmailErrorResponse(error),
        });
    }
});

// Reset invoice status
// Download Invoice PDF
router.get('/download/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await Invoice.findById(id)
            .populate('client')
            .populate({
                path: 'candidates.candidateId',
                populate: { path: 'jobId', select: 'title' }
            });

        if (!invoice) {
            return res.status(404).json({ message: "Invoice not found" });
        }

        const pdfPath = path.join(__dirname, `../temp/invoice_${invoice._id}.pdf`);

        if (!fs.existsSync(path.join(__dirname, '../temp'))) {
            fs.mkdirSync(path.join(__dirname, '../temp'));
        }

        await generateInvoicePDF(invoice, null, pdfPath);

        res.download(pdfPath, `Invoice_${invoice.invoiceNumber || id}.pdf`, (err) => {
            if (err) {
                console.error("Error sending file:", err);
            }
            // Clean up temp file
            if (fs.existsSync(pdfPath)) {
                fs.unlinkSync(pdfPath);
            }
        });
    } catch (error) {
        console.error("Error generating download:", error);
        res.status(500).json({ message: "Error generating download", error: error.message });
    }
});

// Download Preview PDF
router.post('/preview-download', async (req, res) => {
    try {
        const previewData = req.body;
        const tempId = Date.now();
        const pdfPath = path.join(__dirname, `../temp/preview_${tempId}.pdf`);
        
        // Ensure temp directory exists
        if (!fs.existsSync(path.join(__dirname, '../temp'))) {
            fs.mkdirSync(path.join(__dirname, '../temp'));
        }
        
        // Generate PDF using the same utility as regular invoices
        await generateInvoicePDF(previewData, null, pdfPath);
        
        // Stream PDF for inline preview (no attachment download)
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="Invoice_Preview.pdf"');
        const fileStream = fs.createReadStream(pdfPath);
        fileStream.pipe(res);
        fileStream.on('close', () => {
            // Clean up temporary file after sending
            if (fs.existsSync(pdfPath)) {
                fs.unlinkSync(pdfPath);
            }
        });
    } catch (error) {
        console.error('Error generating preview download:', error);
        res.status(500).json({ message: 'Error generating preview download', error: error.message });
    }
});

router.post('/reset-status', async (req, res) => {
    try {
        const { invoiceId } = req.body;

        const invoice = await Invoice.findById(invoiceId);
        if (!invoice) {
            return res.status(404).json({ message: "Invoice not found" });
        }

        // Update invoice status
        invoice.status = 'Pending';
        await invoice.save();

        // Delete associated payment record
        await Payment.findOneAndDelete({ invoiceId });

        res.status(200).json({ message: "Invoice status reset to Pending", invoice });
    } catch (error) {
        console.error("Error resetting invoice status:", error);
        res.status(500).json({ message: "Error resetting invoice status", error: error.message });
    }
});

// Update an existing invoice
router.put('/update/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { client: clientId, candidates, agreementPercentage, invoiceNumber, invoiceDate, billingAddress, billingState, gstNumber, payoutOption, flatPayAmount, billingLocationType, billingLocationIndex } = req.body;

        const invoice = await Invoice.findById(id);
        if (!invoice) {
            return res.status(404).json({ message: "Invoice not found" });
        }

        // Fetch client details
        const clientDetails = await Client.findById(clientId);
        if (!clientDetails) {
            return res.status(404).json({ message: "Client not found" });
        }

        // Calculate Total Amount from candidates
        const totalAmount = candidates.reduce((sum, candidate) => sum + (parseFloat(candidate.amount) || 0), 0);

        let igst = 0;
        let cgst = 0;
        let sgst = 0;

        // Apply taxes
        const effectiveState = (billingState || clientDetails.state || '').toLowerCase();
        if (effectiveState === 'karnataka') {
            cgst = Math.round(totalAmount * 0.09);
            sgst = Math.round(totalAmount * 0.09);
        } else {
            igst = Math.round(totalAmount * 0.18);
        }

        // Auto-save/update/edit billing details for the client
        if (billingAddress && billingAddress.trim()) {
            const cleanAddress = billingAddress.trim().toLowerCase();
            const cleanState = (billingState || '').trim();
            const cleanGst = (gstNumber || '').trim();

            if (billingLocationType === 'primary') {
                let updated = false;
                if (clientDetails.address !== billingAddress.trim()) {
                    clientDetails.address = billingAddress.trim();
                    updated = true;
                }
                if (clientDetails.state !== cleanState) {
                    clientDetails.state = cleanState;
                    updated = true;
                }
                if (clientDetails.gstNumber !== cleanGst) {
                    clientDetails.gstNumber = cleanGst;
                    updated = true;
                }
                if (updated) {
                    await clientDetails.save();
                }
            } else if (billingLocationType === 'secondary' && billingLocationIndex !== undefined && billingLocationIndex !== null && Number(billingLocationIndex) >= 0) {
                const idx = Number(billingLocationIndex);
                if (clientDetails.billingDetails && clientDetails.billingDetails[idx]) {
                    let updated = false;
                    const detail = clientDetails.billingDetails[idx];
                    if (detail.address !== billingAddress.trim()) {
                        detail.address = billingAddress.trim();
                        updated = true;
                    }
                    if (detail.state !== cleanState) {
                        detail.state = cleanState;
                        updated = true;
                    }
                    if (detail.gstNumber !== cleanGst) {
                        detail.gstNumber = cleanGst;
                        updated = true;
                    }
                    if (updated) {
                        clientDetails.markModified('billingDetails');
                        await clientDetails.save();
                    }
                }
            }
        }

        // Auto-save/update commercial details for the client
        let clientUpdated = false;
        if (payoutOption && clientDetails.payoutOption !== payoutOption) {
            clientDetails.payoutOption = payoutOption;
            clientUpdated = true;
        }
        if (agreementPercentage !== undefined && agreementPercentage !== null && agreementPercentage !== "" && clientDetails.agreementPercentage !== Number(agreementPercentage)) {
            clientDetails.agreementPercentage = Number(agreementPercentage);
            clientUpdated = true;
        }
        if (flatPayAmount !== undefined && flatPayAmount !== null && flatPayAmount !== "" && clientDetails.flatPayAmount !== Number(flatPayAmount)) {
            clientDetails.flatPayAmount = Number(flatPayAmount);
            clientUpdated = true;
        }
        if (clientUpdated) {
            await clientDetails.save();
        }

        // Update Invoice fields
        invoice.client = clientId;
        invoice.candidates = candidates;
        invoice.agreementPercentage = agreementPercentage;
        invoice.payoutOption = payoutOption;
        invoice.flatPayAmount = flatPayAmount;
        invoice.gstNumber = gstNumber || clientDetails.gstNumber;
        invoice.billingAddress = billingAddress;
        invoice.billingState = billingState;
        invoice.igst = igst;
        invoice.cgst = cgst;
        invoice.sgst = sgst;
        invoice.invoiceNumber = invoiceNumber;
        if (invoiceDate) {
            invoice.invoiceDate = invoiceDate;
        }

        const savedInvoice = await invoice.save();
        res.status(200).json(savedInvoice);
    } catch (error) {
        console.error("Error updating invoice:", error);
        res.status(500).json({ message: "Error updating invoice", error: error.message });
    }
});

module.exports = router;
