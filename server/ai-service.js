const fs = require('fs');
const { PDFParse } = require('pdf-parse');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const log = require('./logger').create('ai');

/**
 * Parses a PDF file and generates a JSON quiz structure using Google Gemini.
 * @param {string} pdfPath - Path to the uploaded PDF file.
 * @param {string} apiKey - Google Gemini API Key.
 * @returns {Promise<Object>} - The generated quiz JSON object.
 */
async function generateQuizFromPDF(pdfPath, apiKey) {
    if (!apiKey) {
        throw new Error('لم يتم العثور على مفتاح API الخاص بـ Gemini في الإعدادات.');
    }

    // 1. Extract text from PDF using pdf-parse v2.x API
    const dataBuffer = fs.readFileSync(pdfPath);
    const parser = new PDFParse();
    const pdfData = await parser.loadPDF(dataBuffer);
    const text = pdfData.text || pdfData.pages?.map(p => p.text).join('\n') || '';

    if (!text || text.trim().length === 0) {
        throw new Error('لم يتم العثور على نصوص في ملف الـ PDF. تأكد أنه ليس عبارة عن صور فقط.');
    }

    // 2. Initialize Gemini API
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); // Fast and capable model

    // 3. Define the Prompt
    const prompt = `
    أنت خبير تعليمي ومصمم مناهج تفاعلية.
    اقرأ النص التعليمي التالي واستخرج منه مفاهيم رئيسية وقم بتوليد تجربة تعليمية تفاعلية (Storyline-like) بصيغة JSON.
    
    النص التعليمي:
    """
    ${text.substring(0, 15000)}
    """
    
    يجب أن يكون المخرج عبارة عن كائن JSON صالح (بدون أي نصوص إضافية أو علامات Markdown) يحتوي على مصفوفة باسم "slides".
    هناك 3 أنواع من الشرائح:
    1. شريحة معلومات (info): لعرض ملخص فكرة أو معلومة هامة.
       {"type": "info", "title": "عنوان الشريحة", "content": "محتوى الشرح باختصار..."}
    2. سؤال اختيار من متعدد (mcq):
       {"type": "mcq", "question": "السؤال...", "options": ["خيار1", "خيار2", "خيار3", "خيار4"], "correctIndex": 0, "explanation": "شرح الإجابة الصحيحة..."}
    3. سؤال صح وخطأ (tf):
       {"type": "tf", "question": "السؤال...", "isTrue": true, "explanation": "شرح الإجابة..."}

    قم بتوزيع الشرائح بشكل منطقي: شريحة أو شريحتي معلومات ثم يعقبها سؤال أو سؤالين للتأكد من الفهم.
    اجعل عدد الشرائح الإجمالي بين 5 إلى 15 شريحة بناءً على طول النص.
    تأكد أن الناتج هو JSON فقط ليبدأ بـ { وينتهي بـ }.
    `;

    // 4. Call Gemini
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let responseText = response.text();

    // Clean up potential markdown formatting from the response
    responseText = responseText.replace(/^```json/im, '').replace(/^```/im, '').trim();

    try {
        const quizJson = JSON.parse(responseText);
        return quizJson;
    } catch (parseError) {
        log.error("Failed to parse Gemini response:", responseText);
        throw new Error('فشل في تحليل استجابة الذكاء الاصطناعي إلى JSON.');
    }
}

module.exports = {
    generateQuizFromPDF
};
