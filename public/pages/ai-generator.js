// public/pages/ai-generator.js

(function() {
    const dropzone = document.getElementById('ai-dropzone');
    const fileInput = document.getElementById('ai-file-input');
    const loadingState = document.getElementById('ai-loading');
    const lessonsList = document.getElementById('ai-lessons-list');

    if (!dropzone || !fileInput) {
        console.error('AI Generator elements not found in DOM.');
        return;
    }

    // Fetch initial list
    fetchLessons();

    // Drag and Drop Events
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    });

    // Click to upload
    dropzone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileUpload(e.target.files[0]);
        }
    });

    async function handleFileUpload(file) {
        if (file.type !== 'application/pdf') {
            alert('الرجاء رفع ملف PDF فقط.');
            return;
        }

        const formData = new FormData();
        formData.append('pdf', file);

        // Show loading
        dropzone.style.display = 'none';
        loadingState.classList.add('active');

        try {
            const res = await window.authFetch('/api/generate-ai-quiz', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.message || 'حدث خطأ أثناء التوليد.');
            }

            // Success
            alert('تم إنشاء الدرس بنجاح!');
            fetchLessons(); // Refresh list
        } catch (error) {
            alert(error.message);
        } finally {
            // Hide loading
            loadingState.classList.remove('active');
            dropzone.style.display = 'flex';
            fileInput.value = ''; // reset
        }
    }

    async function fetchLessons() {
        try {
            const res = await window.authFetch('/api/ai-lessons');
            
            if (!res.ok) {
                throw new Error(`خطأ في خادم البيانات (${res.status})`);
            }
            
            const data = await res.json();
            renderLessons(data);
        } catch (error) {
            console.error('Error fetching lessons:', error);
            lessonsList.innerHTML = `
                <div class="ai-empty-state">
                    <i class="fas fa-exclamation-triangle" style="color: #ef4444; font-size: 2rem;"></i>
                    <p style="margin-top: 0.5rem;">${error.message || 'فشل جلب الدروس السابقة.'}</p>
                    <p style="font-size: 0.75rem; color: #9ca3af; margin-top: 0.5rem; text-align: center;">يرجى إعادة تشغيل البرنامج بالكامل (أغلق النافذة وافتحها مجدداً) ليتم تفعيل مسارات خادم الـ API الجديدة.</p>
                </div>
            `;
        }
    }

    function renderLessons(lessons) {
        if (!lessons || lessons.length === 0) {
            lessonsList.innerHTML = `
                <div class="ai-empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>لا توجد دروس مولدة حتى الآن.</p>
                </div>
            `;
            return;
        }

        lessonsList.innerHTML = lessons.map(lesson => `
            <div class="ai-lesson-item" onclick="window.location.hash = '#/ai-player/${lesson.id}'">
                <div>
                    <div class="ai-lesson-icon">
                        <i class="fas fa-book-reader"></i>
                    </div>
                    <h3 class="ai-lesson-title">${lesson.title}</h3>
                </div>
                <div class="ai-lesson-footer">
                    <span>${new Date(lesson.created_at).toLocaleDateString('ar-EG')}</span>
                    <button class="ai-lesson-play">تشغيل <i class="fas fa-play" style="font-size: 0.6rem;"></i></button>
                </div>
            </div>
        `).join('');
    }
})();
