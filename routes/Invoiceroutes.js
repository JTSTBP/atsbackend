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
        const { client: clientId, candidates, agreementPercentage, createdBy, invoiceNumber, invoiceDate, billingAddress, billingState, gstNumber } = req.body;

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

        const newInvoice = new Invoice({
            client: clientId,
            candidates,
            agreementPercentage,
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

const nodemailer = require('nodemailer');
const { generateInvoicePDF } = require('../utils/pdfGenerator');
const fs = require('fs');
const path = require('path');

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

        // Determine credentials
        const emailUser = senderEmail || process.env.EMAIL_USER;
        const emailPass = senderPassword || process.env.EMAIL_PASS;

        // Send Email
        console.log("Sending email from:", emailUser);
        console.log("Sending email to:", clientEmail);

        if (!emailUser || !emailPass) {
            throw new Error("Email credentials missing. Please update your profile or check server config.");
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: emailUser,
                pass: emailPass
            }
        });

        const mailOptions = {
            from: emailUser,
            to: clientEmail,
            cc: cc,
            subject: `Invoice - ${invoice.client.companyName}`,
            text: emailBody || `Hi,\n\nKindly find the attached invoice soft copy.\n\nKarthika\nFinance\nM: 9686116232\nE: sarun@jobsterritory.com\nW: www.jobsterritory.com`,
            attachments: [
                {
                    filename: `Invoice_${invoice._id}.pdf`,
                    path: pdfPath
                }
            ]
        };

        await transporter.sendMail(mailOptions);

        // Clean up temp file
        fs.unlinkSync(pdfPath);

        res.status(200).json({ message: "Email sent successfully" });
    } catch (error) {
        console.error("Error sending email:", error);
        if (fs.existsSync(path.join(__dirname, `../temp/invoice_${req.body.invoiceId}.pdf`))) {
            fs.unlinkSync(path.join(__dirname, `../temp/invoice_${req.body.invoiceId}.pdf`));
        }
        res.status(500).json({ message: "Error sending email", error: error.message });
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

        if (!fs.existsSync(path.join(__dirname, '../temp'))) {
            fs.mkdirSync(path.join(__dirname, '../temp'));
        }

        // The preview data needs to be structured like the Invoice model for generateInvoicePDF
        // Frontend should send something like { clientObject, candidatesWithDetails, ... }
        await generateInvoicePDF(previewData, null, pdfPath);

        res.download(pdfPath, `Invoice_Preview.pdf`, (err) => {
            if (err) {
                console.error("Error sending file:", err);
            }
            if (fs.existsSync(pdfPath)) {
                fs.unlinkSync(pdfPath);
            }
        });
    } catch (error) {
        console.error("Error generating preview download:", error);
        res.status(500).json({ message: "Error generating preview download", error: error.message });
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

module.exports = router;
