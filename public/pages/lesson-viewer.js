document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const lessonTitleElement = document.getElementById('lesson-title');
    const contentItemsListElement = document.getElementById('content-items-list');
    const displayAreaElement = document.getElementById('display-area');

    // --- State ---
    let currentLesson = null;

    // --- Initialization ---
    async function initialize() {
        const lessonId = getLessonIdFromURL();

        if (!lessonId) {
            displayError('لم يتم العثور على معرف الدرس في الرابط.');
            return;
        }

        await fetchLessonData(lessonId);
        setupEventListeners();
    }

    function getLessonIdFromURL() {
        const params = new URLSearchParams(window.location.search);
        return params.get('lessonId');
    }

    async function fetchLessonData(lessonId) {
        try {
            const response = await fetch(`/api/lesson/${lessonId}`);
            if (!response.ok) {
                throw new Error(`فشل تحميل بيانات الدرس. الحالة: ${response.status}`);
            }
            currentLesson = await response.json();
            renderLesson();
        } catch (error) {
            console.error('Error fetching lesson data:', error);
            displayError(error.message);
        }
    }

    function getFileIcon(path) {
        const extension = (path.split('.').pop() || '').toLowerCase();
        switch (extension) {
            case 'pdf': return '📕';
            case 'ppt':
            case 'pptx': return '📊';
            case 'jpg':
            case 'jpeg':
            case 'png':
            case 'gif': return '🖼️';
            case 'mp4':
            case 'mov':
            case 'avi':
            case 'webm': return '🎬';
            case 'doc':
            case 'docx': return '📝';
            case 'zip':
            case 'rar': return '📦';
            default: return '📄';
        }
    }

    // --- Rendering Functions ---
    function renderLesson() {
        if (!currentLesson) return;

        // Set lesson title
        lessonTitleElement.textContent = currentLesson.name;

        // Populate content items list
        contentItemsListElement.innerHTML = ''; // Clear list
        if (!currentLesson.content || currentLesson.content.length === 0) {
            contentItemsListElement.innerHTML = '<li>لا يوجد محتوى لهذا الدرس.</li>';
            displayAreaElement.innerHTML = '<p class="placeholder">لا يوجد محتوى لعرضه.</p>';
            return;
        }

        currentLesson.content.forEach(item => {
            const li = document.createElement('li');
            li.dataset.id = item.id;

            let icon = '';
            let title = '';

            switch (item.type) {
                case 'file':
                    icon = getFileIcon(item.path);
                    title = item.name;
                    break;
                case 'link':
                    icon = '🔗';
                    title = item.title;
                    break;
                case 'quiz':
                    icon = '📝';
                    // The title is now added by the server endpoint
                    title = item.title || 'اختبار'; 
                    break;
            }

            li.innerHTML = `<span class="item-icon">${icon}</span> <span>${title}</span>`;
            contentItemsListElement.appendChild(li);
        });

        // Auto-select first item or last viewed from localStorage
        const lastId = localStorage.getItem('lessonViewer:lastItemId');
        if (lastId) {
            const node = Array.from(contentItemsListElement.children).find(li => li.dataset.id === lastId);
            if (node) node.click();
        }
        if (!document.querySelector('#content-items-list li.active') && contentItemsListElement.firstElementChild) {
            contentItemsListElement.firstElementChild.click();
        }
    }

    function displayContent(itemId) {
        const item = currentLesson.content.find(c => c.id === itemId);
        if (!item) {
            displayAreaElement.innerHTML = '<p class="placeholder">لم يتم العثور على العنصر.</p>';
            return;
        }

        let contentHtml = '';

        switch (item.type) {
            case 'file':
                const filePath = item.path.startsWith('/') ? item.path : '/' + item.path;
                const fileName = item.name || item.path.split('/').pop();
                const fileExtension = fileName.toLowerCase().split('.').pop();

                // Create enhanced viewer header
                const viewerHeader = `
                    <div class="viewer-header">
                        <h3 class="viewer-title">${fileName}</h3>
                        <div class="viewer-controls">
                            <button class="viewer-control-btn" onclick="toggleFullscreen()" title="ملء الشاشة">⛶</button>
                            <a href="${filePath}" download="${fileName}" class="viewer-control-btn" title="تحميل">⬇️</a>
                        </div>
                    </div>
                `;

                if (fileExtension === 'pdf') {
                    contentHtml = `
                        ${viewerHeader}
                        <div class="enhanced-pdf-viewer">
                            <iframe src="${filePath}" frameborder="0" class="content-frame"></iframe>
                        </div>
                    `;
                } else if (['ppt', 'pptx'].includes(fileExtension)) {
                    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                    if (isLocalhost) {
                        contentHtml = `
                            ${viewerHeader}
                            <div class="powerpoint-viewer-local">
                                <div class="local-message">
                                    <div class="file-icon">📊</div>
                                    <h4>عرض ملف PowerPoint</h4>
                                    <p>العرض المباشر لملفات PowerPoint يتطلب خادم متاح على الإنترنت.</p>
                                    <p>يمكنك تحميل الملف وفتحه في Microsoft PowerPoint للحصول على أفضل تجربة عرض.</p>
                                    <div class="local-actions">
                                        <a href="${filePath}" class="btn btn-primary" target="_blank" download>📥 تحميل الملف</a>
                                        <button class="btn btn-secondary" onclick="openInNewTab('${filePath}')">🔗 فتح في نافذة جديدة</button>
                                    </div>
                                </div>
                            </div>
                        `;
                    } else {
                        const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(window.location.origin + filePath)}`;
                        const googleViewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(window.location.origin + filePath)}&embedded=true`;
                        
                        contentHtml = `
                            ${viewerHeader}
                            <div class="enhanced-powerpoint-viewer">
                                <div class="viewer-tabs">
                                    <button class="viewer-tab active" onclick="switchViewer('office')">Office Online</button>
                                    <button class="viewer-tab" onclick="switchViewer('google')">Google Viewer</button>
                                </div>
                                <div class="viewer-content">
                                    <iframe id="office-viewer" src="${officeViewerUrl}" frameborder="0" class="content-frame active-viewer"></iframe>
                                    <iframe id="google-viewer" src="${googleViewerUrl}" frameborder="0" class="content-frame"></iframe>
                                </div>
                            </div>
                        `;
                    }
                } else if (['doc', 'docx'].includes(fileExtension)) {
                    const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(window.location.origin + filePath)}`;
                    contentHtml = `
                        ${viewerHeader}
                        <div class="enhanced-document-viewer">
                            <iframe src="${viewerUrl}" frameborder="0" class="content-frame"></iframe>
                        </div>
                    `;
                } else if (['xls', 'xlsx'].includes(fileExtension)) {
                    const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(window.location.origin + filePath)}`;
                    contentHtml = `
                        ${viewerHeader}
                        <div class="enhanced-spreadsheet-viewer">
                            <iframe src="${viewerUrl}" frameborder="0" class="content-frame"></iframe>
                        </div>
                    `;
                } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(fileExtension)) {
                    contentHtml = `
                        ${viewerHeader}
                        <div class="enhanced-image-viewer">
                            <img src="${filePath}" alt="${fileName}" class="content-image" onclick="toggleImageZoom(this)">
                        </div>
                    `;
                } else if (['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(fileExtension)) {
                    contentHtml = `
                        ${viewerHeader}
                        <div class="enhanced-video-viewer">
                            <video controls class="content-video" preload="metadata">
                                <source src="${filePath}" type="video/${fileExtension === 'mov' ? 'quicktime' : fileExtension}">
                                متصفحك لا يدعم تشغيل الفيديو.
                            </video>
                            <div class="video-info">
                                <p>📹 ${fileName}</p>
                            </div>
                        </div>
                    `;
                } else {
                    contentHtml = `
                        ${viewerHeader}
                        <div class="unsupported-file-viewer">
                            <div class="file-info">
                                <div class="file-icon">📄</div>
                                <h4>${fileName}</h4>
                                <p>نوع الملف: ${fileExtension.toUpperCase()}</p>
                                <p>لا يمكن عرض هذا النوع من الملفات في المتصفح.</p>
                                <div class="file-actions">
                                    <a href="${filePath}" class="btn btn-primary" target="_blank">فتح في نافذة جديدة</a>
                                    <a href="${filePath}" download="${fileName}" class="btn btn-secondary">تحميل الملف</a>
                                </div>
                            </div>
                        </div>
                    `;
                }
                break;

            case 'link':
                contentHtml = `
                    <div class="enhanced-link-viewer">
                        <div class="link-info">
                            <div class="link-icon">🔗</div>
                            <h3>${item.title}</h3>
                            <p>رابط خارجي - سيتم فتحه في نافذة جديدة</p>
                            <div class="link-actions">
                                <a href="${item.url}" class="btn btn-primary" target="_blank">🌐 الانتقال إلى الرابط</a>
                                <button class="btn btn-secondary" onclick="copyToClipboard('${item.url}')">📋 نسخ الرابط</button>
                            </div>
                        </div>
                    </div>
                `;
                break;

            case 'quiz':
                contentHtml = `
                    <div class="enhanced-quiz-viewer">
                        <div class="quiz-header">
                            <h3>📝 ${item.title || 'اختبار'}</h3>
                            <div class="quiz-actions">
                                <button class="btn btn-primary" onclick="openQuizInNewTab('${item.quizId}')">فتح الاختبار في نافذة جديدة</button>
                            </div>
                        </div>
                        <iframe class="embedded-quiz-iframe" src="/pages/quiz-view.html?id=${item.quizId}&embed=true"></iframe>
                    </div>
                `;
                break;

            default:
                contentHtml = '<p class="placeholder">نوع محتوى غير معروف.</p>';
                break;
        }

        displayAreaElement.innerHTML = contentHtml;
    }

    function displayError(message) {
        lessonTitleElement.textContent = 'خطأ';
        displayAreaElement.innerHTML = `<p class="placeholder" style="color: #c0392b;">${message}</p>`;
    }

    // --- Event Listeners ---
    function setupEventListeners() {
        contentItemsListElement.addEventListener('click', (e) => {
            const li = e.target.closest('li');
            if (!li || !li.dataset.id) return;

            // Remove active class from sibling elements safely
            [...contentItemsListElement.children].forEach(sib => sib.classList.remove('active'));

            // Add active class to the clicked item
            li.classList.add('active');

            // Persist last selected item
            localStorage.setItem('lessonViewer:lastItemId', li.dataset.id);

            // Display the content
            displayContent(li.dataset.id);
        });
    }

    // --- Start the application ---
    initialize();
});

// Global helper functions for enhanced viewer
function toggleFullscreen() {
    const displayArea = document.getElementById('display-area');
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        displayArea.requestFullscreen();
    }
}

function openInNewTab(url) {
    window.open(url, '_blank');
}

function switchViewer(viewerType) {
    // Remove active class from all tabs and viewers
    const tabs = document.querySelectorAll('.viewer-tab');
    const viewers = document.querySelectorAll('.content-frame');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    viewers.forEach(viewer => viewer.classList.remove('active-viewer'));
    
    // Add active class to selected tab and viewer
    const selectedTab = document.querySelector(`[onclick="switchViewer('${viewerType}')"]`);
    const selectedViewer = document.getElementById(`${viewerType}-viewer`);
    
    if (selectedTab) selectedTab.classList.add('active');
    if (selectedViewer) selectedViewer.classList.add('active-viewer');
}

function toggleImageZoom(img) {
    img.classList.toggle('zoomed');
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Show temporary notification
        const notification = document.createElement('div');
        notification.textContent = 'تم نسخ الرابط!';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4f46e5;
            color: white;
            padding: 10px 20px;
            border-radius: 6px;
            z-index: 1000;
            font-weight: 600;
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
    });
}

function openQuizInNewTab(quizId) {
    window.open(`/pages/quiz-view.html?id=${quizId}`, '_blank');
}