require('dotenv').config();
const { getSignedUrl } = require('../config/s3Config');

console.log('\n=== TEST 1: Old AWS S3 URL ===');
const s3Url = 'https://atsresumespdf.s3.ap-southeast-2.amazonaws.com/logos/logo-1770890744912-51097.png';
const signed1 = getSignedUrl(s3Url);
console.log('Input :', s3Url);
console.log('Output:', signed1);
const ok1 = signed1.includes(process.env.R2_BUCKET_NAME) && !signed1.includes('atsresumespdf');
console.log('PASS?', ok1 ? '✅ YES' : '❌ NO - still using old S3 bucket name');

console.log('\n=== TEST 2: Local-style migrated path ===');
const localPath = 'uploads/clients/1766172805648-32640.png';
const signed2 = getSignedUrl(localPath);
console.log('Input :', localPath);
console.log('Output:', signed2);
const ok2 = signed2 && signed2.startsWith('http');
console.log('PASS?', ok2 ? '✅ YES' : '❌ NO - not signed');

console.log('\n=== TEST 3: logos/ prefix path ===');
const logoPath = 'logos/logo-1770890744912-51097.png';
const signed3 = getSignedUrl(logoPath);
console.log('Input :', logoPath);
console.log('Output:', signed3);
const ok3 = signed3 && signed3.startsWith('http');
console.log('PASS?', ok3 ? '✅ YES' : '❌ NO - not signed');
