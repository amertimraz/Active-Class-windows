const fs      = require('fs');
const https   = require('https');
const { PDFParse } = require('pdf-parse');
const log     = require('./logger').create('ai');

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function groqRequest(apiKey, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: 0.4,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    });

    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || 'Groq API error'));
          resolve(parsed);
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function generateQuizFromPDF(pdfPath, apiKey) {
  if (!apiKey) throw new Error('لم يتم العثور على مفتاح Groq API في الإعدادات.');

  // 1. Extract text from PDF using pdf-parse v2 API
  const dataBuffer = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: dataBuffer });
  const textResult = await parser.getText();
  const text = textResult.text || '';
  await parser.destroy().catch(() => {});

  if (!text || text.trim().length === 0) {
    throw new Error('لم يتم العثور على نصوص في ملف الـ PDF. تأكد أنه ليس عبارة عن صور فقط.');
  }

  // 2. Call Groq
  const prompt = `أنت خبير تعليمي ومصمم مناهج تفاعلية.
اقرأ النص التعليمي التالي واستخرج منه مفاهيم رئيسية وقم بتوليد تجربة تعليمية تفاعلية بصيغة JSON.

النص التعليمي:
"""
${text.substring(0, 12000)}
"""

أرجع كائن JSON فقط (بدون أي نص إضافي أو Markdown) يحتوي على مصفوفة باسم "slides".
أنواع الشرائح الثلاثة:
1. شريحة معلومات: {"type":"info","title":"عنوان","content":"شرح مختصر..."}
2. اختيار من متعدد: {"type":"mcq","question":"السؤال...","options":["خيار1","خيار2","خيار3","خيار4"],"correctIndex":0,"explanation":"شرح الإجابة..."}
3. صح وخطأ: {"type":"tf","question":"السؤال...","isTrue":true,"explanation":"شرح..."}

وزّع الشرائح: شريحة أو شريحتا معلومات ثم سؤال أو سؤالان. الإجمالي بين 6 و14 شريحة.
الناتج يجب أن يبدأ بـ { وينتهي بـ } فقط.`;

  const response = await groqRequest(apiKey, [
    { role: 'system', content: 'أنت مساعد تعليمي متخصص. ترد دائماً بـ JSON صالح فقط بدون أي نص إضافي.' },
    { role: 'user', content: prompt },
  ]);

  const content = response.choices?.[0]?.message?.content || '';

  // 3. Parse JSON
  try {
    return JSON.parse(content);
  } catch {
    // Try extracting JSON block if model added extra text
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    log.error('Failed to parse Groq response:', content);
    throw new Error('فشل في تحليل استجابة الذكاء الاصطناعي إلى JSON.');
  }
}

module.exports = { generateQuizFromPDF };
