const express = require('express');
const router = express.Router();
const multer = require('multer');
const { returnInvoiceProofStorage } = require('../config/cloudinaryConfig');
const ReturnInvoice = require('../models/ReturnInvoice');

const upload = multer({ storage: returnInvoiceProofStorage });

// Create a return invoice
router.post('/create', upload.single('proofDocument'), async (req, res) => {
    try {
        const { client, candidate, amount, reason, returnDate, status, createdBy } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Proof document is required' });
        }

        const newReturnInvoice = new ReturnInvoice({
            client,
            candidate,
            amount,
            reason,
            proofDocument: req.file.path,
            returnDate: returnDate || Date.now(),
            status: status || 'Processed',
            createdBy
        });

        await newReturnInvoice.save();
        res.status(201).json({ success: true, message: 'Return Invoice created successfully', data: newReturnInvoice });
    } catch (error) {
        console.error('Error creating return invoice:', error);
        res.status(500).json({ success: false, message: 'Failed to create return invoice', error: error.message });
    }
});

// Get all return invoices
router.get('/all', async (req, res) => {
    try {
        const { client, candidate, startDate, endDate } = req.query;
        let filter = {};

        if (client) filter.client = client;
        if (candidate) filter.candidate = candidate;
        
        if (startDate && endDate) {
            filter.returnDate = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }

        const returnInvoices = await ReturnInvoice.find(filter)
            .populate('client', 'companyName')
            .populate('candidate', 'dynamicFields')
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 });

        res.status(200).json(returnInvoices);
    } catch (error) {
        console.error('Error fetching return invoices:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch return invoices', error: error.message });
    }
});

// Delete a return invoice
router.delete('/:id', async (req, res) => {
    try {
        const returnInvoice = await ReturnInvoice.findById(req.params.id);
        if (!returnInvoice) {
            return res.status(404).json({ success: false, message: 'Return invoice not found' });
        }

        // Ideally, we would also delete the file from cloudinary here
        
        await ReturnInvoice.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Return invoice deleted successfully' });
    } catch (error) {
        console.error('Error deleting return invoice:', error);
        res.status(500).json({ success: false, message: 'Failed to delete return invoice', error: error.message });
    }
});

module.exports = router;
