// Applies the saved light/dark theme before the page paints (same "theme" key
// as the portfolio, so both switch together on localhost).
(function () {
  try {
    if (localStorage.getItem('theme') === 'light') document.documentElement.classList.add('light');
  } catch (e) {
    /* storage blocked: stay on the dark default */
  }
})();
