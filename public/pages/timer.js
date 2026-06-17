/**
 * المؤقت الذكي - نسخة مبسطة مع مودال عائم
 * مشابه لنموذج الأرقام العشوائية
 */

(function(){
  'use strict';

  // If embedded inside modal (iframe), remove the internal titlebar entirely
  try {
    if (window.top !== window) {
      const tb = document.querySelector('.tool-titlebar');
      if (tb) tb.remove();
    }
  } catch (_) {}

  console.log('Timer page loaded');
})();