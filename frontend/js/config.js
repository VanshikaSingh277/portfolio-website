// Where the contact form sends messages.
// Local development talks to the Express API on port 5000; the deployed site
// talks to the Render service. Replace the placeholder after the first deploy.
(function () {
  var LOCAL_API = 'http://localhost:5000';
  var PRODUCTION_API = 'https://YOUR-RENDER-SERVICE.onrender.com';

  var host = window.location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '' || host === '[::1]';

  window.API_BASE_URL = isLocal ? LOCAL_API : PRODUCTION_API;
})();
