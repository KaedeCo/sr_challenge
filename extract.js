var a=[];
document.querySelectorAll('main p, main a[href*="/monster/"]').forEach(function(e){
  var t=e.textContent.trim();
  if(t&&t.length<200)a.push(t);
});
a.join('|||')
