/* Minimal shared navbar behaviour for standalone content pages
   (mobile menu toggle + scrolled background) */
(function(){
  var navbar = document.getElementById('navbar');
  if(!navbar) return;
  window.addEventListener('scroll', function(){
    navbar.classList.toggle('scrolled', window.scrollY > 40);
  }, {passive:true});

  var navToggle = document.getElementById('navToggle');
  var navLinks = document.getElementById('navLinks');
  if(navToggle && navLinks){
    navToggle.addEventListener('click', function(){
      var open = navLinks.classList.toggle('open');
      navToggle.classList.toggle('open', open);
      navToggle.setAttribute('aria-expanded', open);
    });
  }
})();
