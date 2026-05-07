require('dotenv').config();
const { getSignedUrl } = require('../config/s3Config');

const testUrl = 'https://atsresumespdf.s3.ap-southeast-2.amazonaws.com/logos/logo-1770890744912-51097.png';
const signed = getSignedUrl(testUrl);

console.log('Original:', testUrl);
console.log('Signed:', signed);
