// Local stand-in for Meta's Graph API (development only). Prints each request, sends nothing anywhere.
// Usage: npm run whatsapp:mock   then set WHATSAPP_GRAPH_BASE_URL=http://127.0.0.1:3198 in apps/api/.env
import { createServer } from 'node:http';

let n = 0;
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    n += 1;
    const msg = JSON.parse(body || '{}');
    const what =
      msg.type === 'template' ? `template "${msg.template?.name}"` : `text "${msg.text?.body}"`;
    console.log(`#${n} ${req.method} ${req.url} -> to ${msg.to}: ${what}`);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ messages: [{ id: `wamid.MOCK${n}` }] }));
  });
}).listen(3198, '127.0.0.1', () => console.log('Mock WhatsApp Graph API on http://127.0.0.1:3198'));
