const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const { PDFParse } = require('pdf-parse');
const log     = require('./logger').create('ai');

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
// Vision-capable model, used only when the uploaded file is an image.
// Groq's vision-model lineup changes over time — override with
// GROQ_VISION_MODEL in the environment if this default gets deprecated.
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

// Groq's free/on_demand tier enforces a tokens-PER-MINUTE cap that's shared
// across every request to a model (12,000 TPM for llama-3.3-70b-versatile,
// 30,000 TPM for the vision model at the time this was written). A single
// request whose prompt + max_tokens exceeds that cap gets rejected outright
// ("Request too large"), and back-to-back requests can also trip the
// cumulative per-minute limit ("Rate limit reached"). Keeping requests small
// and giving the token bucket time to refill between calls matters more here
// than asking for a huge completion budget.
const GROQ_MAX_TOKENS = parseInt(process.env.GROQ_MAX_TOKENS, 10) || 4096;
// Gemini has no per-minute TOKEN cap on the free tier (only a per-minute
// REQUEST cap, handled separately below), so it can afford a much bigger
// completion budget — capping it as low as Groq's just caused Gemini's
// responses to get cut off mid-JSON-array once a request asked for more
// than a couple of questions.
const GEMINI_MAX_TOKENS = parseInt(process.env.GEMINI_MAX_TOKENS, 10) || 8192;

// Rough token budget per question (options + JSON overhead) — used to keep
// max_tokens proportional to what was actually asked for instead of always
// reserving the full budget (which is itself what caused "Request too
// large" once max_tokens was raised for every call regardless of count).
function tokensForCount(mcqCount, tfCount, ceiling = GROQ_MAX_TOKENS) {
  const estimate = 250 + (mcqCount + tfCount) * 180;
  return Math.max(600, Math.min(ceiling, estimate));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function groqRequestOnce(apiKey, messages, model, maxTokens) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages,
      temperature: 0.4,
      max_tokens: maxTokens,
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

// If Groq rejects a request for hitting the per-minute token budget, its
// error message includes how long to wait (e.g. "Please try again in
// 4.404s"). Rather than failing immediately, wait that long (once) and
// retry — this alone fixes most of the transient rate-limit failures seen
// when several requests land in the same 60s window.
function parseRetryAfterMs(message) {
  const match = /try again in ([\d.]+)s/i.exec(message || '');
  if (!match) return null;
  return Math.ceil(parseFloat(match[1]) * 1000) + 250; // small safety margin
}

// Groq's free tier also caps REQUESTS per minute (30), separate from the
// tokens-per-minute cap — and this pipeline fires many small sequential
// requests (text chunks, PDF-page batches, top-up rounds, proofreading
// chunks) that can easily burst past 30/min even though each one is small
// on its own. This is a single global gate all requests funnel through, so
// no matter which function fires them, consecutive calls are always spaced
// at least MIN_REQUEST_GAP_MS apart.
const MIN_REQUEST_GAP_MS = 2200; // ~27 req/min, safely under the 30 req/min cap
let nextRequestAt = 0;

async function waitForRequestSlot() {
  const now = Date.now();
  const waitMs = nextRequestAt - now;
  nextRequestAt = Math.max(now, nextRequestAt) + MIN_REQUEST_GAP_MS;
  if (waitMs > 0) await sleep(waitMs);
}

async function groqRequest(apiKey, messages, model = GROQ_MODEL, maxTokens = GROQ_MAX_TOKENS) {
  await waitForRequestSlot();
  try {
    return await groqRequestOnce(apiKey, messages, model, maxTokens);
  } catch (err) {
    const waitMs = parseRetryAfterMs(err.message);
    const isRateLimit = /rate limit|too large/i.test(err.message || '');
    if (isRateLimit && waitMs && waitMs < 30000) {
      log.warn(`Groq rate limit hit, waiting ${waitMs}ms before retrying once:`, err.message);
      await sleep(waitMs);
      await waitForRequestSlot();
      return groqRequestOnce(apiKey, messages, model, maxTokens);
    }
    throw err;
  }
}

// ===== Google Gemini (additional provider — bigger free quota, reads PDFs
// and images natively without us having to render pages ourselves) =====
//
// Which Gemini models actually have a non-zero free-tier quota varies by
// account/project (e.g. a project with billing linked reports "limit: 0"
// for the free-tier metric on some models but not others). Rather than
// hardcoding one model name and making the teacher hunt for a working one
// manually, this tries a short list of candidates in order and remembers
// whichever one actually works for the rest of this run.
const GEMINI_MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL, // explicit override always tried first, if set
  'gemini-2.0-flash',
  'gemini-flash-latest',
  'gemini-1.5-flash',
  'gemini-2.5-flash',
].filter(Boolean);

let workingGeminiModel = null; // cached once a model is confirmed to work

// Gemini's free tier is generous on tokens/requests-per-day, but still caps
// requests-per-minute (commonly ~15 RPM on the free tier) — same kind of
// gate as Groq's, just a different number.
const MIN_GEMINI_REQUEST_GAP_MS = 4200; // ~14 req/min
let nextGeminiRequestAt = 0;

async function waitForGeminiSlot() {
  const now = Date.now();
  const waitMs = nextGeminiRequestAt - now;
  nextGeminiRequestAt = Math.max(now, nextGeminiRequestAt) + MIN_GEMINI_REQUEST_GAP_MS;
  if (waitMs > 0) await sleep(waitMs);
}

// Newer "thinking" Gemini models (2.5-series and similar) spend part of
// maxOutputTokens on an internal reasoning pass BEFORE writing the visible
// answer — by default, with no cap. That silently eats most/all of the
// token budget and is exactly what produces a response that looks "cut off"
// after just a few words even with a generous maxOutputTokens. Setting
// thinkingBudget: 0 disables that for models that support the field.
function supportsThinkingBudget(model) {
  return /2\.5|thinking/i.test(model);
}

function geminiRequestOnce(apiKey, systemInstruction, parts, maxTokens, model) {
  return new Promise((resolve, reject) => {
    const generationConfig = {
      responseMimeType: 'application/json',
      maxOutputTokens: maxTokens,
      temperature: 0.4,
    };
    if (supportsThinkingBudget(model)) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const body = JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts }],
      generationConfig,
    });

    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || 'Gemini API error'));

          const candidate = parsed.candidates?.[0];
          // Concatenate every text part rather than assuming parts[0] holds
          // the whole answer — some models return multiple parts (e.g. a
          // separate "thought" part ahead of the real content).
          const text = (candidate?.content?.parts || [])
            .filter(p => typeof p.text === 'string' && !p.thought)
            .map(p => p.text)
            .join('');

          if (!text) {
            const reason = candidate?.finishReason || 'unknown';
            return reject(new Error(`استجابة فارغة من Gemini API (finishReason: ${reason}).`));
          }
          if (candidate?.finishReason === 'MAX_TOKENS') {
            log.warn(`Gemini response hit MAX_TOKENS (model: ${model}, budget: ${maxTokens}) — output may be truncated.`);
          }
          resolve(text);
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function geminiRequest(apiKey, systemInstruction, parts, maxTokens) {
  const candidates = workingGeminiModel ? [workingGeminiModel] : GEMINI_MODEL_CANDIDATES;
  let lastErr = null;

  for (const model of candidates) {
    await waitForGeminiSlot();
    try {
      const result = await geminiRequestOnce(apiKey, systemInstruction, parts, maxTokens, model);
      workingGeminiModel = model; // remember what worked, skip the rest next time
      return result;
    } catch (err) {
      lastErr = err;
      // "limit: 0" means this model has NO free quota on this account at
      // all (not a transient rate limit) — move straight to the next
      // candidate instead of wasting a retry on something that can never work.
      const isZeroQuota = /limit:\s*0\b/i.test(err.message || '');
      const isRateLimit = /rate|quota|resource_exhausted|429/i.test(err.message || '');

      if (isZeroQuota) {
        log.warn(`Gemini model "${model}" has no free quota on this account, trying next candidate:`, err.message);
        continue;
      }
      if (isRateLimit) {
        log.warn(`Gemini rate limit hit on "${model}", waiting 6s before retrying once:`, err.message);
        await sleep(6000);
        await waitForGeminiSlot();
        try {
          const result = await geminiRequestOnce(apiKey, systemInstruction, parts, maxTokens, model);
          workingGeminiModel = model;
          return result;
        } catch (err2) {
          lastErr = err2;
          continue;
        }
      }
      throw err; // a real (non-quota) error — no point trying other models
    }
  }

  throw lastErr || new Error('لم يتمكن أي موديل Gemini من معالجة الطلب.');
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

// If the model's response got cut off mid-array (hit its output-token
// budget before finishing), the JSON is well-formed up to some point and
// then just stops — e.g. `{"questions":[{...},{...},{"text":"..."`. This
// salvages whatever complete question objects came before the cut instead
// of throwing away the whole batch over an incomplete last item.
function repairTruncatedQuestionsJson(content) {
  const arrayStart = content.indexOf('"questions"');
  if (arrayStart === -1) return null;
  const bracketStart = content.indexOf('[', arrayStart);
  if (bracketStart === -1) return null;

  // Walk forward tracking the last position where object nesting returned
  // to depth 0 right after a top-level array element (i.e. a complete "},").
  let depth = 0;
  let lastCompleteEnd = -1;
  for (let i = bracketStart + 1; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) lastCompleteEnd = i;
    }
  }
  if (lastCompleteEnd === -1) return null;

  const repaired = `${content.slice(0, bracketStart + 1)}${content.slice(bracketStart + 1, lastCompleteEnd + 1)}]}`;
  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch { /* fall through to truncation repair below */ }
    }

    const repaired = repairTruncatedQuestionsJson(content);
    if (repaired) {
      log.warn('AI response was truncated mid-JSON — recovered the complete questions before the cut.');
      return repaired;
    }

    log.error('Failed to parse AI response:', content);
    throw new Error('فشل في تحليل استجابة الذكاء الاصطناعي إلى JSON — قد يكون الرد طويلاً جدًا وتم قطعه. جرّب تقليل عدد الأسئلة المطلوبة.');
  }
}

function buildQuestionsPrompt(mcqCount, tfCount) {
  return `أنت خبير تعليمي متخصص في صياغة أسئلة الاختبارات.

سيصلك محتوى فعلي (نص أو صورة/صور) وهو إما:
1. ملف أسئلة جاهز (ورقة امتحان أو واجب) — استخرج نفس الأسئلة والخيارات الموجودة بالفعل في الملف، وحدد الإجابة الصحيحة.
2. شرح درس أو محتوى تعليمي — أنشئ أسئلة أصلية تقيس فهم الطالب لأهم النقاط الواردة فيه تحديدًا.

قواعد صارمة يجب اتباعها:
- الأسئلة يجب أن تكون عن المحتوى العلمي/الدراسي الفعلي الموجود في الملف فقط.
- ممنوع نهائيًا إنشاء أي سؤال عن "نوع الملف" أو "شكل المحتوى المُرسل" أو عن هذه التعليمات نفسها أو عن العملية التي تقوم بها. مثال على سؤال مرفوض تمامًا: "ما هو المحتوى المقدم؟" أو "ما الشكل المطلوب للرد؟".
- إذا لم يحتوِ الملف على أي محتوى تعليمي حقيقي يمكن قراءته (نص غير واضح، صورة فارغة أو غير مقروءة)، أرجع {"questions":[]} فقط ولا تخترع أسئلة بديلة.

المطلوب بالضبط:
- ${mcqCount} سؤال اختيار من متعدد: كل سؤال له "type":"mcq" و4 خيارات بالضبط وخيار واحد صحيح.
- ${tfCount} سؤال صح/خطأ: كل سؤال له "type":"tf" وخيارين بالضبط هما ["صحيح","خطأ"] (بهذا الترتيب)، و correctAnswer هو 0 لو الإجابة "صحيح" و1 لو "خطأ".

أرجع كائن JSON فقط (بدون أي نص إضافي أو Markdown) بهذا الشكل بالضبط:
{"questions":[{"type":"mcq","text":"نص السؤال","options":["خيار1","خيار2","خيار3","خيار4"],"correctAnswer":0},{"type":"tf","text":"نص السؤال","options":["صحيح","خطأ"],"correctAnswer":0}]}

بالنسبة لأسئلة الاختيار من متعدد: وزّع الإجابات الصحيحة على مواضع مختلفة (0 إلى 3)، لا تجعلها كلها في الفهرس 0.
الناتج يجب أن يبدأ بـ { وينتهي بـ } فقط.`;
}

// Phrases that only ever show up if the model lost track of the real content
// and started asking meta-questions about the prompt/task itself instead
// (e.g. "ما هو المحتوى المقدم؟" — a direct giveaway that no real file
// content reached it). Catching this here turns a confusing bad quiz into a
// clear, actionable error for the teacher instead.
const META_QUESTION_MARKERS = [
  'المحتوى المقدم', 'المحتوى المرسل', 'نوع الملف', 'شكل المحتوى',
  'الشكل المطلوب للرد', 'هذه التعليمات', 'الملف المرفق', 'نوع المحتوى',
];

function isMetaQuestion(q) {
  const haystack = [q.text, ...(q.options || [])].join(' ');
  return META_QUESTION_MARKERS.some(marker => haystack.includes(marker));
}

// Strips lone surrogate halves, the U+FFFD replacement character, and
// control characters — the "tofu box" (❑) artifacts that show up when a
// character got corrupted somewhere upstream (e.g. a chunk boundary that
// split a surrogate pair). This is a last line of defense in addition to
// the surrogate-safe chunking above, so any leftover corruption never
// reaches the teacher's screen.
function sanitizeText(s) {
  return String(s ?? '')
    .replace(/[\uD800-\uDFFF]/g, '') // lone/unpaired surrogates
    .replace(/�/g, '')          // replacement character
    .replace(/[ --]/g, '') // control chars
    .trim();
}

function validateQuestions(parsed) {
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const clean = questions
    .filter(q => q && typeof q.text === 'string' && Array.isArray(q.options) && q.options.length >= 2)
    .map(q => {
      const type = q.type === 'tf' ? 'tf' : 'mcq';
      const options = type === 'tf'
        ? ['صحيح', 'خطأ']
        : q.options.slice(0, 4).map(o => sanitizeText(o));
      const maxIdx = options.length - 1;
      return {
        type,
        text: sanitizeText(q.text),
        options,
        correctAnswer: Number.isInteger(q.correctAnswer) && q.correctAnswer >= 0 && q.correctAnswer <= maxIdx ? q.correctAnswer : 0,
        points: 1,
      };
    })
    .filter(q => q.text && q.options.every(o => o))
    .filter(q => q.type === 'tf' || q.options.length === 4)
    .filter(q => !isMetaQuestion(q));

  if (clean.length === 0) {
    throw new Error('لم يتمكن الذكاء الاصطناعي من قراءة محتوى تعليمي حقيقي في هذا الملف. جرّب ملفًا أوضح (صورة أعلى دقة أو PDF نصّي بدلاً من صورة ممسوحة).');
  }
  return clean;
}

function summarize(questions) {
  const mcqCount = questions.filter(q => q.type === 'mcq').length;
  const tfCount = questions.filter(q => q.type === 'tf').length;
  return { total: questions.length, mcqCount, tfCount };
}

const ARABIC_CHARS_RE = /[؀-ۿ]/;

// Extracting from scanned images/photos routinely introduces spelling and
// grammar noise (misread letters like "عل" instead of "على", "امل..."
// instead of "ال..." etc.) — this is a final proofreading pass that asks the
// model to fix spelling/grammar only, without changing meaning, wording
// style, or the number of questions. Best-effort: if anything about the
// response looks off, the original (pre-proofreading) questions are kept
// rather than risking corrupted content.
const PROOFREAD_CHUNK_SIZE = 6; // keeps each proofreading request small (TPM budget)

async function proofreadChunk(chunk, apiKey, provider) {
  const prompt = `راجع الأسئلة التالية (بصيغة JSON) وصحح فقط الأخطاء الإملائية والنحوية في نصوصها العربية.
لا تغيّر المعنى، ولا تضف أو تحذف أي سؤال أو خيار، ولا تغيّر "type" أو "correctAnswer" أو ترتيب الخيارات — فقط صحّح النص نفسه.

الأسئلة:
${JSON.stringify(chunk)}

أرجع نفس الكائن بالضبط بعد التصحيح الإملائي/النحوي فقط، بهذا الشكل: {"questions":[...]}`;
  const system = 'أنت مدقق لغوي عربي متخصص. ترد دائماً بـ JSON صالح فقط بدون أي نص إضافي.';

  let raw;
  if (provider === 'gemini') {
    raw = await geminiRequest(apiKey, system, [{ text: prompt }], tokensForCount(chunk.length, 0, GEMINI_MAX_TOKENS));
  } else {
    const response = await groqRequest(apiKey, [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ], GROQ_MODEL, tokensForCount(chunk.length, 0));
    raw = response.choices?.[0]?.message?.content || '';
  }

  const parsed = parseJsonContent(raw);
  const corrected = Array.isArray(parsed?.questions) ? parsed.questions : null;

  // Only trust the correction if it kept the same number of questions —
  // anything else suggests the model reshaped the data instead of just
  // proofreading it, so it's safer to keep the original chunk.
  return (corrected && corrected.length === chunk.length) ? corrected : chunk;
}

// Small chunks (rather than one big request) keep this well under the
// provider's per-request token cap, with a short pause between chunks so
// back-to-back requests don't trip the per-minute limit either.
async function proofreadArabic(questions, apiKey, provider = 'groq') {
  if (!apiKey || questions.length === 0) return questions;
  const hasArabic = questions.some(q => ARABIC_CHARS_RE.test(q.text) || q.options.some(o => ARABIC_CHARS_RE.test(o)));
  if (!hasArabic) return questions;

  const corrected = [];
  for (let i = 0; i < questions.length; i += PROOFREAD_CHUNK_SIZE) {
    const chunk = questions.slice(i, i + PROOFREAD_CHUNK_SIZE);
    try {
      corrected.push(...(await proofreadChunk(chunk, apiKey, provider)));
    } catch (err) {
      log.warn('Arabic proofreading chunk failed, keeping original text for it:', err.message);
      corrected.push(...chunk);
    }
    if (i + PROOFREAD_CHUNK_SIZE < questions.length) await sleep(500);
  }

  try {
    return validateQuestions({ questions: corrected });
  } catch {
    return questions; // corrected set somehow ended up empty — fall back to originals
  }
}

// Cheap pre-validation type counter, used to decide whether a top-up
// request is needed — mirrors the type normalization in validateQuestions()
// without doing the full cleanup/rejection pass.
function countRawByType(rawQuestions) {
  let mcq = 0, tf = 0;
  for (const q of rawQuestions) { if (q?.type === 'tf') tf++; else mcq++; }
  return { mcq, tf };
}

// Runs `ask(mcqCount, tfCount)` once, and if the model came back short of
// what was requested, asks ONE more time for just the missing amount and
// merges the two batches. This is what actually makes "أنا مختار 20 سؤال"
// land close to 20 instead of the model quietly stopping early.
// Models routinely under-deliver on an exact requested count, especially
// from images — one retry often isn't enough to close the gap. This keeps
// asking for whatever is still missing, up to `maxRounds` total attempts,
// and stops early once a round comes back empty (no point hammering the
// model once the source content is genuinely exhausted).
async function askWithTopUp(ask, mcqCount, tfCount, maxRounds = 4) {
  let all = await ask(mcqCount, tfCount);

  for (let round = 1; round < maxRounds; round++) {
    const have = countRawByType(all);
    const mcqShort = mcqCount - have.mcq;
    const tfShort = tfCount - have.tf;
    if (mcqShort <= 0 && tfShort <= 0) break;

    await sleep(600); // give the per-minute token budget a moment to refill
    let more;
    try {
      more = await ask(Math.max(0, mcqShort), Math.max(0, tfShort));
    } catch (err) {
      log.warn(`Top-up round ${round} failed, keeping what was already extracted:`, err.message);
      break;
    }
    if (!more || more.length === 0) break; // source exhausted, no point retrying further
    all = all.concat(more);
  }

  return all;
}

// Groq's free tier caps the text model at 12,000 tokens/minute — a whole
// book's text in one request blows past that instantly. Splitting it into
// chunks (like the PDF-page-image batching below) keeps every single
// request small, while still covering the entire document rather than
// silently reading only the first slice of it.
const TEXT_CHUNK_CHARS = 5000; // ~1200-1500 tokens per chunk, comfortably under the cap

// JS strings are UTF-16 — a plain .slice() at a fixed offset can land
// between the two halves of a surrogate pair (any character outside the
// Basic Multilingual Plane, e.g. an emoji that ended up in pasted text).
// That splits one real character into two invalid lone surrogates, each of
// which renders as a "tofu" box (❑) — which is exactly the "missing
// letters" bug this was causing. Nudging the boundary forward by one
// keeps every character whole.
function splitIntoChunks(text, size) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff && end < text.length) end += 1; // mid-surrogate-pair, extend by one
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}

async function extractQuestionsFromText(text, apiKey, mcqCount, tfCount) {
  if (!apiKey) throw new Error('لم يتم العثور على مفتاح Groq API في الإعدادات.');
  if (!text || text.trim().length === 0) {
    throw new Error('لم يتم العثور على نصوص قابلة للقراءة في الملف.');
  }

  const textChunks = splitIntoChunks(text, TEXT_CHUNK_CHARS);

  const askChunk = async (chunkText, mcq, tf) => {
    if (mcq + tf === 0) return [];
    const response = await groqRequest(apiKey, [
      { role: 'system', content: 'أنت مساعد تعليمي متخصص. ترد دائماً بـ JSON صالح فقط بدون أي نص إضافي.' },
      { role: 'user', content: `${buildQuestionsPrompt(mcq, tf)}\n\nالمحتوى:\n"""\n${chunkText}\n"""` },
    ], GROQ_MODEL, tokensForCount(mcq, tf));
    const raw = response.choices?.[0]?.message?.content || '';
    const parsed = parseJsonContent(raw);
    return Array.isArray(parsed?.questions) ? parsed.questions : [];
  };

  // A single chunk: same top-up behavior as before. Multiple chunks (a long
  // document): spread the requested counts across chunks like the PDF image
  // batches do, so the whole document gets read without any one request
  // ballooning past Groq's per-request token cap.
  let questions;
  if (textChunks.length <= 1) {
    questions = await askWithTopUp((mcq, tf) => askChunk(text, mcq, tf), mcqCount, tfCount);
  } else {
    questions = [];
    for (let i = 0; i < textChunks.length; i++) {
      const chunkMcq = Math.max(0, Math.round(mcqCount / textChunks.length));
      const chunkTf = Math.max(0, Math.round(tfCount / textChunks.length));
      if (chunkMcq + chunkTf === 0) continue;
      try {
        questions.push(...(await askChunk(textChunks[i], chunkMcq, chunkTf)));
      } catch (err) {
        log.warn(`Text chunk ${i + 1}/${textChunks.length} failed:`, err.message);
      }
      if (i < textChunks.length - 1) await sleep(600);
    }
    // Top up any shortfall using the first chunk (already have its content in scope).
    const have = countRawByType(questions);
    const mcqShort = mcqCount - have.mcq;
    const tfShort = tfCount - have.tf;
    if (mcqShort > 0 || tfShort > 0) {
      try {
        await sleep(600);
        questions.push(...(await askChunk(textChunks[0], Math.max(0, mcqShort), Math.max(0, tfShort))));
      } catch (err) {
        log.warn('Text top-up request failed:', err.message);
      }
    }
  }

  return validateQuestions({ questions });
}

async function extractQuestionsFromImage(imagePath, mimeType, apiKey, mcqCount, tfCount) {
  if (!apiKey) throw new Error('لم يتم العثور على مفتاح Groq API في الإعدادات.');

  const base64 = fs.readFileSync(imagePath, { encoding: 'base64' });
  const dataUrl = `data:${mimeType || 'image/png'};base64,${base64}`;

  const ask = async (mcq, tf) => {
    if (mcq + tf === 0) return [];
    const response = await groqRequest(apiKey, [
      { role: 'system', content: 'أنت مساعد تعليمي متخصص. ترد دائماً بـ JSON صالح فقط بدون أي نص إضافي.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildQuestionsPrompt(mcq, tf) },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ], GROQ_VISION_MODEL, tokensForCount(mcq, tf));
    const raw = response.choices?.[0]?.message?.content || '';
    const parsed = parseJsonContent(raw);
    return Array.isArray(parsed?.questions) ? parsed.questions : [];
  };

  const questions = await askWithTopUp(ask, mcqCount, tfCount);
  return validateQuestions({ questions });
}

// Groq (like most vision APIs) works best with a handful of images per
// request — so a scanned book's pages are processed in batches of this size
// rather than one giant request, and the results from every batch are
// merged. This is what lets a 7-, 20-, or 50-page scanned PDF actually get
// read in full instead of being silently cut off after the first few pages.
// Kept small (and page images downscaled below) since every image adds a
// meaningful chunk of tokens toward the vision model's per-minute cap.
const PDF_IMAGE_BATCH_SIZE = 3;

// Renders `pageCount` PDF pages as images (in batches) and sends each batch
// to the vision model, splitting the requested question counts across
// batches so the total still lands close to what the teacher asked for.
// Used when the PDF has no real text layer (scanned pages/a "book made of
// images", as opposed to a text-based PDF).
async function extractQuestionsFromPdfPages(parser, pageCount, apiKey, mcqCount, tfCount) {
  if (!apiKey) throw new Error('لم يتم العثور على مفتاح Groq API في الإعدادات.');

  const batchCount = Math.max(1, Math.ceil(pageCount / PDF_IMAGE_BATCH_SIZE));
  const batchImageSets = [];

  const askBatch = async (imageParts, mcq, tf) => {
    if (mcq + tf === 0) return [];
    const content = [
      { type: 'text', text: buildQuestionsPrompt(mcq, tf) },
      ...imageParts,
    ];
    const response = await groqRequest(apiKey, [
      { role: 'system', content: 'أنت مساعد تعليمي متخصص. ترد دائماً بـ JSON صالح فقط بدون أي نص إضافي.' },
      { role: 'user', content },
    ], GROQ_VISION_MODEL, tokensForCount(mcq, tf));
    const responseContent = response.choices?.[0]?.message?.content || '';
    const parsed = parseJsonContent(responseContent);
    return Array.isArray(parsed?.questions) ? parsed.questions : [];
  };

  let allQuestions = [];
  for (let b = 0; b < batchCount; b++) {
    const firstPage = b * PDF_IMAGE_BATCH_SIZE + 1;
    const pagesInBatch = Math.min(PDF_IMAGE_BATCH_SIZE, pageCount - b * PDF_IMAGE_BATCH_SIZE);
    if (pagesInBatch <= 0) break;

    const shots = await parser.getScreenshot({
      partial: Array.from({ length: pagesInBatch }, (_, i) => firstPage + i),
      imageDataUrl: true,
      desiredWidth: 1000,
    });
    const imageParts = shots.pages.map(p => ({ type: 'image_url', image_url: { url: p.dataUrl } }));
    batchImageSets.push(imageParts);

    // Split the requested counts across batches so the combined total is
    // close to what was asked for, instead of asking for the full count
    // from every batch (which would wildly overshoot).
    const batchMcq = Math.max(0, Math.round(mcqCount / batchCount));
    const batchTf = Math.max(0, Math.round(tfCount / batchCount));
    if (batchMcq + batchTf === 0) continue;

    try {
      allQuestions.push(...(await askBatch(imageParts, batchMcq, batchTf)));
    } catch (err) {
      log.warn(`Batch ${b + 1}/${batchCount} (pages ${firstPage}-${firstPage + pagesInBatch - 1}) failed:`, err.message);
      // Keep going — a handful of readable pages beats failing the whole
      // extraction because of one bad batch.
    }
    if (b < batchCount - 1) await sleep(600); // space out requests within the per-minute budget
  }

  // If the combined batches still fell short of what was requested (models
  // routinely under-deliver on exact counts from images), keep asking for
  // the remaining shortfall — cycling through every page batch already
  // rendered (not just the last one) so each round has fresh material to
  // draw from, up to a handful of rounds or until a round comes back empty.
  const maxTopUpRounds = 4;
  for (let round = 0; round < maxTopUpRounds && batchImageSets.length > 0; round++) {
    const have = countRawByType(allQuestions);
    const mcqShort = mcqCount - have.mcq;
    const tfShort = tfCount - have.tf;
    if (mcqShort <= 0 && tfShort <= 0) break;

    await sleep(600);
    const imageParts = batchImageSets[round % batchImageSets.length];
    let more;
    try {
      more = await askBatch(imageParts, Math.max(0, mcqShort), Math.max(0, tfShort));
    } catch (err) {
      log.warn(`PDF top-up round ${round + 1} failed:`, err.message);
      break;
    }
    if (!more || more.length === 0) break; // source exhausted, stop retrying
    allQuestions = allQuestions.concat(more);
  }

  return { questions: validateQuestions({ questions: allQuestions }), pagesRead: pageCount };
}

async function extractQuestionsFromPDF(pdfPath, apiKey, mcqCount, tfCount, maxPages) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: dataBuffer });

  try {
    const info = await parser.getInfo();
    const totalPages = info.total || 0;
    const pagesToRead = maxPages && maxPages > 0 ? Math.min(maxPages, totalPages) : totalPages;

    const textResult = await parser.getText({ first: pagesToRead });
    const text = textResult.text || '';

    // A real text-based PDF should have far more than this per page on
    // average; a near-empty result means the pages are scanned images with
    // no embedded text layer, so fall back to rendering them as images.
    if (text.trim().length < 200) {
      const result = await extractQuestionsFromPdfPages(parser, pagesToRead, apiKey, mcqCount, tfCount);
      return { questions: result.questions, pagesRead: result.pagesRead, totalPages, mode: 'scanned-images' };
    }

    const questions = await extractQuestionsFromText(text, apiKey, mcqCount, tfCount);
    return { questions, pagesRead: pagesToRead, totalPages, mode: 'text' };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

// Gemini reads PDFs and images natively in a single request (no need to
// render pages to images ourselves like the Groq path does), and its free
// tier has a much bigger daily quota — so the whole file just gets sent
// as-is and Gemini handles however many pages it contains.
async function extractQuizQuestionsGemini(filePath, mimeType, apiKey, mcqCount, tfCount, maxPages) {
  const ext = path.extname(filePath).toLowerCase();
  const isImage = (mimeType && mimeType.startsWith('image/')) || ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
  const isPdf = (mimeType === 'application/pdf') || ext === '.pdf';

  let filePart;
  let pagesRead = 1;
  let totalPages = 1;
  let mode = 'image';

  if (isImage) {
    const base64 = fs.readFileSync(filePath, { encoding: 'base64' });
    filePart = { inline_data: { mime_type: mimeType || 'image/png', data: base64 } };
  } else if (isPdf) {
    // Only used to report page counts in the stats bar — Gemini itself reads
    // the raw PDF bytes below, no per-page rendering needed on our side.
    try {
      const parser = new PDFParse({ data: fs.readFileSync(filePath) });
      const info = await parser.getInfo();
      totalPages = info.total || 1;
      await parser.destroy().catch(() => {});
    } catch { /* best-effort page count only */ }
    pagesRead = maxPages && maxPages > 0 ? Math.min(maxPages, totalPages) : totalPages;
    mode = 'pdf-native';

    const base64 = fs.readFileSync(filePath, { encoding: 'base64' });
    filePart = { inline_data: { mime_type: 'application/pdf', data: base64 } };
  } else {
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text || text.trim().length === 0) {
      throw new Error('لم يتم العثور على نصوص قابلة للقراءة في الملف.');
    }
    filePart = { text: `المحتوى:\n"""\n${text}\n"""` };
    mode = 'text-file';
  }

  const system = 'أنت مساعد تعليمي متخصص. ترد دائماً بـ JSON صالح فقط بدون أي نص إضافي.';
  const ask = async (mcq, tf) => {
    if (mcq + tf === 0) return [];
    const raw = await geminiRequest(apiKey, system, [{ text: buildQuestionsPrompt(mcq, tf) }, filePart], tokensForCount(mcq, tf, GEMINI_MAX_TOKENS));
    const parsed = parseJsonContent(raw);
    return Array.isArray(parsed?.questions) ? parsed.questions : [];
  };

  const questions = await askWithTopUp(ask, mcqCount, tfCount);
  return { questions: validateQuestions({ questions }), pagesRead, totalPages, mode };
}

// Extracts quiz questions from an uploaded file — routes to the right
// pipeline based on file type and chosen provider. Used by the "إنشاء
// اختبار بالذكاء الاصطناعي" feature in the quizzes page: teacher uploads a
// lesson explanation (PDF/txt) or a photo of a questions sheet, and reviews
// the extracted questions before they're published into a real quiz.
//
// `counts` lets the teacher control how many questions of each type come
// back, and `maxPages` limits how much of a long PDF gets read (useful for
// a whole textbook where only a chapter is relevant). `provider` is either
// 'groq' (default) or 'gemini'.
async function extractQuizQuestions(filePath, mimeType, apiKey, counts = {}, provider = 'groq') {
  const mcqCount = Number.isInteger(counts.mcqCount) && counts.mcqCount >= 0 ? counts.mcqCount : 8;
  const tfCount = Number.isInteger(counts.tfCount) && counts.tfCount >= 0 ? counts.tfCount : 2;
  const maxPages = Number.isInteger(counts.maxPages) && counts.maxPages > 0 ? counts.maxPages : null;

  if (!apiKey) throw new Error('لم يتم العثور على مفتاح API في الإعدادات.');
  if (mcqCount + tfCount === 0) {
    throw new Error('اختر عدد أسئلة أكبر من صفر (اختياري أو صح/خطأ).');
  }

  let questions, pagesRead = 1, totalPages = 1, mode = 'image';

  if (provider === 'gemini') {
    const result = await extractQuizQuestionsGemini(filePath, mimeType, apiKey, mcqCount, tfCount, maxPages);
    questions = result.questions;
    pagesRead = result.pagesRead;
    totalPages = result.totalPages;
    mode = result.mode;
  } else {
    const ext = path.extname(filePath).toLowerCase();
    const isImage = (mimeType && mimeType.startsWith('image/')) || ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
    const isPdf = (mimeType === 'application/pdf') || ext === '.pdf';

    if (isImage) {
      questions = await extractQuestionsFromImage(filePath, mimeType, apiKey, mcqCount, tfCount);
    } else if (isPdf) {
      const result = await extractQuestionsFromPDF(filePath, apiKey, mcqCount, tfCount, maxPages);
      questions = result.questions;
      pagesRead = result.pagesRead;
      totalPages = result.totalPages;
      mode = result.mode;
    } else {
      // Plain text fallback
      const text = fs.readFileSync(filePath, 'utf8');
      questions = await extractQuestionsFromText(text, apiKey, mcqCount, tfCount);
      mode = 'text-file';
    }
  }

  questions = await proofreadArabic(questions, apiKey, provider);

  return { questions, meta: { ...summarize(questions), pagesRead, totalPages, mode } };
}

module.exports = { generateQuizFromPDF, extractQuizQuestions };
