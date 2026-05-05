const mongoose = require('mongoose');
const Payment = require('./models/Payment');
const Expense = require('./models/Expense');
const fs = require('fs');

const MONGO_URI = 'mongodb+srv://sarun:JobsTerritory2025@cluster0.lyuxr.mongodb.net/Ats_Database';
const OUTPUT_FILE = 'debug_output.txt';

async function runDebug() {
    let output = "";
    const log = (msg) => {
        console.log(msg);
        output += msg + "\n";
    };

    try {
        await mongoose.connect(MONGO_URI);
        log("Connected to DB");

        const now = new Date();
        const startOfMonth = new Date();
        startOfMonth.setMonth(now.getMonth() - 1);
        log(`Current Time: ${now.toISOString()}`);
        log(`Monthly Filter Start Date: ${startOfMonth.toISOString()}`);

        log("\n--- A. ALL PAYMENTS ---");
        const allPayments = await Payment.find({});
        log(`Total Count: ${allPayments.length}`);
        allPayments.forEach(p => {
            // Use JSON.stringify to see full structure including types if date is weird
            log(`ID: ${p._id}, Amt: ${p.amountReceived} (${typeof p.amountReceived}), Date: ${p.receivedDate} (${typeof p.receivedDate}), Invoice: ${p.invoiceId}`);
        });

        log("\n--- B. MONTHLY FILTERED PAYMENTS ---");
        const filteredPayments = await Payment.find({
            receivedDate: { $gte: startOfMonth }
        });
        log(`Filtered Count: ${filteredPayments.length}`);
        const totalIncome = filteredPayments.reduce((sum, p) => sum + (p.amountReceived || 0), 0);
        log(`Calculated Total Income: ${totalIncome}`);

        log("\n--- C. ALL EXPENSES ---");
        const allExpenses = await Expense.find({});
        log(`Total Count: ${allExpenses.length}`);
        allExpenses.forEach(e => {
            log(`ID: ${e._id}, Amt: ${e.amount}, Date: ${e.date}`);
        });

        mongoose.connection.close();
        fs.writeFileSync(OUTPUT_FILE, output, 'utf8');
        log(`\nOutput written to ${OUTPUT_FILE}`);
    } catch (err) {
        log(`Error: ${err.message}`);
        fs.writeFileSync(OUTPUT_FILE, output, 'utf8');
    }
}

runDebug();
