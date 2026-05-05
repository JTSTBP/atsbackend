const axios = require('axios');

async function testCreate() {
    try {
        const res = await axios.post('http://localhost:5000/api/CandidatesJob', {
            jobId: '67a0572da9a1a6797740e53f', // Example Job ID
            createdBy: '67a0558ca9a1a6797740e4f3', // Example User ID
            dynamicFields: JSON.stringify({ candidateName: 'Test Candidate', Email: 'test@example.com' }),
            notes: 'Test notes'
        }, {
            headers: { 'Content-Type': 'multipart/form-data' } // Wait, axios with object won't work with multipart manually like this easily without FormData
        });
        console.log('Success:', res.data);
    } catch (err) {
        if (err.response) {
            console.log('Error Data:', JSON.stringify(err.response.data, null, 2));
        } else {
            console.log('Error Message:', err.message);
        }
    }
}

testCreate();
