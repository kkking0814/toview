'use strict';
// 공급처 URL/키는 프런트에 절대 노출하지 않는다. 실제 검증된 공급처만 환경변수로 활성화한다.
const PROVIDERS = Object.freeze({
    dh_randomball:{url:process.env.DH_RANDOMBALL_API_URL||'',kind:'json'},
    dh_speedkeno:{url:process.env.DH_SPEEDKENO_API_URL||'',kind:'json'},
    speedkeno_ladder:{url:process.env.SPEEDKENO_LADDER_API_URL||'',kind:'json'},
    bubble_powerball:{url:process.env.BUBBLE_POWERBALL_API_URL||'',kind:'json'},
    bubble_ladder:{url:process.env.BUBBLE_LADDER_API_URL||'',kind:'json'},
    entry_powerball:{url:process.env.ENTRY_POWERBALL_API_URL||'',kind:'json'},
    entry_powerladder:{url:process.env.ENTRY_POWERLADDER_API_URL||'',kind:'json'},
    entry_kenoladder:{url:process.env.ENTRY_KENOLADDER_API_URL||'',kind:'json'},
    entry_speedkeno:{url:process.env.ENTRY_SPEEDKENO_API_URL||'',kind:'json'},
    named_powerball:{url:process.env.NAMED_POWERBALL_API_URL||'',kind:'json'},
    named_powerladder:{url:process.env.NAMED_POWERLADDER_API_URL||'',kind:'json'}
});
module.exports={PROVIDERS};
