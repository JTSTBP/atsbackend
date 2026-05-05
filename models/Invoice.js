const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
    client: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Client',
        required: true
    },
    candidates: [{
        candidateId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'CandidateByJob',
            required: true
        },
        designation: String,
        doj: Date,
        ctc: Number,
        amount: {
            type: Number,
            required: true
        }
    }],
    agreementPercentage: Number,
    payoutOption: {
        type: String,
        enum: ['Agreement Percentage', 'Flat Pay', 'Both'],
        default: 'Agreement Percentage'
    },
    flatPayAmount: Number,
    gstNumber: String,
    billingAddress: String,
    billingState: String,
    igst: {
        type: Number,
        default: 0
    },
    cgst: {
        type: Number,
        default: 0
    },
    sgst: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['Pending', 'Paid', 'Overdue'],
        default: 'Pending'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    invoiceNumber: {
        type: String,
        required: true
    },
    invoiceDate: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

module.exports = mongoose.model('Invoice', invoiceSchema);
