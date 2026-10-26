(function(){
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  var P=[
    'Hola, ¿cómo vas? Te escribo por lo de la reunión.',
    'Hoy no puedo porque trabajo **hasta las 6** y después tengo gimnasio. Llego a mi casa como **a las 9 y media de la noche**.',
    'Si no, el **fin de semana** hacemos una videollamada tranquilos, o **el jueves 30 de octubre**.',
    'Te mando el boceto de la app esta tarde. El presupuesto que tengo es de unos **2 mil dólares**. Pásame tu correo y te lo envío.'
  ];
  var WALL=['hola como vas','te escribo por lo de la reunión','hoy no puedo porque trabajo','hasta las 6','y después tengo gimnasio','llego a mi casa','como a las 9 y media','de la noche','si no el fin de semana','hacemos una videollamada','tranquilos o el jueves','30 de octubre','te mando el boceto de la app','esta tarde el presupuesto','que tengo es de unos','2 mil dólares','pásame tu correo','y te lo envío'];
  var $=function(id){return document.getElementById(id)};
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;')}

  $('wall').innerHTML=WALL.map(function(l){return '<span>'+esc(l)+'</span>'}).join('');
  var bars=$('bars'),h=[8,14,22,12,18,26,10,16,24,14,8,20,26,12,18,22,10,14,24,16,9,20,12,26,15,8,18,12];
  bars.innerHTML=h.map(function(v,i){return '<i style="height:'+v+'px"'+(i<9?' class="p"':'')+'></i>'}).join('');
  $('tbody').innerHTML=P.map(function(p){return '<p>'+esc(p).replace(/\*\*(.+?)\*\*/g,'<strong class="key">$1</strong>')+'</p>'}).join('');

  var panel=$('panel'),tbox=$('tbox'),tbody=$('tbody'),more=$('more'),btn=$('try'),timer;
  function setFold(f){
    tbody.classList.toggle('folded',f);
    more.setAttribute('aria-expanded',String(!f));
    more.innerHTML=f?'Ver todo <span aria-hidden="true">⌄</span>':'Ver menos <span aria-hidden="true">⌃</span>';
  }
  more.addEventListener('click',function(){setFold(!tbody.classList.contains('folded'))});

  function run(){
    clearTimeout(timer);
    tbox.hidden=false;
    panel.classList.remove('hl-on');
    setFold(true);
    btn.disabled=true;
    if(reduce){finish();return}
    panel.dataset.state='loading';
    btn.textContent='Transcribiendo…';
    timer=setTimeout(finish,1700);
  }
  function finish(){
    panel.dataset.state='done';
    btn.disabled=false;
    btn.textContent='Repetir';
    setTimeout(function(){panel.classList.add('hl-on')},reduce?0:60);
  }
  btn.addEventListener('click',run);

  var started=false;
  if('IntersectionObserver' in window){
    new IntersectionObserver(function(es,o){
      if(es[0].isIntersecting&&!started){started=true;run();o.disconnect()}
    },{threshold:.45}).observe(panel);
  }else{started=true;run()}

  function copy(text){
    if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(text);
    return new Promise(function(res,rej){
      var t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.opacity='0';
      document.body.appendChild(t);t.select();
      try{document.execCommand('copy')?res():rej()}catch(e){rej(e)}
      document.body.removeChild(t);
    });
  }
  function flash(el,label,done){
    var old=el.textContent;
    el.textContent=done;
    setTimeout(function(){el.textContent=old},1500);
  }
  $('copyT').addEventListener('click',function(){
    copy(P.map(function(p){return p.replace(/\*\*/g,'')}).join('\n\n')).then(function(){flash($('copyTT'),'Copiar','Copiado')},function(){});
  });
  $('copyUrl').addEventListener('click',function(e){
    var b=e.currentTarget;
    copy('chrome://extensions').then(function(){flash(b,'Copiar','Copiado')},function(){});
  });
})();
