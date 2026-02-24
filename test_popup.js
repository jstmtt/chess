const https = require('https');

https.get('https://www.chess.com/callback/user/popup/hikaru', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => console.log(data));
}).on('error', err => console.error(err));
