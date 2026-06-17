// Scroll reveal
const ro = new IntersectionObserver((entries) => {
  entries.forEach((e,i) => {
    if(e.isIntersecting) setTimeout(()=>e.target.classList.add('in'), i*80);
  });
},{threshold:0.08});
document.querySelectorAll('.rv').forEach(el=>ro.observe(el));

// Active nav link on scroll
const secs = ['home','about','skills','projects','experience','contact'];
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
  document.getElementById('filterLabel').textContent = cat;
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
document.getElementById('cForm').addEventListener('submit',function(e){
  e.preventDefault();
  this.style.display='none';
  document.getElementById('form-ok').style.display='block';
});