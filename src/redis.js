import net from 'node:net';

export function encodeCommand(parts) {
  const values = parts.map((part) => Buffer.from(String(part)));
  return Buffer.concat([
    Buffer.from(`*${values.length}\r\n`),
    ...values.flatMap((value) => [Buffer.from(`$${value.length}\r\n`), value, Buffer.from('\r\n')]),
  ]);
}

function lineEnd(buffer, offset) {
  return buffer.indexOf('\r\n', offset);
}

export function parseResponse(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const prefix = String.fromCharCode(buffer[offset]);
  const end = lineEnd(buffer, offset + 1);
  if (end < 0) return null;
  const header = buffer.toString('utf8', offset + 1, end);
  if (prefix === '+' || prefix === ':') {
    return { value: prefix === ':' ? Number(header) : header, offset: end + 2 };
  }
  if (prefix === '-') return { value: new Error(`Redis error: ${header}`), offset: end + 2 };
  if (prefix === '$') {
    const length = Number(header);
    if (length === -1) return { value: null, offset: end + 2 };
    const valueStart = end + 2;
    const valueEnd = valueStart + length;
    if (buffer.length < valueEnd + 2) return null;
    return { value: buffer.toString('utf8', valueStart, valueEnd), offset: valueEnd + 2 };
  }
  if (prefix === '*') {
    const count = Number(header);
    if (count === -1) return { value: null, offset: end + 2 };
    const values = [];
    let nextOffset = end + 2;
    for (let index = 0; index < count; index += 1) {
      const parsed = parseResponse(buffer, nextOffset);
      if (!parsed) return null;
      values.push(parsed.value);
      nextOffset = parsed.offset;
    }
    return { value: values, offset: nextOffset };
  }
  throw new Error('Unsupported Redis response');
}

export class RedisClient {
  constructor(options) {
    this.options = options;
  }

  async pipeline(commands) {
    const allCommands = this.options.password
      ? [['AUTH', this.options.password], ...commands]
      : commands;
    const expectedResponses = allCommands.length;
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.options.host, port: this.options.port });
      const chunks = [];
      const timeout = setTimeout(() => socket.destroy(new Error('Redis request timed out')), this.options.timeoutMilliseconds);
      const finish = (callback, value) => {
        clearTimeout(timeout);
        socket.destroy();
        callback(value);
      };
      socket.once('error', (error) => finish(reject, error));
      socket.once('connect', () => socket.write(Buffer.concat(allCommands.map(encodeCommand))));
      socket.on('data', (chunk) => {
        chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        const responses = [];
        let offset = 0;
        while (responses.length < expectedResponses) {
          const parsed = parseResponse(buffer, offset);
          if (!parsed) return;
          responses.push(parsed.value);
          offset = parsed.offset;
        }
        const error = responses.find((response) => response instanceof Error);
        if (error) finish(reject, error);
        else finish(resolve, this.options.password ? responses.slice(1) : responses);
      });
    });
  }

  async command(parts) {
    return (await this.pipeline([parts]))[0];
  }
}

export class RedisStateStore {
  constructor(client, options = {}) {
    this.client = client;
    this.namespace = options.namespace ?? 'aircraft-alerts';
  }

  trackKey(icao24) {
    return `${this.namespace}:track:${icao24}`;
  }

  alertKey(approachId, targetId) {
    return `${this.namespace}:alert:${approachId}:${targetId}`;
  }

  notificationsEnabledKey() {
    return `${this.namespace}:notifications-enabled`;
  }

  controlCursorKey() {
    return `${this.namespace}:control-cursor`;
  }

  controlMessageKey(messageId) {
    return `${this.namespace}:control-message:${messageId}`;
  }

  async getTracks(icao24Values) {
    if (icao24Values.length === 0) return new Map();
    const values = await this.client.command(['MGET', ...icao24Values.map((value) => this.trackKey(value))]);
    const tracks = new Map();
    icao24Values.forEach((icao24, index) => {
      if (!values[index]) return;
      try {
        tracks.set(icao24, JSON.parse(values[index]));
      } catch {
        // Ignore corrupt/old state; the next successful poll replaces it.
      }
    });
    return tracks;
  }

  async saveTracks(tracks, ttlSeconds) {
    if (tracks.length === 0) return;
    await this.client.pipeline(
      tracks.map(({ icao24, state }) => [
        'SET',
        this.trackKey(icao24),
        JSON.stringify(state),
        'EX',
        ttlSeconds,
      ]),
    );
  }

  async claimAlert(approachId, targetId, ttlSeconds) {
    return (await this.client.command([
      'SET',
      this.alertKey(approachId, targetId),
      '1',
      'NX',
      'EX',
      ttlSeconds,
    ])) === 'OK';
  }

  async releaseAlert(approachId, targetId) {
    await this.client.command(['DEL', this.alertKey(approachId, targetId)]);
  }

  async notificationsEnabled() {
    const value = await this.client.command(['GET', this.notificationsEnabledKey()]);
    return value !== '0';
  }

  async getControlCursor() {
    return this.client.command(['GET', this.controlCursorKey()]);
  }

  async setControlCursor(messageId) {
    await this.client.command(['SET', this.controlCursorKey(), messageId]);
  }

  async applyNotificationCommand(messageId, command, deduplicationTtlSeconds) {
    const script = [
      "local state = redis.call('GET', KEYS[2]) or '1'",
      "if not redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[1]) then return {0, state} end",
      "local next = state",
      "if ARGV[2] == 'toggle' then if state == '1' then next = '0' else next = '1' end end",
      "if ARGV[2] == 'on' then next = '1' end",
      "if ARGV[2] == 'off' then next = '0' end",
      "redis.call('SET', KEYS[2], next)",
      'return {1, next}',
    ].join('\n');
    const [applied, value] = await this.client.command([
      'EVAL',
      script,
      '2',
      this.controlMessageKey(messageId),
      this.notificationsEnabledKey(),
      deduplicationTtlSeconds,
      command,
    ]);
    return { applied: applied === 1, enabled: value === '1' };
  }

  async ping() {
    return (await this.client.command(['PING'])) === 'PONG';
  }
}
