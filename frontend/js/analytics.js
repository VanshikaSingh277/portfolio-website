// Google Analytics 4. The measurement ID comes from the data-ga-id attribute
// that `npm run export` writes from backend/content/profile.json (gaId).
// Never loads on localhost / local previews.
(function () {
  var script = document.currentScript;
  var id = script && script.getAttribute('data-ga-id');
  var host = window.location.hostname;
  var isLocal = !host || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || window.location.protocol === 'file:';

  // Other scripts call this; it is a safe no-op when analytics is off.
  window.trackEvent = function () {};
  if (!id || isLocal) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', id);

  var tag = document.createElement('script');
  tag.async = true;
  tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
  document.head.appendChild(tag);

  window.trackEvent = function (name, params) {
    window.gtag('event', name, params || {});
  };

  function networkOf(link) {
    var label = (link.getAttribute('title') || '').trim();
    if (label) return label;
    if (link.protocol === 'mailto:') return 'Email';
    return link.hostname.replace(/^www\./, '').split('.')[0];
  }

  // One delegated listener for every tracked click.
  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;

    if (link.classList.contains('hero-resume-btn') || /\.pdf($|\?)/i.test(link.getAttribute('href'))) {
      window.trackEvent('resume_download', { file_name: link.getAttribute('href').split('/').pop() });
    }

    if (link.classList.contains('proj-link')) {
      var card = link.closest('.proj-card');
      var title = card && card.querySelector('h3');
      window.trackEvent('project_link_click', {
        project_name: title ? title.textContent.trim() : '',
        link_text: link.textContent.trim(),
        link_url: link.href,
      });
    }

    if (link.classList.contains('social-btn') || link.classList.contains('footer-social')) {
      window.trackEvent('social_click', { network: networkOf(link), link_url: link.href });
    }

    if (/^https?:$/.test(link.protocol) && link.hostname !== window.location.hostname) {
      window.trackEvent('outbound_click', { link_url: link.href, link_domain: link.hostname });
    }
  });
})();
