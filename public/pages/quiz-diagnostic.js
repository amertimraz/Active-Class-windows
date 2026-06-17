// تشخيص مشاكل الأسئلة والخيارات
(function() {
    'use strict';

    console.log('🔍 بدء تشخيص مشاكل الاختبار...');

    // التحقق من البيانات المحلية
    function checkLocalStorage() {
        console.log('\\n📊 فحص البيانات المحلية:');

        try {
            const quizzesData = localStorage.getItem('cm_quizzes_v1');
            if (!quizzesData) {
                console.warn('❌ لا توجد بيانات اختبارات في localStorage');
                return null;
            }

            const quizzes = JSON.parse(quizzesData);
            console.log(`✅ تم العثور على ${quizzes.length} اختبار`);

            quizzes.forEach((quiz, quizIndex) => {
                console.log(`\\n📝 اختبار ${quizIndex + 1}: ${quiz.name || 'بدون اسم'}`);
                console.log(`   المجموعة: ${quiz.groupId || 'غير محدد'}`);
                console.log(`   الأسئلة: ${quiz.questions ? quiz.questions.length : 0}`);

                if (quiz.questions && quiz.questions.length > 0) {
                    quiz.questions.forEach((question, qIndex) => {
                        console.log(`\\n   سؤال ${qIndex + 1}:`);
                        console.log(`     النوع: ${question.type || 'غير محدد'}`);
                        console.log(`     النص: ${question.text ? question.text.substring(0, 50) + '...' : 'فارغ'}`);

                        // فحص الخيارات
                        if (question.options) {
                            console.log(`     الخيارات: ${question.options.length}`);
                            question.options.forEach((opt, optIndex) => {
                                console.log(`       ${optIndex + 1}. ${opt.substring(0, 30)}...`);
                            });
                        } else {
                            console.error(`     ❌ لا توجد خيارات لهذا السؤال!`);
                        }

                        // فحص الإجابة الصحيحة
                        if (question.correctAnswer !== undefined) {
                            console.log(`     الإجابة الصحيحة: ${question.correctAnswer}`);
                        } else if (question.correct !== undefined) {
                            console.log(`     الإجابة الصحيحة (قديم): ${question.correct}`);
                        } else {
                            console.error(`     ❌ لا توجد إجابة صحيحة لهذا السؤال!`);
                        }
                    });
                } else {
                    console.error('   ❌ لا توجد أسئلة في هذا الاختبار!');
                }
            });

            return quizzes;
        } catch (error) {
            console.error('❌ خطأ في قراءة البيانات:', error);
            return null;
        }
    }

    // إنشاء اختبار تجريبي
    function createSampleQuiz() {
        console.log('\\n🛠️ إنشاء اختبار تجريبي...');

        const sampleQuiz = {
            id: 'diagnostic-quiz-' + Date.now(),
            name: 'اختبار تشخيصي',
            groupId: null,
            createdAt: new Date().toISOString(),
            questions: [
                {
                    id: 'q1-' + Date.now(),
                    type: 'mcq',
                    text: 'ما هو أكبر كوكب في المجموعة الشمسية؟',
                    options: ['الأرض', 'المريخ', 'المشتري', 'الزهرة'],
                    correctAnswer: 2, // المشتري
                    difficulty: 'easy',
                    points: 1
                },
                {
                    id: 'q2-' + Date.now(),
                    type: 'tf',
                    text: 'الشمس هي كوكب',
                    options: ['صح', 'خطأ'],
                    correctAnswer: 1, // خطأ
                    difficulty: 'easy',
                    points: 1
                },
                {
                    id: 'q3-' + Date.now(),
                    type: 'fill',
                    text: 'عاصمة فرنسا هي [___]',
                    correct: 'باريس',
                    difficulty: 'easy',
                    points: 1
                }
            ]
        };

        try {
            // الحصول على الاختبارات الموجودة
            let quizzes = [];
            const existingData = localStorage.getItem('cm_quizzes_v1');
            if (existingData) {
                quizzes = JSON.parse(existingData);
            }

            // إضافة الاختبار التجريبي
            quizzes.push(sampleQuiz);

            // حفظ البيانات
            localStorage.setItem('cm_quizzes_v1', JSON.stringify(quizzes));

            console.log('✅ تم إنشاء الاختبار التجريبي بنجاح!');
            console.log('🔗 يمكنك الآن فتح الاختبار من قائمة الاختبارات');

            return sampleQuiz;
        } catch (error) {
            console.error('❌ خطأ في إنشاء الاختبار التجريبي:', error);
            return null;
        }
    }

    // تشغيل التشخيص
    const quizzes = checkLocalStorage();

    if (!quizzes || quizzes.length === 0) {
        console.log('\\n📝 لا توجد اختبارات، سيتم إنشاء اختبار تجريبي...');
        createSampleQuiz();
    } else {
        console.log('\\n✅ تم العثور على اختبارات موجودة');
        console.log('💡 إذا كانت المشكلة في عرض الخيارات، تأكد من:');
        console.log('   1. وجود حقل options في كل سؤال');
        console.log('   2. وجود حقل correctAnswer أو correct');
        console.log('   3. أن نوع السؤال صحيح (mcq, tf, fill)');
    }

    console.log('\\n🔧 أدوات إضافية:');
    console.log('   createSampleQuiz() - إنشاء اختبار تجريبي');
    console.log('   checkLocalStorage() - فحص البيانات المحلية');

    // جعل الدوال متاحة عالمياً للاستخدام في وحدة التحكم
    window.createSampleQuiz = createSampleQuiz;
    window.checkLocalStorage = checkLocalStorage;
})();