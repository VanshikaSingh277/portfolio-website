// Scroll reveal
const ro = new IntersectionObserver((entries) => {
  entries.forEach((e,i) => {
    if(e.isIntersecting) setTimeout(()=>e.target.classList.add('in'), i*80);
  });
},{threshold:0.08});
document.querySelectorAll('.rv').forEach(el=>ro.observe(el));

// Active nav link on scroll
// Sections come from the nav menu, which is generated from backend/content/site.json
const secs = [...document.querySelectorAll('.nav-links a[href^="#"]')].map(a=>a.getAttribute('href').slice(1));
window.addEventListener('scroll',()=>{
  const y = window.scrollY + 120;
  secs.forEach(id=>{
    const el = document.getElementById(id);
    const a = document.querySelector(`.nav-links a[href="#${id}"]`);
    if(el && a){
      if(y >= el.offsetTop && y < el.offsetTop + el.offsetHeight)
        document.querySelectorAll('.nav-links a').forEach(x=>x.classList.remove('active'));
      if(y >= el.offsetTop && y < el.offsetTop + el.offsetHeight)
        a.classList.add('active');
    }
  });
});

// Filter dropdown
function toggleFilter(){
  document.getElementById('filterDropdown').classList.toggle('open');
}
document.addEventListener('click',e=>{
  if(!e.target.closest('#filterBtn') && !e.target.closest('#filterDropdown'))
    document.getElementById('filterDropdown').classList.remove('open');
});
function setFilter(cat, el){
  // Show the option's label (e.g. "AI / Automation"), not its internal id
  document.getElementById('filterLabel').textContent = el.textContent.replace('✓','').trim();
  document.querySelectorAll('.filter-opt').forEach(o=>{o.classList.remove('selected');o.querySelector('.check').textContent='';});
  el.classList.add('selected');el.querySelector('.check').textContent='✓';
  document.querySelectorAll('.proj-card').forEach(card=>{
    if(cat==='All'||card.dataset.cat===cat) card.style.display='flex';
    else card.style.display='none';
  });
  document.getElementById('filterDropdown').classList.remove('open');
}

// Theme toggle
const themeBtn = document.getElementById('themeBtn');
const html = document.documentElement;
const saved = localStorage.getItem('theme');
if(saved==='light'){html.classList.add('light');themeBtn.textContent='🌙';}
themeBtn.addEventListener('click',()=>{
  const isLight = html.classList.toggle('light');
  themeBtn.textContent = isLight ? '🌙' : '☀️';
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
});

// Contact form
const contactForm = document.getElementById('cForm');
const formOk = document.getElementById('form-ok');

contactForm.addEventListener('submit', async function(e){
  e.preventDefault();

  const submitBtn = this.querySelector('.cform-submit');
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending...';

  const data = new FormData(this);
  const payload = {
    name: data.get('name'),
    email: data.get('email'),
    message: data.get('message'),
    website: data.get('website') // honeypot, should stay empty
  };

  try {
    // config.js missing, or the production placeholder never replaced
    const base = (window.API_BASE_URL || '').replace(/\/+$/, '');
    if (!base || base.includes('YOUR-RENDER-SERVICE')) {
      const mail = document.querySelector('.contact-info-item[href^="mailto:"]');
      throw new Error(`The contact form is not set up yet. Please email ${mail ? mail.textContent.trim() : 'me directly'}.`);
    }

    const response = await fetch(`${base}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Form submission failed');
    }

    this.reset();
    if (window.trackEvent) window.trackEvent('contact_submit');
    formOk.style.display = 'block';
    submitBtn.textContent = 'Sent ✓';
  } catch (error) {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
    const reason = error instanceof TypeError ? '' : `\n\n${error.message}`;
    alert(`Message could not be sent right now. Please try again or email me directly.${reason}`);
    return;
  }

  setTimeout(() => {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }, 1800);
});

