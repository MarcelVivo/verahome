/* Minimal shared navbar behaviour for standalone content pages
   (mobile menu toggle + scrolled background) */
(function(){
  var navbar = document.getElementById('navbar');
  if(!navbar) return;
  var navToggle = document.getElementById('navToggle');
  var navLinks = document.getElementById('navLinks');

  function setMenuOpen(open){
    if(!navToggle || !navLinks) return;
    navLinks.classList.toggle('open', open);
    navToggle.classList.toggle('open', open);
    navToggle.setAttribute('aria-expanded', open);
    document.body.classList.toggle('nav-menu-open', open);
  }

  window.addEventListener('scroll', function(){
    navbar.classList.toggle('scrolled', window.scrollY > 40);
  }, {passive:true});

  if(navToggle && navLinks){
    navToggle.addEventListener('click', function(){
      setMenuOpen(!navLinks.classList.contains('open'));
    });
    navLinks.addEventListener('click', function(e){
      if(e.target.closest('a')) setMenuOpen(false);
    });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape') setMenuOpen(false);
    });
    window.addEventListener('resize', function(){
      if(window.innerWidth > 1024) setMenuOpen(false);
    });
  }
})();
