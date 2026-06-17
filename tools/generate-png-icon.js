// إنشاء أيقونة PNG باستخدام Canvas في Node.js
const fs = require('fs');
const path = require('path');

// إنشاء HTML مؤقت لتوليد الأيقونة
const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
</head>
<body>
    <canvas id="canvas" width="256" height="256"></canvas>
    <script>
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        
        // خلفية متدرجة زرقاء
        const gradient = ctx.createLinearGradient(0, 0, 256, 256);
        gradient.addColorStop(0, '#2563eb');
        gradient.addColorStop(1, '#1d4ed8');
        
        // رسم الخلفية
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);
        
        // إطار دائري أبيض شفاف
        ctx.beginPath();
        ctx.arc(128, 128, 110, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 6;
        ctx.stroke();
        
        // النص الرئيسي AC
        ctx.fillStyle = 'white';
        ctx.font = 'bold 72px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('AC', 128, 115);
        
        // النص الفرعي
        ctx.font = 'bold 18px Arial, sans-serif';
        ctx.fillText('Active Class', 128, 180);
        
        // تحويل إلى base64
        const dataURL = canvas.toDataURL('image/png');
        
        // إرسال البيانات للكونسول
        console.log('PNG_DATA:' + dataURL);
    </script>
</body>
</html>
`;

// كتابة الملف المؤقت
const tempHtmlPath = path.join(__dirname, 'temp-icon-generator.html');
fs.writeFileSync(tempHtmlPath, htmlContent);

console.log('تم إنشاء ملف HTML مؤقت:', tempHtmlPath);
console.log('افتح هذا الملف في المتصفح وانسخ الأيقونة من Developer Console');
console.log('أو استخدم الأيقونة SVG الموجودة في assets/icon.svg');