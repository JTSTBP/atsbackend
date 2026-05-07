const mongoose = require('mongoose');
require('dotenv').config();

const ClientSchema = new mongoose.Schema({
    companyName: String,
    logo: String
});

const Client = mongoose.model('Client', ClientSchema);

async function checkLogos() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');
        
        const clients = await Client.find({ logo: { $regex: /http/ } }).limit(5);
        console.log('Sample Cloud Client Logos:');
        clients.forEach(c => {
            console.log(`- ${c.companyName}: ${c.logo}`);
        });
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkLogos();
