const { db } = require('./server/sqlite');
const { generateQuizFromPDF } = require('./server/ai-service');
const path = require('path');
const fs = require('fs');

async function test() {
  // Check API key in DB
  const row = db.prepare("SELECT value FROM settings WHERE key = 'gemini_api_key'").get();
  const apiKey = row ? row.value : null;
  console.log('API Key from DB:', apiKey ? (apiKey.substring(0, 12) + '...') : 'NOT FOUND');

  if (!apiKey) {
    console.error('No API key found in database!');
    return;
  }

  // Create a dummy PDF-like temp file  
  const testFile = path.join(__dirname, 'test_dummy.pdf');
  // Write minimal valid pdf bytes (we'll test with a real approach)
  fs.writeFileSync(testFile, Buffer.from('%PDF-1.4 test content for AI generation\nالذكاء الاصطناعي هو محاكاة للذكاء البشري في الآلات.'));

  try {
    console.log('Calling generateQuizFromPDF...');
    const result = await generateQuizFromPDF(testFile, apiKey);
    console.log('SUCCESS! Result:', JSON.stringify(result).substring(0, 300));
  } catch (err) {
    console.error('ERROR MESSAGE:', err.message);
    console.error('ERROR STACK:', err.stack);
  } finally {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  }
}

test();
