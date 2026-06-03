const mongoose = require('mongoose');

const returnInvoiceSchema = new mongoose.Schema({
    client: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Client',
        required: true
    },
    candidate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CandidatesByJob',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    reason: {
        type: String,
        required: true
    },
    proofDocument: {
        type: String, 
        required: true
    },
    returnDate: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['Pending', 'Processed'],
        default: 'Processed'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('ReturnInvoice', returnInvoiceSchema);
