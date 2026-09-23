import { NtfyClient } from '../src/ntfy.js';

const selection = process.argv[2] ?? 'both';
if (!['iphone1', 'iphone2', 'both'].includes(selection)) {
  throw new Error('Usage: npm run test:push -- iphone1|iphone2|both');
}

const targets = [
  { id: 'iphone1', topic: process.env.NTFY_TOPIC_IPHONE_1 },
  { id: 'iphone2', topic: process.env.NTFY_TOPIC_IPHONE_2 },
].filter((target) => selection === 'both' || target.id === selection);

for (const target of targets) {
  if (!target.topic || target.topic.startsWith('CHANGE_ME') || target.topic.length < 32) {
    throw new Error(`Configure a random topic of at least 32 characters for ${target.id}`);
  }
}

const baseUrl = process.env.NTFY_BASE_URL ?? 'https://ntfy.sh';
if (new URL(baseUrl).protocol !== 'https:') throw new Error('NTFY_BASE_URL must use HTTPS');
const client = new NtfyClient({ baseUrl, priority: process.env.NTFY_PRIORITY ?? 'default' });

for (const target of targets) {
  await client.publish(target.topic, {
    title: 'Тест Aircraft Alerts',
    message: `Тестове push-повідомлення для ${target.id}. Система налаштована правильно.`,
  });
  console.log(JSON.stringify({ level: 'info', event: 'test_notification_sent', target: target.id }));
}
