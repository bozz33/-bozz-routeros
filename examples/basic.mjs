import { RouterOSClient } from '@bozz/routeros';

const password = process.env.ROUTEROS_PASSWORD;
if (!password) throw new Error('ROUTEROS_PASSWORD is required');

const client = new RouterOSClient({
  host: process.env.ROUTEROS_HOST ?? '192.168.88.1',
  username: process.env.ROUTEROS_USERNAME ?? 'api-readonly',
  password,
});

try {
  console.log(await client.print('/system/resource', {
    attributes: { '.proplist': ['version', 'uptime'] },
  }));
} finally {
  await client.close();
}
