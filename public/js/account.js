'use strict';
if(new URLSearchParams(location.search).get('reason')==='auth')document.getElementById('authNotice').style.display='block';
document.getElementById('loginForm').onsubmit=async e=>{e.preventDefault();
try{await TV.api('/api/login',{method:'POST',body:JSON.stringify({username:username.value,password:password.value})});
const n=new URLSearchParams(location.search).get('next');
location.href=n&&n.startsWith('/')?n:'index.html';
}catch(x){alert(x.message);
}};
