'use strict';
(async()=>{try{await TV.api('/api/me');
}catch{const next=location.pathname+location.search+location.hash;
location.replace('account.html?reason=auth&next='+encodeURIComponent(next));
}})();
