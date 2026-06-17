window.UXEnhancements = {
  init() {
    this.addKeyboardShortcuts();
    this.addTooltips();
    this.addLoadingStates();
    this.enhanceFormFeedback();
    this.addEmptyStateMessages();
  },

  addKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') {
          e.preventDefault();
          this.showNotification('💾 تم الحفظ التلقائي', 'success');
        }
        if (e.key === '?') {
          e.preventDefault();
          this.showHelpDialog();
        }
      }
    });
  },

  addTooltips() {
    const tooltips = {
      'timer': 'اضغط لفتح المؤقت الذكي (⏱️)',
      'wheel': 'اضغط لفتح عجلة الحظ (🎡)',
      'numbers': 'اضغط لتحديد أرقام عشوائية (🔢)',
      'names': 'اضغط لاختيار أسماء عشوائية (🎲)',
      'settings': 'اضغط لتغيير الإعدادات (⚙️)'
    };

    Object.entries(tooltips).forEach(([key, tooltip]) => {
      const elem = document.querySelector(`[data-qt="${key}"]`);
      if (elem) {
        elem.setAttribute('data-tooltip', tooltip);
        elem.classList.add('tooltip');
      }
    });
  },

  addLoadingStates() {
    document.body.classList.remove('loading-state');
  },

  enhanceFormFeedback() {
    document.addEventListener('change', (e) => {
      if (e.target.matches('input, select, textarea')) {
        e.target.classList.add('touched');
      }
    });

    document.addEventListener('submit', (e) => {
      const form = e.target;
      const inputs = form.querySelectorAll('input, select, textarea');
      inputs.forEach(input => input.classList.add('touched'));
    });
  },

  addEmptyStateMessages() {
    window.showEmptyState = (container, message, icon = '📭') => {
      container.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
          <div style="font-size: 48px; margin-bottom: 16px;">${icon}</div>
          <p style="font-size: 16px; font-weight: 600; margin: 0;">${message}</p>
        </div>
      `;
    };
  },

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-message">${message}</span>
        <button class="notification-close" onclick="this.closest('.notification').remove()">×</button>
      </div>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.classList.add('show');
    }, 10);

    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  },

  showHelpDialog() {
    const help = document.createElement('div');
    help.className = 'modal-overlay active';
    help.innerHTML = `
      <div class="modal" style="text-align: right; max-width: 500px;">
        <div style="padding: 24px; border-bottom: 1px solid var(--border);">
          <h2 style="margin: 0; color: var(--primary);">🎓 الاختصارات المتاحة</h2>
        </div>
        <div style="padding: 20px;">
          <div class="help-item">
            <kbd>Ctrl + S</kbd> <span>حفظ سريع</span>
          </div>
          <div class="help-item">
            <kbd>Ctrl + ?</kbd> <span>عرض المساعدة</span>
          </div>
          <div class="help-item">
            <kbd>Tab</kbd> <span>التنقل بين العناصر</span>
          </div>
          <div class="help-item">
            <kbd>Enter</kbd> <span>تفعيل الأزرار</span>
          </div>
        </div>
        <div style="padding: 16px; border-top: 1px solid var(--border); text-align: center;">
          <button class="btn secondary" onclick="this.closest('.modal-overlay').remove()">إغلاق</button>
        </div>
      </div>
    `;
    document.body.appendChild(help);

    help.addEventListener('click', (e) => {
      if (e.target === help) help.remove();
    });

    const style = document.createElement('style');
    style.textContent = `
      .help-item {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px;
        margin: 8px 0;
        background: var(--primary-bg);
        border-radius: var(--radius);
        font-weight: 500;
      }
      .help-item kbd {
        background: var(--primary);
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-family: monospace;
        font-size: 12px;
        font-weight: 600;
      }
    `;
    document.head.appendChild(style);
  },

  showFormValidationError(field, message) {
    const error = document.createElement('div');
    error.className = 'field-error';
    error.textContent = message;
    field.parentNode.appendChild(error);

    field.addEventListener('input', () => error.remove(), { once: true });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.UXEnhancements.init();
});

const notificationStyles = document.createElement('style');
notificationStyles.textContent = `
  .notification {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: var(--radius);
    padding: 16px 20px;
    box-shadow: var(--shadow-lg);
    transform: translateX(400px);
    transition: transform 0.3s ease;
    z-index: 10000;
    max-width: 300px;
  }

  .notification.show {
    transform: translateX(0);
  }

  .notification-info {
    border-color: var(--info);
    background: var(--info-bg);
  }

  .notification-success {
    border-color: var(--success);
    background: var(--success-bg);
  }

  .notification-error {
    border-color: var(--error);
    background: var(--error-bg);
  }

  .notification-warning {
    border-color: var(--warning);
    background: var(--warning-bg);
  }

  .notification-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .notification-message {
    font-weight: 600;
    flex: 1;
  }

  .notification-close {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .notification-close:hover {
    opacity: 1;
  }

  .field-error {
    color: var(--error);
    font-size: 13px;
    margin-top: 6px;
    display: block;
    animation: slideDown 0.2s ease;
  }

  body.loading-state {
    cursor: progress;
  }

  body.loading-state::after {
    content: none;
  }

  @media (max-width: 768px) {
    .notification {
      left: 20px;
      right: 20px;
    }
  }
`;
document.head.appendChild(notificationStyles);
