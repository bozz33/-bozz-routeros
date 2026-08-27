import { RouterOSClient } from '@bozz/routeros';

const password = process.env.ROUTEROS_PASSWORD;
if (!password) throw new Error('ROUTEROS_PASSWORD is required');

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());

const client = new RouterOSClient({
  host: process.env.ROUTEROS_HOST ?? '192.168.88.1',
  username: process.env.ROUTEROS_USERNAME ?? 'api-readonly',
  password,
});

try {
  const stream = await client.listen('/interface', { signal: controller.signal });
  try {
    for await (const reply of stream) {
      if (reply.type === 're') console.log(reply.attributes);
    }
  } finally {
    await stream.cancel();
  }
} finally {
  await client.close();
}
