window.PerformanceOptimizations = {
  init() {
    this.lazyLoadImages();
    this.cacheApiResponses();
    this.debounceSearch();
    this.optimizeScrolling();
    this.monitorPerformance();
  },

  lazyLoadImages() {
    if ('IntersectionObserver' in window) {
      const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            img.src = img.dataset.src || img.src;
            img.classList.add('loaded');
            observer.unobserve(img);
          }
        });
      });

      document.querySelectorAll('img[data-src]').forEach(img => imageObserver.observe(img));
    }
  },

  cacheApiResponses() {
    const cache = new Map();
    const originalFetch = window.fetch;

    window.fetch = function(url, options = {}) {
      const cacheKey = url;
      const shouldCache = url.includes('/api/') && options.method !== 'POST' && options.method !== 'PUT';

      if (shouldCache && cache.has(cacheKey)) {
        const { data, timestamp } = cache.get(cacheKey);
        const age = Date.now() - timestamp;
        if (age < 5 * 60 * 1000) {
          return Promise.resolve(new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
      }

      return originalFetch.apply(this, arguments).then(response => {
        if (shouldCache && response.ok) {
          response.clone().json().then(data => {
            cache.set(cacheKey, { data, timestamp: Date.now() });
          }).catch(() => {});
        }
        return response;
      });
    };
  },

  debounceSearch() {
    window.debounce = (func, wait) => {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    };

    document.addEventListener('input', (e) => {
      if (e.target.type === 'search' || e.target.classList.contains('search')) {
        if (e.target.dataset.debounceTimer) {
          clearTimeout(e.target.dataset.debounceTimer);
        }
        e.target.dataset.debounceTimer = setTimeout(() => {
          e.target.dispatchEvent(new Event('debounced-input'));
        }, 300);
      }
    });
  },

  optimizeScrolling() {
    let isScrolling = false;
    
    window.addEventListener('scroll', () => {
      if (!isScrolling) {
        isScrolling = true;
        requestAnimationFrame(() => {
          isScrolling = false;
          document.querySelectorAll('[data-scroll-visible]').forEach(el => {
            const rect = el.getBoundingClientRect();
            const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
            el.classList.toggle('scroll-visible', isVisible);
          });
        });
      }
    }, { passive: true });
  },

  monitorPerformance() {
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            console.log(`${entry.name}: ${entry.duration.toFixed(2)}ms`);
          }
        });

        observer.observe({ entryTypes: ['measure', 'navigation'] });
      } catch (e) {
        console.log('Performance monitoring not available');
      }
    }

    window.addEventListener('load', () => {
      const perfData = window.performance.timing;
      const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
      console.log(`Page Load Time: ${pageLoadTime}ms`);
    });
  },

  markPerformance(label) {
    if ('performance' in window && 'mark' in window.performance) {
      window.performance.mark(label);
    }
  },

  measurePerformance(label, startMark, endMark) {
    if ('performance' in window && 'measure' in window.performance) {
      try {
        window.performance.measure(label, startMark, endMark);
      } catch (e) {
        console.log('Performance measurement not available');
      }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.PerformanceOptimizations) {
    window.PerformanceOptimizations.init();
  }
});

window.requestIdleCallback = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));

const observeVisibility = (elements, callback) => {
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          callback(entry.target, true);
        } else {
          callback(entry.target, false);
        }
      });
    });

    elements.forEach(el => observer.observe(el));
    return observer;
  }
};

window.observeVisibility = observeVisibility;
