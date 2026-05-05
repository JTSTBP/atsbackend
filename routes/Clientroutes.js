const express = require('express');
const router = express.Router();
const Client = require('../models/Client');
const clientUpload = require('../middleware/clientUpload');
const { s3, deleteFile, getSignedUrl } = require('../config/s3Config');
const fs = require('fs');
const path = require('path');

// Helper function to normalize URLs for comparison
const normalizeUrl = (url) => {
    if (!url) return '';

    // Remove protocol (http://, https://)
    let normalized = url.replace(/^https?:\/\//, '');

    // Remove www.
    normalized = normalized.replace(/^www\./, '');

    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');

    // Convert to lowercase
    return normalized.toLowerCase();
};

// Create a new client
router.post('/', clientUpload.single('logo'), async (req, res) => {
    try {
        const { companyName, websiteUrl, createdBy } = req.body;

        // Validate createdBy is provided
        if (!createdBy) {
            return res.status(400).json({ message: 'createdBy field is required' });
        }

        // Normalize the incoming URL
        const normalizedUrl = normalizeUrl(websiteUrl);

        // Get all clients to check for duplicate URLs
        const allClients = await Client.find();

        // Check for duplicate company name or normalized URL
        const existingClient = allClients.find(client => {
            const existingNormalizedUrl = normalizeUrl(client.websiteUrl);
            return client.companyName.toLowerCase() === companyName.toLowerCase() ||
                existingNormalizedUrl === normalizedUrl;
        });

        if (existingClient) {
            const isDuplicateName = existingClient.companyName.toLowerCase() === companyName.toLowerCase();
            return res.status(400).json({
                message: isDuplicateName
                    ? 'A client with this Company Name already exists.'
                    : 'A client with this Website URL already exists.'
            });
        }

        // Prepare client data with logo path if file was uploaded
        const clientData = {
            ...req.body,
            logo: req.file ? (req.file.location || req.file.path) : undefined
        };

        // Parse POCs if it's a JSON string (from FormData)
        if (typeof clientData.pocs === 'string') {
            try {
                clientData.pocs = JSON.parse(clientData.pocs);
            } catch (e) {
                return res.status(400).json({ message: 'Invalid POCs data format' });
            }
        }

        // Parse billingDetails if it's a JSON string (from FormData)
        if (typeof clientData.billingDetails === 'string') {
            try {
                clientData.billingDetails = JSON.parse(clientData.billingDetails);
            } catch (e) {
                return res.status(400).json({ message: 'Invalid billingDetails data format' });
            }
        }

        const newClient = new Client(clientData);
        const savedClient = await newClient.save();
        res.status(201).json({ success: true, client: savedClient });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Get all clients
// 📋 Get all clients with Pagination & Search
router.get('/', async (req, res) => {
    try {
        const { page, limit, search } = req.query;

        // Backward compatibility: fetch all if no pagination params
        if (!page || !limit) {
            const clients = await Client.find()
                .populate('createdBy', 'name email designation')
                .sort({ createdAt: -1 })
                .lean();

            const Job = require('../models/Jobs');
            const jobs = await Job.find({}, 'clientId'); // Optimize: only fetch clientId

            const clientsWithCount = clients.map(client => {
                const count = jobs.filter(job => job.clientId && job.clientId.toString() === client._id.toString()).length;
                return { 
                    ...client, 
                    jobCount: count,
                    logo: getSignedUrl(client.logo)
                };
            });

            return res.json({ success: true, clients: clientsWithCount });
        }

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        let query = {};

        // Search Filter
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { companyName: searchRegex },
                { websiteUrl: searchRegex },
                { industry: searchRegex },
                { address: searchRegex },
                { state: searchRegex }
            ];
        }

        // Date Range Filter
        if (req.query.startDate && req.query.endDate) {
            const start = new Date(req.query.startDate);
            const end = new Date(req.query.endDate);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);

            query.createdAt = {
                $gte: start,
                $lte: end
            };
        }

        // BD Executive Filter
        if (req.query.bdExecutive) {
            query.bdExecutive = req.query.bdExecutive;
        }

        // Fetch paginated clients
        const clients = await Client.find(query)
            .populate('createdBy', 'name email designation')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        // Calculate job counts for *these* clients only
        const Job = require('../models/Jobs');
        // We only need to check jobs for the clients we just fetched
        const clientIds = clients.map(c => c._id);
        const jobs = await Job.find({ clientId: { $in: clientIds } }, 'clientId').lean();

        const clientsWithCount = clients.map(client => {
            const count = jobs.filter(job => job.clientId && job.clientId.toString() === client._id.toString()).length;
            return { 
                ...client, 
                jobCount: count,
                logo: getSignedUrl(client.logo)
            };
        });

        const totalClients = await Client.countDocuments(query);

        res.json({
            success: true,
            clients: clientsWithCount,
            totalClients,
            totalPages: Math.ceil(totalClients / limitNum),
            currentPage: pageNum
        });

    } catch (err) {
        console.error('Error fetching clients:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Update a client
router.put('/:id', clientUpload.single('logo'), async (req, res) => {
    try {
        const { companyName, websiteUrl } = req.body;

        // Normalize the incoming URL
        const normalizedUrl = normalizeUrl(websiteUrl);

        // Get all clients except the current one
        const allClients = await Client.find({ _id: { $ne: req.params.id } });

        // Check for duplicate company name or normalized URL
        const existingClient = allClients.find(client => {
            const existingNormalizedUrl = normalizeUrl(client.websiteUrl);
            return client.companyName.toLowerCase() === companyName.toLowerCase() ||
                existingNormalizedUrl === normalizedUrl;
        });

        if (existingClient) {
            const isDuplicateName = existingClient.companyName.toLowerCase() === companyName.toLowerCase();
            return res.status(400).json({
                message: isDuplicateName
                    ? 'A client with this Company Name already exists.'
                    : 'A client with this Website URL already exists.'
            });
        }

        // Prepare update data with logo path if new file was uploaded
        const updateData = {
            ...req.body,
        };

        if (req.file) {
            // Find old logo from the client
            const clientToUpdate = await Client.findById(req.params.id);
            if (clientToUpdate && clientToUpdate.logo) {
                await deleteFile(clientToUpdate.logo);
            }

            updateData.logo = req.file.location || req.file.path;
        }


        // Parse POCs if it's a JSON string (from FormData)
        if (typeof updateData.pocs === 'string') {
            try {
                updateData.pocs = JSON.parse(updateData.pocs);
            } catch (e) {
                return res.status(400).json({ message: 'Invalid POCs data format' });
            }
        }

        // Parse billingDetails if it's a JSON string (from FormData)
        if (typeof updateData.billingDetails === 'string') {
            try {
                updateData.billingDetails = JSON.parse(updateData.billingDetails);
            } catch (e) {
                return res.status(400).json({ message: 'Invalid billingDetails data format' });
            }
        }

        const updatedClient = await Client.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true }
        );
        res.json({ success: true, client: updatedClient });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Delete a client
router.delete('/:id', async (req, res) => {
    try {
        const client = await Client.findById(req.params.id);
        if (!client) {
            return res.status(404).json({ message: 'Client not found' });
        }

        // Delete logo if it exists
        if (client.logo) {
            await deleteFile(client.logo);
        }

        await Client.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Client deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


module.exports = router;
