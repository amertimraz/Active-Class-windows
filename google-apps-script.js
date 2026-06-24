// ═══════════════════════════════════════════════════════════════════════
// Active Class — License Server على Google Apps Script (مجاني 100%)
// ═══════════════════════════════════════════════════════════════════════
//
// خطوات الإعداد:
// 1. افتح: script.google.com  →  New Project
// 2. امسح الكود الموجود والصق الكود ده كله
// 3. غيّر SECRET لكلمة سر خاصة بيك
// 4. من القائمة: Deploy → New deployment
//    - Type: Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 5. انسخ الـ URL الناتج (Web app URL)
// 6. ضعه في:
//    - admin-licenses.html  → ثابت SCRIPT_URL
//    - activation.js        → ثابت SCRIPT_URL
// ═══════════════════════════════════════════════════════════════════════

const CONFIG = {
  SPREADSHEET_ID:  '1aNPq7al91OGDb49E92KbDUUTiVT5NN-br2LpPNhN8M0',
  SECRET:          'ACTIVECLASSADMIN2025',   // ← غيّره لشيء سري
  SHEET_REQUESTS:  'طلبات',
  SHEET_LICENSES:  'تراخيص',
};

// ── Router ────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case 'register': return handleRegister(data);
      case 'verify':   return handleVerify(data);
      case 'issue':    return handleIssue(data);
      case 'revoke':   return handleRevoke(data);
      case 'restore':  return handleRestore(data);
      default:         return res({ ok: false, message: 'unknown action' });
    }
  } catch (err) {
    return res({ ok: false, message: err.message });
  }
}

function doGet(e) {
  try {
    if (e.parameter.secret !== CONFIG.SECRET)
      return res({ ok: false, message: 'unauthorized' });

    switch (e.parameter.action) {
      case 'requests': return res({ ok: true, data: getAllRequests() });
      case 'licenses': return res({ ok: true, data: getAllLicenses() });
      default:         return res({ ok: false, message: 'unknown action' });
    }
  } catch (err) {
    return res({ ok: false, message: err.message });
  }
}

// ── 1. تسجيل طلب من البرنامج ──────────────────────────────────────────────
function handleRegister(data) {
  const { name, phone, machineId } = data;
  if (!name || !phone) return res({ ok: false, message: 'name and phone required' });

  const sheet = getOrCreateSheet(CONFIG.SHEET_REQUESTS,
    ['id', 'الاسم', 'الموبايل', 'معرف الجهاز', 'تاريخ الطلب', 'الحالة']);

  // لو نفس الجهاز عنده طلب pending موجود مش هنضيفه تاني
  const all = sheetToObjects(sheet, rowToRequest);
  const dup = all.find(r => r.machineId === machineId && r.status === 'pending');
  if (dup) return res({ ok: true, message: 'already_registered' });

  sheet.appendRow([
    Utilities.getUuid(),
    name, phone,
    machineId || '',
    new Date().toISOString(),
    'pending',
  ]);

  return res({ ok: true, message: 'registered' });
}

// ── 2. التحقق من مفتاح (البرنامج يبعته عند التفعيل) ─────────────────────
function handleVerify(data) {
  const { key, machineId } = data;
  if (!key) return res({ ok: false, message: 'key required' });

  const licenses = getAllLicenses();
  const lic = licenses.find(l => l.key === key);

  if (!lic)        return res({ ok: false, message: 'مفتاح غير موجود' });
  if (lic.revoked) return res({ ok: false, message: 'تم إلغاء هذا الترخيص' });

  // التحقق من الجهاز لو المفتاح مربوط بجهاز معين
  if (lic.machineId && machineId && lic.machineId !== machineId)
    return res({ ok: false, message: 'هذا المفتاح مرتبط بجهاز مختلف' });

  const daysLeft = Math.ceil((new Date(lic.expiresAt) - new Date()) / 86400000);
  if (daysLeft <= 0) return res({ ok: false, message: 'انتهت صلاحية الترخيص' });

  return res({
    ok: true,
    name:      lic.name,
    plan:      lic.plan,
    expiresAt: String(lic.expiresAt).split('T')[0],
    daysLeft,
    totalDays: Number(lic.totalDays) || 365,
  });
}

// ── 3. إصدار ترخيص (من البانيل) ──────────────────────────────────────────
function handleIssue(data) {
  if (data.secret !== CONFIG.SECRET)
    return res({ ok: false, message: 'unauthorized' });

  const { key, name, phone, machineId, plan, totalDays, issuedAt, expiresAt } = data;

  const sheet = getOrCreateSheet(CONFIG.SHEET_LICENSES,
    ['id', 'المفتاح', 'الاسم', 'الموبايل', 'معرف الجهاز', 'الخطة', 'عدد الأيام', 'تاريخ الإصدار', 'تاريخ الانتهاء', 'ملغي']);

  // تجنب تكرار نفس المفتاح
  const existing = getAllLicenses().find(l => l.key === key);
  if (existing) return res({ ok: true, message: 'already_exists' });

  sheet.appendRow([
    Utilities.getUuid(),
    key, name, phone,
    machineId || '',
    plan, Number(totalDays),
    issuedAt, expiresAt,
    false,
  ]);

  // تحديث حالة الطلب في شيت الطلبات
  markRequestIssued(phone, machineId);

  return res({ ok: true });
}

// ── 4. إلغاء ترخيص ────────────────────────────────────────────────────────
function handleRevoke(data) {
  if (data.secret !== CONFIG.SECRET)
    return res({ ok: false, message: 'unauthorized' });

  return setRevokedState(data.key, true);
}

// ── 5. استعادة ترخيص ──────────────────────────────────────────────────────
function handleRestore(data) {
  if (data.secret !== CONFIG.SECRET)
    return res({ ok: false, message: 'unauthorized' });

  return setRevokedState(data.key, false);
}

// ── Sheet helpers ─────────────────────────────────────────────────────────
function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    const hRange = sh.getRange(1, 1, 1, headers.length);
    hRange.setBackground('#0f766e').setFontColor('#ffffff').setFontWeight('bold');
    sh.setColumnWidth(1, 220); // id column
  }
  return sh;
}

function sheetToObjects(sheet, mapper) {
  if (sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  return rows.filter(r => r[0]).map(mapper);
}

function getAllRequests() {
  const sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_REQUESTS);
  if (!sh) return [];
  return sheetToObjects(sh, rowToRequest);
}

function getAllLicenses() {
  const sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_LICENSES);
  if (!sh) return [];
  return sheetToObjects(sh, rowToLicense);
}

function markRequestIssued(phone, machineId) {
  try {
    const sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_REQUESTS);
    if (!sh || sh.getLastRow() < 2) return;
    const values = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
    values.forEach((r, i) => {
      if (r[2] === phone || (machineId && r[3] === machineId)) {
        sh.getRange(i + 2, 6).setValue('issued');
      }
    });
  } catch (e) { /* silent */ }
}

function setRevokedState(key, revoked) {
  const sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_LICENSES);
  if (!sh || sh.getLastRow() < 2) return res({ ok: false, message: 'not found' });
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][1] === key) {
      sh.getRange(i + 2, 10).setValue(revoked);
      return res({ ok: true });
    }
  }
  return res({ ok: false, message: 'not found' });
}

function rowToRequest(r) {
  return { id: r[0], name: r[1], phone: r[2], machineId: r[3], requestedAt: r[4], status: r[5] };
}

function rowToLicense(r) {
  return {
    id: r[0], key: r[1], name: r[2], phone: r[3], machineId: r[4],
    plan: r[5], totalDays: r[6], issuedAt: r[7], expiresAt: r[8], revoked: r[9],
  };
}

function res(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
