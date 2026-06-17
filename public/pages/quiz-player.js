// public/pages/quiz-player.js

(function() {
    let currentLesson = null;
    let currentSlideIndex = 0;
    let slides = [];
    let isAnswered = false;

    // Elements
    const container = document.getElementById('ai-player-container');
    const loadingEl = document.getElementById('player-loading');
    const errorEl = document.getElementById('player-error');
    const errorText = document.getElementById('player-error-text');
    const uiEl = document.getElementById('player-ui');
    const titleEl = document.getElementById('player-title');
    const counterEl = document.getElementById('slide-counter');
    const progressEl = document.getElementById('player-progress');
    const slideContainer = document.getElementById('slide-container');
    const btnNext = document.getElementById('btn-next');
    const btnPrev = document.getElementById('btn-prev');
    const btnClose = document.getElementById('btn-close-player');
    const celebrationOverlay = document.getElementById('celebration-overlay');

    // Audio effects
    const soundCorrect = new Audio('assets/sounds/correct.mp3'); // Assuming these exist, otherwise it fails silently
    const soundIncorrect = new Audio('assets/sounds/wrong.mp3');
    
    // Attempt to load sounds, catch errors if files don't exist
    soundCorrect.addEventListener('error', () => { soundCorrect.src = ''; });
    soundIncorrect.addEventListener('error', () => { soundIncorrect.src = ''; });

    // Initialization based on URL hash
    function init() {
        const hash = window.location.hash;
        const match = hash.match(/#\/ai-player\/(.+)/);
        
        if (match && match[1]) {
            const lessonId = match[1];
            loadLesson(lessonId);
        } else {
            showError("معرف الدرس غير متاح.");
        }
    }

    async function loadLesson(id) {
        try {
            const res = await fetch(`/api/ai-lessons/${id}`);
            const data = await res.json();

            if (!res.ok) throw new Error(data.message || 'فشل في تحميل الدرس');
            
            if (!data.content || !data.content.slides || data.content.slides.length === 0) {
                throw new Error("محتوى الدرس فارغ أو غير صالح.");
            }

            currentLesson = data;
            slides = data.content.slides;
            currentSlideIndex = 0;
            
            titleEl.textContent = currentLesson.title;
            
            loadingEl.classList.add('hidden');
            uiEl.classList.remove('hidden');
            uiEl.classList.add('flex');
            
            renderSlide();
        } catch (error) {
            loadingEl.classList.add('hidden');
            errorEl.classList.remove('hidden');
            errorEl.classList.add('flex');
            errorText.textContent = error.message;
        }
    }

    function renderSlide() {
        if (currentSlideIndex < 0) currentSlideIndex = 0;
        if (currentSlideIndex >= slides.length) currentSlideIndex = slides.length - 1;

        const slide = slides[currentSlideIndex];
        isAnswered = false; // Reset for questions

        // Update UI state
        counterEl.textContent = `${currentSlideIndex + 1}/${slides.length}`;
        const progressPercent = ((currentSlideIndex + 1) / slides.length) * 100;
        progressEl.style.width = `${progressPercent}%`;

        btnPrev.disabled = currentSlideIndex === 0;
        
        // Clear previous content
        slideContainer.innerHTML = '';
        
        // Create slide element with animation
        const slideWrapper = document.createElement('div');
        slideWrapper.className = 'w-full max-w-2xl slide-enter';
        
        if (slide.type === 'info') {
            slideWrapper.innerHTML = `
                <div class="bg-indigo-50 text-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-6 mx-auto shadow-inner">
                    <i class="fas fa-lightbulb"></i>
                </div>
                <h2 class="text-3xl font-bold text-center text-gray-800 mb-6 leading-relaxed">${slide.title}</h2>
                <div class="text-xl text-gray-600 leading-loose text-center bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
                    ${slide.content.replace(/\n/g, '<br>')}
                </div>
            `;
            btnNext.disabled = false; // Info slides can be skipped immediately
            
        } else if (slide.type === 'mcq') {
            btnNext.disabled = true; // Must answer first
            const optionsHtml = slide.options.map((opt, i) => `
                <button class="option-btn w-full text-right p-5 rounded-xl bg-white border-2 border-gray-100 shadow-sm text-lg text-gray-700 font-medium flex items-center justify-between group" data-index="${i}">
                    <span>${opt}</span>
                    <div class="w-6 h-6 rounded-full border-2 border-gray-300 group-hover:border-indigo-400 flex items-center justify-center"></div>
                </button>
            `).join('');

            slideWrapper.innerHTML = `
                <div class="bg-blue-50 text-blue-600 w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-6 mx-auto shadow-inner">
                    <i class="fas fa-question"></i>
                </div>
                <h2 class="text-2xl font-bold text-center text-gray-800 mb-8 leading-relaxed">${slide.question}</h2>
                <div class="flex flex-col gap-4 options-container">
                    ${optionsHtml}
                </div>
                <div id="explanation-box" class="hidden mt-6 p-5 rounded-xl text-center text-lg shadow-sm border animate-fade-in"></div>
            `;
        } else if (slide.type === 'tf') {
            btnNext.disabled = true;
            slideWrapper.innerHTML = `
                <div class="bg-purple-50 text-purple-600 w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-6 mx-auto shadow-inner">
                    <i class="fas fa-check-double"></i>
                </div>
                <h2 class="text-2xl font-bold text-center text-gray-800 mb-8 leading-relaxed">${slide.question}</h2>
                <div class="flex gap-4 options-container justify-center">
                    <button class="option-btn flex-1 py-6 rounded-xl bg-white border-2 border-gray-100 shadow-sm text-2xl text-emerald-600 font-bold flex flex-col items-center gap-2 hover:bg-emerald-50 hover:border-emerald-200" data-val="true">
                        <i class="fas fa-check-circle text-4xl"></i> صح
                    </button>
                    <button class="option-btn flex-1 py-6 rounded-xl bg-white border-2 border-gray-100 shadow-sm text-2xl text-red-600 font-bold flex flex-col items-center gap-2 hover:bg-red-50 hover:border-red-200" data-val="false">
                        <i class="fas fa-times-circle text-4xl"></i> خطأ
                    </button>
                </div>
                <div id="explanation-box" class="hidden mt-6 p-5 rounded-xl text-center text-lg shadow-sm border animate-fade-in"></div>
            `;
        }

        slideContainer.appendChild(slideWrapper);
        attachOptionListeners(slide);
    }

    function attachOptionListeners(slide) {
        if (slide.type === 'info') return;

        const btns = slideContainer.querySelectorAll('.option-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', function() {
                if (isAnswered) return;
                isAnswered = true;

                // Disable all buttons
                btns.forEach(b => {
                    b.disabled = true;
                    b.classList.remove('hover:bg-blue-50/50', 'hover:border-blue-200', 'group-hover:border-indigo-400', 'hover:bg-emerald-50', 'hover:bg-red-50');
                });

                let isCorrect = false;

                if (slide.type === 'mcq') {
                    const selectedIndex = parseInt(this.dataset.index);
                    isCorrect = selectedIndex === slide.correctIndex;
                    
                    // Mark correct answer visually regardless
                    btns[slide.correctIndex].classList.add('correct');
                    btns[slide.correctIndex].querySelector('div').innerHTML = '<i class="fas fa-check text-emerald-600"></i>';
                    btns[slide.correctIndex].querySelector('div').classList.add('border-emerald-500', 'bg-emerald-100');

                    if (!isCorrect) {
                        this.classList.add('incorrect');
                        this.querySelector('div').innerHTML = '<i class="fas fa-times text-red-600"></i>';
                        this.querySelector('div').classList.add('border-red-500', 'bg-red-100');
                    }
                } else if (slide.type === 'tf') {
                    const selectedVal = this.dataset.val === 'true';
                    isCorrect = selectedVal === slide.isTrue;
                    
                    if (isCorrect) {
                        this.classList.add('correct');
                    } else {
                        this.classList.add('incorrect');
                        // Highlight the other one as correct
                        const correctBtn = Array.from(btns).find(b => (b.dataset.val === 'true') === slide.isTrue);
                        if(correctBtn) correctBtn.classList.add('correct');
                    }
                }

                // Show Explanation
                const expBox = document.getElementById('explanation-box');
                if (expBox) {
                    expBox.classList.remove('hidden');
                    expBox.innerHTML = `<strong>${isCorrect ? 'إجابة صحيحة! 🎉' : 'إجابة خاطئة! ❌'}</strong><br><span class="text-sm mt-2 block">${slide.explanation || ''}</span>`;
                    
                    if (isCorrect) {
                        expBox.classList.add('bg-emerald-50', 'border-emerald-200', 'text-emerald-800');
                        if (soundCorrect.src) soundCorrect.play().catch(e => {});
                        showCelebration();
                    } else {
                        expBox.classList.add('bg-red-50', 'border-red-200', 'text-red-800');
                        if (soundIncorrect.src) soundIncorrect.play().catch(e => {});
                    }
                }

                // Enable Next Button
                btnNext.disabled = false;
            });
        });
    }

    function showCelebration() {
        celebrationOverlay.classList.remove('hidden');
        setTimeout(() => {
            celebrationOverlay.classList.add('hidden');
        }, 1200);
    }

    // Navigation Events
    btnNext.addEventListener('click', () => {
        if (currentSlideIndex < slides.length - 1) {
            // Animate out
            const currentWrapper = slideContainer.querySelector('.slide-enter');
            if (currentWrapper) {
                currentWrapper.classList.remove('slide-enter');
                currentWrapper.classList.add('slide-exit');
                
                setTimeout(() => {
                    currentSlideIndex++;
                    renderSlide();
                }, 300);
            } else {
                currentSlideIndex++;
                renderSlide();
            }
        } else {
            // Finish
            alert('لقد أتممت الدرس بنجاح! 🏆');
            window.location.hash = '#/content';
        }
    });

    btnPrev.addEventListener('click', () => {
        if (currentSlideIndex > 0) {
            currentSlideIndex--;
            renderSlide();
        }
    });

    btnClose.addEventListener('click', () => {
        window.history.back();
    });

    // Run init
    init();
})();
