(function(){
  var mapMarkerLayer = document.getElementById('map-marker-layer');
  var tapLayer = document.getElementById('map-tap-layer');
  var mapImageInput = document.getElementById('map-image-input');
  var mapImage = document.getElementById('custom-map-image');
  var mapPlaceholder = document.getElementById('map-placeholder');
  var mapPreview = document.getElementById('map-preview');
  var levelStatus = document.getElementById('level-status');
  var targetStatus = document.getElementById('target-status');
  var builderForm = document.getElementById('question-builder-form');
  var builderTitleInput = document.getElementById('builder-test-title');
  var builderLabelInput = document.getElementById('builder-point-label');
  var builderQuestionInput = document.getElementById('builder-question');
  var builderTypeSelect = document.getElementById('builder-type');
  var builderPointStatus = document.getElementById('builder-point-preview');
  var builderFeedback = document.getElementById('builder-feedback');
  var builderQuestionList = document.getElementById('builder-question-list');
  var saveTestBtn = document.getElementById('save-test-btn');
  var placePointBtn = document.getElementById('place-point-btn');
  var savedTestsGrid = document.getElementById('saved-tests-grid');
  var playModal = document.getElementById('play-modal');
  var playModalBackdrop = document.getElementById('play-modal-backdrop');
  var playModalClose = document.getElementById('close-play-modal');
  var playMapImage = document.getElementById('play-map-image');
  var playMapPlaceholder = document.getElementById('play-map-placeholder');
  var playMarkerLayer = document.getElementById('play-marker-layer');
  var playMapStatus = document.getElementById('play-map-status');
  var playQuestionArea = document.getElementById('play-question-area');
  var playResultsPanel = document.getElementById('play-results-panel');
  var playResultsLabel = document.getElementById('play-results-label');
  var playResultsCorrect = document.getElementById('play-results-correct');
  var playResultsIncorrect = document.getElementById('play-results-incorrect');
  var choiceInputs = Array.prototype.slice.call(document.querySelectorAll('.choice-input'));
  var choiceRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="choice-correct"]'));
  var booleanRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="boolean-correct"]'));
  var builderEditingBanner = document.getElementById('builder-editing-banner');
  var builderEditingTitle = document.getElementById('builder-editing-title');
  var cancelEditTestBtn = document.getElementById('cancel-edit-test-btn');
  var updateTestBtn = document.getElementById('update-test-btn');
  var cancelQuestionEditBtn = document.getElementById('cancel-question-edit-btn');
  var clearMapImageBtn = document.getElementById('clear-map-image-btn');
  var builderSubmitBtn = builderForm ? builderForm.querySelector('button[type="submit"]') : null;
  var STORAGE_KEY = 'cm_map_tests_v1';

  var state = {
    builderQuestions: [],
    pendingPoint: null,
    ghostMarker: null,
    placing: false,
    savedTests: [],
    currentTest: null,
    questionMap: {},
    mapImageLoaded: false,
    mapImageData: null,
    activePlayTest: null,
    playQuestionMap: {},
    playAnswerStatus: {},
    editingTestId: null,
    editingQuestionId: null
  };

  function init(){
    setInitialState();
    bindEvents();
    if(builderTypeSelect){
      toggleTypeFields();
    }
    state.savedTests = loadStoredTests();
    renderSavedTests();
  }

  function bindEvents(){
    if(builderTypeSelect){
      builderTypeSelect.addEventListener('change', toggleTypeFields);
    }
    if(mapImageInput){
      mapImageInput.addEventListener('change', handleMapImageChange);
    }
    if(placePointBtn && tapLayer){
      placePointBtn.addEventListener('click', enterPlacementMode);
      tapLayer.addEventListener('click', handleTapLayerClick);
    }
    if(builderForm){
      builderForm.addEventListener('submit', handleBuilderSubmit);
    }
    if(saveTestBtn){
      saveTestBtn.addEventListener('click', saveCurrentTest);
    }
    if(updateTestBtn){
      updateTestBtn.addEventListener('click', updateCurrentTest);
    }
    if(cancelEditTestBtn){
      cancelEditTestBtn.addEventListener('click', cancelTestEditMode);
    }
    if(cancelQuestionEditBtn){
      cancelQuestionEditBtn.addEventListener('click', exitQuestionEditMode);
    }
    if(clearMapImageBtn){
      clearMapImageBtn.addEventListener('click', handleClearMapButton);
    }
    if(builderQuestionList){
      builderQuestionList.addEventListener('click', handleBuilderListClick);
    }
    if(savedTestsGrid){
      savedTestsGrid.addEventListener('click', handleSavedGridClick);
    }
    if(builderTitleInput){
      builderTitleInput.addEventListener('input', updateEditingUI);
    }
    if(playModalBackdrop){
      playModalBackdrop.addEventListener('click', closePlayModal);
    }
    if(playModalClose){
      playModalClose.addEventListener('click', closePlayModal);
    }
    document.addEventListener('keydown', function(event){
      if(event.key === 'Escape'){
        closePlayModal();
      }
    });
  }

  function toggleTypeFields(){
    var type = builderTypeSelect ? builderTypeSelect.value : 'choice';
    var choiceFields = document.getElementById('choice-fields');
    var booleanField = document.getElementById('boolean-field');
    if(!choiceFields || !booleanField){
      return;
    }
    if(type === 'boolean'){
      choiceFields.classList.add('hidden');
      booleanField.classList.remove('hidden');
    } else {
      choiceFields.classList.remove('hidden');
      booleanField.classList.add('hidden');
    }
  }

  function handleMapImageChange(event){
    var file = event.target.files && event.target.files[0];
    if(!file){
      resetMapImage();
      return;
    }
    if(!/^image\//i.test(file.type)){
      setBuilderFeedback('اختر ملف صورة صالح', 'error');
      resetMapImage();
      return;
    }
    var reader = new FileReader();
    reader.onload = function(){
      applyMapImage(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function applyMapImage(src){
    if(!src){
      resetMapImage();
      return;
    }
    if(!mapImage){
      return;
    }
    state.mapImageData = src;
    state.mapImageLoaded = true;
    mapImage.src = src;
    mapImage.classList.remove('hidden');
    if(mapPlaceholder){
      mapPlaceholder.classList.add('hidden');
    }
    if(mapPreview){
      mapPreview.classList.add('has-image');
    }
    updateMapControls();
    renderMarkers();
  }

  function resetMapImage(){
    state.mapImageLoaded = false;
    state.mapImageData = null;
    if(mapImage){
      mapImage.removeAttribute('src');
      mapImage.classList.add('hidden');
    }
    if(mapPlaceholder){
      mapPlaceholder.classList.remove('hidden');
      mapPlaceholder.textContent = 'لم يتم رفع أي صورة بعد.';
    }
    if(mapPreview){
      mapPreview.classList.remove('has-image');
    }
    updateMapControls();
    renderMarkers();
  }

  function handleClearMapButton(event){
    if(event && typeof event.preventDefault === 'function'){
      event.preventDefault();
    }
    clearBuilderMapImage(false);
  }

  function clearBuilderMapImage(silent){
    if(!state.mapImageLoaded && !state.mapImageData){
      return;
    }
    resetMapImage();
    if(mapImageInput){
      mapImageInput.value = '';
    }
    if(state.editingTestId && !silent){
      setBuilderFeedback('تمت إزالة صورة الخريطة. لا تنس تحديث الاختبار.', 'success');
    }
  }

  function resetBuilderAfterSave(){
    state.pendingPoint = null;
    state.editingQuestionId = null;
    state.editingTestId = null;
    removeGhostMarker();
    setBuilderPointStatus('لم يتم اختيار نقطة بعد');
    resetQuestionFormFields();
    if(mapImageInput){
      mapImageInput.value = '';
    }
    resetMapImage();
    updateQuestionEditUI();
    updateEditingUI();
  }

  function enterPlacementMode(){
    if(!state.mapImageLoaded){
      setBuilderFeedback('ارفع صورة للخريطة قبل اختيار النقطة', 'error');
      return;
    }
    state.placing = true;
    setBuilderPointStatus('اضغط داخل الصورة لتحديد النقطة');
    if(tapLayer){
      tapLayer.classList.add('placing');
    }
  }

  function handleTapLayerClick(event){
    if(!state.placing || !tapLayer){
      return;
    }
    var rect = tapLayer.getBoundingClientRect();
    if(!rect.width || !rect.height){
      return;
    }
    var x = ((event.clientX - rect.left) / rect.width) * 100;
    var y = ((event.clientY - rect.top) / rect.height) * 100;
    x = Math.max(2, Math.min(98, x));
    y = Math.max(2, Math.min(98, y));
    state.pendingPoint = { x: roundOne(x), y: roundOne(y) };
    state.placing = false;
    tapLayer.classList.remove('placing');
    var message = (state.editingQuestionId ? 'إحداثيات جديدة للسؤال: ' : 'إحداثيات النقطة: ') + state.pendingPoint.x + '%, ' + state.pendingPoint.y + '%';
    setBuilderPointStatus(message);
    showGhostMarker();
  }

  function roundOne(value){
    return Math.round(value * 10) / 10;
  }

  function generateQuestionId(){
    return 'builder-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  }

  function resetQuestionFormFields(){
    if(builderForm){
      builderForm.reset();
    }
    choiceInputs.forEach(function(input){ input.value = ''; });
    choiceRadios.forEach(function(radio){ radio.checked = false; });
    booleanRadios.forEach(function(radio){ radio.checked = false; });
    if(builderLabelInput){
      builderLabelInput.value = '';
    }
    if(builderQuestionInput){
      builderQuestionInput.value = '';
    }
    if(builderTypeSelect){
      toggleTypeFields();
    }
  }

  function showGhostMarker(){
    if(!mapMarkerLayer || !state.pendingPoint){
      return;
    }
    if(!state.ghostMarker){
      state.ghostMarker = document.createElement('div');
      state.ghostMarker.className = 'ghost-pin';
    }
    state.ghostMarker.style.left = state.pendingPoint.x + '%';
    state.ghostMarker.style.top = state.pendingPoint.y + '%';
    mapMarkerLayer.appendChild(state.ghostMarker);
  }

  function removeGhostMarker(){
    if(state.ghostMarker && state.ghostMarker.parentNode){
      state.ghostMarker.parentNode.removeChild(state.ghostMarker);
    }
  }

  function handleBuilderSubmit(event){
    event.preventDefault();
    if(!builderForm){
      return;
    }
    var editingQuestionId = state.editingQuestionId;
    if(!state.mapImageLoaded && !editingQuestionId){
      setBuilderFeedback('ارفع صورة للخريطة أولاً', 'error');
      return;
    }
    if(!state.pendingPoint && !editingQuestionId){
      setBuilderFeedback('حدد نقطة على الخريطة قبل الحفظ', 'error');
      return;
    }
    var label = builderLabelInput ? builderLabelInput.value.trim() : '';
    var prompt = builderQuestionInput ? builderQuestionInput.value.trim() : '';
    var type = builderTypeSelect ? builderTypeSelect.value : 'choice';
    if(!prompt){
      setBuilderFeedback('أدخل نص السؤال', 'error');
      return;
    }
    var existingQuestion = editingQuestionId ? state.builderQuestions.find(function(item){ return item.id === editingQuestionId; }) : null;
    if(editingQuestionId && !existingQuestion){
      setBuilderFeedback('تعذر العثور على السؤال المطلوب', 'error');
      exitQuestionEditMode();
      return;
    }
    var coordsSource = state.pendingPoint ? { x_pct: state.pendingPoint.x, y_pct: state.pendingPoint.y } : null;
    if(!coordsSource && existingQuestion){
      coordsSource = { x_pct: existingQuestion.x_pct, y_pct: existingQuestion.y_pct };
    }
    if(!coordsSource){
      setBuilderFeedback('حدد نقطة على الخريطة قبل الحفظ', 'error');
      return;
    }
    var options = [];
    var correctIndex = null;
    var booleanAnswer = null;
    if(type === 'choice'){
      var invalid = false;
      choiceInputs.forEach(function(input, index){
        var value = input.value.trim();
        if(!value){
          invalid = true;
        }
        options[index] = value;
      });
      if(invalid){
        setBuilderFeedback('أكمل جميع الاختيارات الثلاثة', 'error');
        return;
      }
      var selected = choiceRadios.find(function(radio){ return radio.checked; });
      if(!selected){
        setBuilderFeedback('حدد الإجابة الصحيحة', 'error');
        return;
      }
      correctIndex = parseInt(selected.value, 10);
    } else if(type === 'boolean'){
      var boolSelected = booleanRadios.find(function(radio){ return radio.checked; });
      if(!boolSelected){
        setBuilderFeedback('حدد إذا كانت الإجابة صح أم خطأ', 'error');
        return;
      }
      booleanAnswer = boolSelected.value === 'true';
    }
    var finalLabel = label || (existingQuestion ? existingQuestion.label : 'نقطة ' + (state.builderQuestions.length + 1));
    var updatedQuestion = {
      id: existingQuestion ? existingQuestion.id : generateQuestionId(),
      label: finalLabel,
      prompt: prompt,
      x_pct: coordsSource.x_pct,
      y_pct: coordsSource.y_pct,
      type: type,
      options: type === 'choice' ? options : [],
      correctIndex: type === 'choice' ? correctIndex : null,
      booleanAnswer: type === 'boolean' ? booleanAnswer : null
    };
    if(existingQuestion && typeof existingQuestion.hint !== 'undefined'){
      updatedQuestion.hint = existingQuestion.hint;
    }
    if(existingQuestion){
      Object.assign(existingQuestion, updatedQuestion);
      setBuilderFeedback('تم تحديث السؤال الحالي', 'success');
    } else {
      state.builderQuestions.push(updatedQuestion);
      setBuilderFeedback('تمت إضافة السؤال إلى قائمة الاختبار', 'success');
    }
    if(builderLabelInput){ builderLabelInput.value = ''; }
    if(builderQuestionInput){ builderQuestionInput.value = ''; }
    choiceInputs.forEach(function(input){ input.value = ''; });
    choiceRadios.forEach(function(radio){ radio.checked = false; });
    booleanRadios.forEach(function(radio){ radio.checked = false; });
    state.pendingPoint = null;
    state.editingQuestionId = null;
    removeGhostMarker();
    setBuilderPointStatus('لم يتم اختيار نقطة بعد');
    updateQuestionEditUI();
    renderBuilderQuestions();
  }

  function handleBuilderListClick(event){
    var button = event.target.closest('button[data-action]');
    if(!button){
      return;
    }
    var action = button.getAttribute('data-action');
    var id = button.getAttribute('data-question-id');
    if(!id){
      return;
    }
    if(action === 'remove-question'){
      state.builderQuestions = state.builderQuestions.filter(function(item){ return item.id !== id; });
      if(state.editingQuestionId === id){
        state.editingQuestionId = null;
        updateQuestionEditUI();
      }
      renderBuilderQuestions();
      setBuilderFeedback('تم حذف السؤال من السجل', 'success');
    } else if(action === 'edit-question'){
      startQuestionEdit(id);
    }
  }

  function renderBuilderQuestions(){
    if(!builderQuestionList){
      return;
    }
    if(!state.builderQuestions.length){
      builderQuestionList.innerHTML = '<p class="empty-placeholder">لم تتم إضافة أسئلة بعد.</p>';
      if(state.editingTestId){
        syncEditingMarkers();
      }
      return;
    }
    builderQuestionList.innerHTML = '';
    state.builderQuestions.forEach(function(question){
      var item = document.createElement('div');
      item.className = 'builder-item';
      if(state.editingQuestionId === question.id){
        item.classList.add('editing');
      }
      var info = document.createElement('div');
      var title = document.createElement('strong');
      title.textContent = question.label + ' (' + formatTypeLabel(question.type) + ')';
      var text = document.createElement('span');
      text.textContent = question.prompt;
      var coords = document.createElement('small');
      coords.textContent = 'الموضع: ' + question.x_pct + '%, ' + question.y_pct + '%';
      info.appendChild(title);
      info.appendChild(text);
      info.appendChild(coords);
      var actions = document.createElement('div');
      actions.className = 'builder-item-actions';
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'text-btn';
      editBtn.textContent = 'تعديل';
      editBtn.setAttribute('data-action', 'edit-question');
      editBtn.setAttribute('data-question-id', question.id);
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'text-btn danger';
      removeBtn.textContent = 'حذف';
      removeBtn.setAttribute('data-action', 'remove-question');
      removeBtn.setAttribute('data-question-id', question.id);
      actions.appendChild(editBtn);
      actions.appendChild(removeBtn);
      item.appendChild(info);
      item.appendChild(actions);
      builderQuestionList.appendChild(item);
    });
    if(state.editingTestId){
      syncEditingMarkers();
    }
  }

  function startQuestionEdit(questionId){
    var question = state.builderQuestions.find(function(item){ return item.id === questionId; });
    if(!question){
      return;
    }
    state.editingQuestionId = questionId;
    if(builderLabelInput){
      builderLabelInput.value = question.label || '';
    }
    if(builderQuestionInput){
      builderQuestionInput.value = question.prompt || '';
    }
    if(builderTypeSelect){
      builderTypeSelect.value = question.type || 'choice';
      toggleTypeFields();
    }
    if(question.type === 'choice'){
      choiceInputs.forEach(function(input, index){
        input.value = question.options && question.options[index] ? question.options[index] : '';
      });
      choiceRadios.forEach(function(radio){
        radio.checked = parseInt(radio.value, 10) === question.correctIndex;
      });
      booleanRadios.forEach(function(radio){ radio.checked = false; });
    } else if(question.type === 'boolean'){
      booleanRadios.forEach(function(radio){
        var value = radio.value === 'true';
        radio.checked = question.booleanAnswer === value;
      });
      choiceInputs.forEach(function(input){ input.value = ''; });
      choiceRadios.forEach(function(radio){ radio.checked = false; });
    } else {
      choiceInputs.forEach(function(input){ input.value = ''; });
      choiceRadios.forEach(function(radio){ radio.checked = false; });
      booleanRadios.forEach(function(radio){ radio.checked = false; });
    }
    state.pendingPoint = null;
    removeGhostMarker();
    setBuilderPointStatus('الموضع الحالي: ' + question.x_pct + '%, ' + question.y_pct + '%. استخدم زر تحديد نقطة للتعديل.');
    updateQuestionEditUI();
    renderBuilderQuestions();
  }

  function exitQuestionEditMode(){
    state.editingQuestionId = null;
    resetQuestionFormFields();
    state.pendingPoint = null;
    removeGhostMarker();
    setBuilderPointStatus('لم يتم اختيار نقطة بعد');
    updateQuestionEditUI();
    renderBuilderQuestions();
  }

  function updateQuestionEditUI(){
    if(!builderSubmitBtn){
      return;
    }
    if(state.editingQuestionId){
      builderSubmitBtn.textContent = 'تحديث السؤال';
      if(cancelQuestionEditBtn){
        cancelQuestionEditBtn.classList.remove('hidden');
      }
    } else {
      builderSubmitBtn.textContent = 'إضافة للسجل';
      if(cancelQuestionEditBtn){
        cancelQuestionEditBtn.classList.add('hidden');
      }
    }
  }

  function formatTypeLabel(type){
    if(type === 'boolean'){
      return 'صح وخطأ';
    }
    if(type === 'choice'){
      return 'اختياري';
    }
    return 'نصي';
  }

  function saveCurrentTest(){
    if(!builderTitleInput || state.editingTestId){
      if(state.editingTestId){
        setBuilderFeedback('أنت في وضع التحرير. استخدم زر تحديث الاختبار.', 'error');
      }
      return;
    }
    var title = builderTitleInput.value.trim();
    if(!title){
      setBuilderFeedback('أدخل اسم الاختبار', 'error');
      return;
    }
    if(!state.builderQuestions.length){
      setBuilderFeedback('أضف سؤالاً واحداً على الأقل', 'error');
      return;
    }
    if(!state.mapImageData){
      setBuilderFeedback('ارفع صورة للخريطة قبل حفظ الاختبار', 'error');
      return;
    }
    var clonedQuestions = state.builderQuestions.map(function(question){
      return cloneQuestion(question);
    });
    var test = {
      id: 'custom-' + Date.now(),
      title: title,
      createdAt: Date.now(),
      mapImageData: state.mapImageData,
      questions: clonedQuestions
    };
    state.savedTests.push(test);
    persistTests();
    renderSavedTests();
    state.builderQuestions = [];
    renderBuilderQuestions();
    builderTitleInput.value = '';
    resetBuilderAfterSave();
    setBuilderFeedback('تم حفظ الاختبار بنجاح', 'success');
  }

  function handleSavedGridClick(event){
    var button = event.target.closest('button[data-action]');
    if(!button){
      return;
    }
    var action = button.getAttribute('data-action');
    var testId = button.getAttribute('data-test-id');
    if(!testId){
      return;
    }
    if(action === 'load'){
      loadSavedTest(testId);
    } else if(action === 'delete'){
      deleteTest(testId);
    } else if(action === 'edit'){
      enterTestEditMode(testId);
    } else if(action === 'clear-map'){
      clearTestMap(testId);
    }
  }

  function loadSavedTest(testId){
    var test = state.savedTests.find(function(item){ return item.id === testId; });
    if(!test){
      return;
    }
    var cloned = JSON.parse(JSON.stringify(test));
    loadTest(cloned);
    openPlayModal(cloned);
    setBuilderFeedback('تم تشغيل الاختبار المحفوظ: ' + cloned.title, 'success');
  }

  function deleteTest(testId){
    var wasEditing = state.editingTestId === testId;
    state.savedTests = state.savedTests.filter(function(item){ return item.id !== testId; });
    persistTests();
    renderSavedTests();
    if(wasEditing){
      cancelTestEditMode(true);
    }
  }

  function renderSavedTests(){
    if(!savedTestsGrid){
      return;
    }
    if(!state.savedTests.length){
      savedTestsGrid.innerHTML = '<div class="empty-placeholder">لا توجد اختبارات محفوظة بعد.</div>';
      return;
    }
    savedTestsGrid.innerHTML = '';
    state.savedTests.forEach(function(test){
      var card = document.createElement('div');
      card.className = 'saved-card';
      if(state.editingTestId === test.id){
        card.classList.add('editing');
      }
      var title = document.createElement('h4');
      title.textContent = test.title;
      var count = document.createElement('p');
      count.textContent = test.questions.length + ' سؤال';
      var mapBadge = document.createElement('p');
      mapBadge.className = 'saved-map-badge ' + (test.mapImageData ? 'ready' : 'missing');
      mapBadge.textContent = test.mapImageData ? 'خريطة محفوظة' : 'خريطة غير متوفرة';
      var mapControls = document.createElement('div');
      mapControls.className = 'saved-map-controls';
      var clearMapBtn = document.createElement('button');
      clearMapBtn.type = 'button';
      clearMapBtn.className = 'text-btn danger';
      clearMapBtn.textContent = 'إزالة الخريطة';
      clearMapBtn.disabled = !test.mapImageData;
      clearMapBtn.setAttribute('data-action', 'clear-map');
      clearMapBtn.setAttribute('data-test-id', test.id);
      var mapHint = document.createElement('span');
      mapHint.textContent = 'استبدل الصورة من خلال زر "تحرير".';
      mapControls.appendChild(clearMapBtn);
      mapControls.appendChild(mapHint);
      var date = document.createElement('p');
      date.textContent = 'آخر تعديل: ' + formatDate(test.createdAt);
      var actions = document.createElement('div');
      actions.className = 'card-actions';
      var loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'mini-btn primary';
      loadBtn.textContent = 'تشغيل';
      loadBtn.setAttribute('data-action', 'load');
      loadBtn.setAttribute('data-test-id', test.id);
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'mini-btn edit';
      editBtn.textContent = 'تحرير';
      editBtn.setAttribute('data-action', 'edit');
      editBtn.setAttribute('data-test-id', test.id);
      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'mini-btn danger';
      deleteBtn.textContent = 'حذف';
      deleteBtn.setAttribute('data-action', 'delete');
      deleteBtn.setAttribute('data-test-id', test.id);
      actions.appendChild(loadBtn);
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      card.appendChild(title);
      card.appendChild(count);
      card.appendChild(mapBadge);
      card.appendChild(mapControls);
      card.appendChild(date);
      card.appendChild(actions);
      savedTestsGrid.appendChild(card);
    });
  }

  function formatDate(timestamp){
    if(!timestamp){
      return '';
    }
    try {
      var formatter = new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
      return formatter.format(new Date(timestamp));
    } catch(_){
      return '';
    }
  }

  function updateMapControls(){
    if(clearMapImageBtn){
      clearMapImageBtn.disabled = !state.mapImageLoaded;
    }
  }

  function updateEditingUI(){
    var isEditing = !!state.editingTestId;
    if(builderEditingBanner){
      builderEditingBanner.classList.toggle('hidden', !isEditing);
    }
    if(builderEditingTitle){
      var currentTitle = builderTitleInput ? builderTitleInput.value.trim() : '';
      builderEditingTitle.textContent = isEditing ? (currentTitle || 'بدون اسم') : '';
    }
    if(updateTestBtn){
      updateTestBtn.classList.toggle('hidden', !isEditing);
    }
    if(saveTestBtn){
      saveTestBtn.classList.toggle('hidden', isEditing);
    }
    if(cancelEditTestBtn){
      cancelEditTestBtn.classList.toggle('hidden', !isEditing);
    }
  }

  function syncEditingMarkers(){
    if(!state.editingTestId){
      return;
    }
    state.currentTest = {
      id: state.editingTestId,
      title: builderTitleInput ? builderTitleInput.value.trim() : '',
      mapImageData: state.mapImageData,
      questions: state.builderQuestions.map(function(question){ return cloneQuestion(question); })
    };
    renderMarkers();
  }

  function enterTestEditMode(testId){
    var test = state.savedTests.find(function(item){ return item.id === testId; });
    if(!test){
      setBuilderFeedback('تعذر العثور على الاختبار المطلوب', 'error');
      return;
    }
    var cloned = cloneTest(test);
    state.editingTestId = cloned.id;
    state.builderQuestions = cloned.questions;
    if(builderTitleInput){
      builderTitleInput.value = cloned.title || '';
    }
    if(cloned.mapImageData){
      applyMapImage(cloned.mapImageData);
    } else {
      clearBuilderMapImage(true);
    }
    resetQuestionFormFields();
    state.editingQuestionId = null;
    updateQuestionEditUI();
    state.pendingPoint = null;
    setBuilderPointStatus('لم يتم اختيار نقطة بعد');
    renderBuilderQuestions();
    updateEditingUI();
    setBuilderFeedback('أنت الآن في وضع التحرير للاختبار: ' + cloned.title, 'success');
  }

  function cancelTestEditMode(silent){
    if(!state.editingTestId){
      resetQuestionFormFields();
      updateEditingUI();
      return;
    }
    state.editingTestId = null;
    state.builderQuestions = [];
    state.editingQuestionId = null;
    resetQuestionFormFields();
    state.pendingPoint = null;
    removeGhostMarker();
    setBuilderPointStatus('لم يتم اختيار نقطة بعد');
    if(builderTitleInput){
      builderTitleInput.value = '';
    }
    if(mapImageInput){
      mapImageInput.value = '';
    }
    clearBuilderMapImage(true);
    state.currentTest = null;
    renderBuilderQuestions();
    updateQuestionEditUI();
    updateEditingUI();
    if(!silent){
      setBuilderFeedback('تم إنهاء وضع التحرير. يمكنك إنشاء اختبار جديد.', '');
    }
  }

  function updateCurrentTest(){
    if(!state.editingTestId || !builderTitleInput){
      return;
    }
    var title = builderTitleInput.value.trim();
    if(!title){
      setBuilderFeedback('أدخل اسم الاختبار', 'error');
      return;
    }
    if(!state.builderQuestions.length){
      setBuilderFeedback('أضف سؤالاً واحداً على الأقل', 'error');
      return;
    }
    var testIndex = state.savedTests.findIndex(function(item){ return item.id === state.editingTestId; });
    if(testIndex === -1){
      setBuilderFeedback('تعذر العثور على الاختبار المطلوب', 'error');
      cancelTestEditMode(true);
      return;
    }
    var updatedTest = {
      id: state.savedTests[testIndex].id,
      title: title,
      createdAt: Date.now(),
      mapImageData: state.mapImageData,
      questions: state.builderQuestions.map(function(question){ return cloneQuestion(question); })
    };
    state.savedTests[testIndex] = updatedTest;
    persistTests();
    renderSavedTests();
    state.currentTest = {
      id: updatedTest.id,
      title: updatedTest.title,
      mapImageData: updatedTest.mapImageData,
      questions: updatedTest.questions.map(function(question){ return cloneQuestion(question); })
    };
    renderMarkers();
    setBuilderFeedback('تم تحديث الاختبار بنجاح', 'success');
    updateEditingUI();
  }

  function clearTestMap(testId){
    var index = state.savedTests.findIndex(function(item){ return item.id === testId; });
    if(index === -1){
      return;
    }
    if(!state.savedTests[index].mapImageData){
      setBuilderFeedback('لا توجد خريطة لحذفها لهذا الاختبار', 'error');
      return;
    }
    state.savedTests[index].mapImageData = null;
    state.savedTests[index].createdAt = Date.now();
    persistTests();
    renderSavedTests();
    if(state.editingTestId === testId){
      clearBuilderMapImage(true);
    }
    setBuilderFeedback('تم حذف صورة الخريطة لهذا الاختبار', 'success');
  }

  function cloneQuestion(question){
    if(!question){
      return {};
    }
    try {
      var cloned = JSON.parse(JSON.stringify(question));
      if(!Array.isArray(cloned.options)){
        cloned.options = [];
      }
      return cloned;
    } catch(_){
      var fallback = Object.assign({}, question);
      fallback.options = Array.isArray(question.options) ? question.options.slice() : [];
      return fallback;
    }
  }

  function cloneTest(test){
    if(!test){
      return null;
    }
    return {
      id: test.id,
      title: test.title,
      createdAt: test.createdAt,
      mapImageData: test.mapImageData,
      questions: Array.isArray(test.questions) ? test.questions.map(function(question){ return cloneQuestion(question); }) : []
    };
  }

  function persistTests(){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.savedTests));
    } catch(_){
    }
  }

  function loadStoredTests(){
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw){
        return [];
      }
      var parsed = JSON.parse(raw);
      if(!Array.isArray(parsed)){
        return [];
      }
      return parsed.map(function(test){
        if(!test || typeof test !== 'object'){
          return null;
        }
        if(!Array.isArray(test.questions)){
          test.questions = [];
        }
        if(typeof test.mapImageData !== 'string'){
          test.mapImageData = null;
        }
        return test;
      }).filter(Boolean);
    } catch(_){
      return [];
    }
  }

  function renderMarkers(){
    if(!mapMarkerLayer){
      return;
    }
    var ghost = state.ghostMarker;
    mapMarkerLayer.innerHTML = '';
    state.questionMap = {};
    if(state.currentTest && Array.isArray(state.currentTest.questions)){
      state.currentTest.questions.forEach(function(question, index){
        var marker = document.createElement('button');
        marker.type = 'button';
        marker.className = 'map-pin';
        marker.style.left = question.x_pct + '%';
        marker.style.top = question.y_pct + '%';
        marker.textContent = index + 1;
        marker.setAttribute('data-question-id', question.id);
        marker.addEventListener('click', function(){ onMarkerSelected(question.id); });
        marker.addEventListener('keydown', function(event){
          if(event.key === 'Enter' || event.key === ' '){
            event.preventDefault();
            onMarkerSelected(question.id);
          }
        });
        mapMarkerLayer.appendChild(marker);
        state.questionMap[question.id] = question;
      });
    }
    if(ghost && state.pendingPoint){
      mapMarkerLayer.appendChild(ghost);
    }
  }

  function onMarkerSelected(questionId){
    var question = state.questionMap[questionId];
    if(!question){
      return;
    }
    setTargetStatus('النقطة المحددة: ' + (question.label || 'بدون اسم'));
  }

  function openPlayModal(test){
    if(!playModal){
      return;
    }
    state.activePlayTest = test;
    state.playQuestionMap = {};
    state.playAnswerStatus = {};
    if(test.mapImageData && playMapImage){
      playMapImage.src = test.mapImageData;
      playMapImage.classList.remove('hidden');
      if(playMapPlaceholder){
        playMapPlaceholder.classList.add('hidden');
      }
    } else if(playMapPlaceholder){
      playMapPlaceholder.classList.remove('hidden');
      if(playMapImage){
        playMapImage.classList.add('hidden');
        playMapImage.removeAttribute('src');
      }
    }
    if(playMapStatus){
      playMapStatus.textContent = 'اضغط على أي نقطة للبدء';
    }
    resetPlayQuestionArea();
    resetPlayResultsPanel();
    renderPlayMarkers();
    playModal.classList.add('active');
    playModal.setAttribute('aria-hidden', 'false');
  }

  function renderPlayMarkers(){
    if(!playMarkerLayer){
      return;
    }
    playMarkerLayer.innerHTML = '';
    if(!state.activePlayTest || !Array.isArray(state.activePlayTest.questions)){
      return;
    }
    state.playQuestionMap = {};
    state.activePlayTest.questions.forEach(function(question, index){
      var marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'map-pin play-pin';
      marker.style.left = question.x_pct + '%';
      marker.style.top = question.y_pct + '%';
      marker.textContent = index + 1;
      marker.setAttribute('data-play-question-id', question.id);
      marker.addEventListener('click', function(){ onPlayMarkerSelected(question.id); });
      marker.addEventListener('keydown', function(event){
        if(event.key === 'Enter' || event.key === ' '){
          event.preventDefault();
          onPlayMarkerSelected(question.id);
        }
      });
      var pinStatus = state.playAnswerStatus && state.playAnswerStatus[question.id];
      if(pinStatus === 'correct'){
        marker.classList.add('answered-correct');
      } else if(pinStatus === 'incorrect'){
        marker.classList.add('answered-incorrect');
      }
      playMarkerLayer.appendChild(marker);
      state.playQuestionMap[question.id] = question;
    });
  }

  function markPlayPinResult(questionId, isCorrect){
    if(!questionId){
      return;
    }
    if(!state.playAnswerStatus){
      state.playAnswerStatus = {};
    }
    state.playAnswerStatus[questionId] = isCorrect ? 'correct' : 'incorrect';
    updatePlayPinVisual(questionId);
    checkPlayCompletion();
  }

  function updatePlayPinVisual(questionId){
    if(!playMarkerLayer || !questionId){
      return;
    }
    var pin = playMarkerLayer.querySelector('[data-play-question-id="' + questionId + '"]');
    if(!pin){
      return;
    }
    pin.classList.remove('answered-correct', 'answered-incorrect');
    var status = state.playAnswerStatus && state.playAnswerStatus[questionId];
    if(status === 'correct'){
      pin.classList.add('answered-correct');
    } else if(status === 'incorrect'){
      pin.classList.add('answered-incorrect');
    }
  }

  function onPlayMarkerSelected(questionId){
    var question = state.playQuestionMap[questionId];
    if(!question){
      return;
    }
    if(playMapStatus){
      playMapStatus.textContent = 'النقطة المحددة: ' + (question.label || 'بدون اسم');
    }
    showPlayQuestion(question);
  }

  function resetPlayQuestionArea(){
    if(!playQuestionArea){
      return;
    }
    playQuestionArea.innerHTML = '<p class="empty-placeholder">سيظهر السؤال هنا بعد اختيار نقطة من الخريطة.</p>';
  }

  function resetPlayResultsPanel(){
    if(playResultsPanel){
      playResultsPanel.classList.add('hidden');
    }
    if(playResultsLabel){
      playResultsLabel.textContent = 'أجب على جميع النقاط لعرض النتيجة.';
    }
    if(playResultsCorrect){
      playResultsCorrect.textContent = '0 صحيحة';
    }
    if(playResultsIncorrect){
      playResultsIncorrect.textContent = '0 خاطئة';
    }
  }

  function showPlayResults(correct, incorrect, total){
    if(!playResultsPanel){
      return;
    }
    playResultsPanel.classList.remove('hidden');
    if(playResultsLabel){
      playResultsLabel.textContent = 'أنهيت الاختبار: ' + correct + ' من ' + total + ' صحيحة';
    }
    if(playResultsCorrect){
      playResultsCorrect.textContent = correct + ' صحيحة';
    }
    if(playResultsIncorrect){
      playResultsIncorrect.textContent = incorrect + ' خاطئة';
    }
  }

  function checkPlayCompletion(){
    if(!state.activePlayTest || !Array.isArray(state.activePlayTest.questions)){
      return;
    }
    var total = state.activePlayTest.questions.length;
    var answeredMap = state.playAnswerStatus || {};
    var answered = Object.keys(answeredMap).length;
    if(answered < total){
      resetPlayResultsPanel();
      return;
    }
    var correct = Object.keys(answeredMap).filter(function(key){
      return answeredMap[key] === 'correct';
    }).length;
    showPlayResults(correct, total - correct, total);
  }

  function showPlayQuestion(question){
    if(!playQuestionArea){
      return;
    }
    playQuestionArea.innerHTML = '';
    var target = document.createElement('div');
    target.className = 'question-target';
    target.textContent = 'النقطة: ' + (question.label || '');
    var title = document.createElement('h3');
    title.textContent = question.prompt;
    playQuestionArea.appendChild(target);
    playQuestionArea.appendChild(title);
    if(question.hint){
      var hint = document.createElement('p');
      hint.className = 'question-hint';
      hint.textContent = question.hint;
      playQuestionArea.appendChild(hint);
    }
    if(question.type === 'choice' && Array.isArray(question.options)){
      renderChoiceOptions(question, playQuestionArea);
    } else if(question.type === 'boolean'){
      renderBooleanOptions(question, playQuestionArea);
    } else {
      var note = document.createElement('p');
      note.className = 'question-message';
      note.textContent = 'هذا السؤال مخصص للنقاش المفتوح مع الطلاب.';
      playQuestionArea.appendChild(note);
    }
  }

  function renderChoiceOptions(question, parent){
    if(!parent){
      return;
    }
    var container = document.createElement('div');
    container.className = 'answer-options choice-display';
    var feedback = document.createElement('div');
    feedback.className = 'modal-feedback';
    question.options.forEach(function(option, index){
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'answer-option';
      button.textContent = option;
      button.addEventListener('click', function(){ handleChoiceSelection(question, index, container, feedback); });
      container.appendChild(button);
    });
    parent.appendChild(container);
    parent.appendChild(feedback);
  }

  function handleChoiceSelection(question, index, container, feedback){
    var buttons = Array.prototype.slice.call(container.querySelectorAll('.answer-option'));
    buttons.forEach(function(button){ button.disabled = true; });
    var correct = question.correctIndex === index;
    buttons[index].classList.add(correct ? 'correct' : 'incorrect');
    if(typeof question.correctIndex === 'number' && question.correctIndex >= 0 && question.correctIndex < buttons.length){
      buttons[question.correctIndex].classList.add('correct');
    }
    if(feedback){
      feedback.textContent = correct ? 'إجابة صحيحة' : 'حاول مرة أخرى في السؤال التالي';
      feedback.classList.remove('success', 'error');
      feedback.classList.add(correct ? 'success' : 'error');
    }
    markPlayPinResult(question.id, correct);
  }

  function renderBooleanOptions(question, parent){
    if(!parent){
      return;
    }
    var container = document.createElement('div');
    container.className = 'answer-options boolean-display';
    var feedback = document.createElement('div');
    feedback.className = 'modal-feedback';
    ['true', 'false'].forEach(function(value){
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'answer-option';
      button.textContent = value === 'true' ? 'صح' : 'خطأ';
      button.addEventListener('click', function(){ handleBooleanSelection(question, value === 'true', container, feedback); });
      container.appendChild(button);
    });
    parent.appendChild(container);
    parent.appendChild(feedback);
  }

  function handleBooleanSelection(question, answer, container, feedback){
    var buttons = Array.prototype.slice.call(container.querySelectorAll('.answer-option'));
    buttons.forEach(function(button){ button.disabled = true; });
    var correct = question.booleanAnswer === answer;
    buttons.forEach(function(button){
      var value = button.textContent === 'صح';
      if(question.booleanAnswer === value){
        button.classList.add('correct');
      }
    });
    if(!correct){
      buttons.forEach(function(button){
        var value = button.textContent === 'صح';
        if(value === answer){
          button.classList.add('incorrect');
        }
      });
    }
    if(feedback){
      feedback.textContent = correct ? 'إجابة صحيحة' : 'الإجابة الصحيحة مختلفة';
      feedback.classList.remove('success', 'error');
      feedback.classList.add(correct ? 'success' : 'error');
    }
    markPlayPinResult(question.id, correct);
  }

  function closePlayModal(){
    if(!playModal){
      return;
    }
    playModal.classList.remove('active');
    playModal.setAttribute('aria-hidden', 'true');
    state.activePlayTest = null;
    state.playQuestionMap = {};
    if(playMapStatus){
      playMapStatus.textContent = 'اضغط على أي نقطة للبدء';
    }
    resetPlayQuestionArea();
    resetPlayResultsPanel();
  }

  function loadTest(test){
    state.currentTest = test;
    if(test.mapImageData){
      applyMapImage(test.mapImageData);
    } else if(!state.mapImageLoaded){
      setBuilderFeedback('ارفع صورة الخريطة نفسها لعرض النقاط في مواضعها.', 'error');
    }
    setTargetStatus('تم تحميل اختبار: ' + test.title);
    updateLevelStatus(test.title + ' – ' + test.questions.length + ' سؤال');
    renderMarkers();
  }

  function setInitialState(){
    updateLevelStatus(null);
    setTargetStatus('اضغط على نقطة محفوظة لعرض السؤال');
    setBuilderFeedback('ارفع صورة للخريطة وابدأ بإضافة نقاطك الخاصة.', '');
    updateEditingUI();
    updateQuestionEditUI();
    updateMapControls();
  }

  function updateLevelStatus(label){
    if(!levelStatus){
      return;
    }
    if(!label){
      levelStatus.textContent = 'لا يوجد اختبار نشط';
    } else {
      levelStatus.textContent = 'الاختبار الحالي: ' + label;
    }
  }

  function setTargetStatus(text){
    if(targetStatus){
      targetStatus.textContent = text || 'اضغط على نقطة محفوظة لعرض السؤال';
    }
  }

  function setBuilderPointStatus(text){
    if(builderPointStatus){
      builderPointStatus.textContent = text;
    }
  }

  function setBuilderFeedback(text, type){
    if(!builderFeedback){
      return;
    }
    builderFeedback.textContent = text;
    builderFeedback.classList.remove('success', 'error');
    if(type){
      builderFeedback.classList.add(type);
    }
  }

  init();
})();
