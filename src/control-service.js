const COMMANDS = new Set(['toggle', 'on', 'off']);

function confirmation(enabled) {
  return {
    title: 'Керування сповіщеннями',
    message: enabled
      ? 'Сповіщення про літаки увімкнено'
      : 'Сповіщення про літаки вимкнено',
    tags: enabled ? 'white_check_mark,airplane' : 'no_entry_sign,airplane',
  };
}

export class ControlService {
  constructor(options) {
    Object.assign(this, options);
    this.nowMilliseconds = options.nowMilliseconds ?? Date.now;
    this.running = false;
  }

  async sync() {
    if (!this.config.control.enabled) return { status: 'disabled' };
    if (this.running) return { status: 'skipped', reason: 'control_sync_already_running' };
    this.running = true;
    try {
      const cursor = await this.stateStore.getControlCursor();
      const messages = await this.controlClient.messagesSince(
        cursor ?? `${this.config.control.initialReplaySeconds}s`,
      );
      let applied = 0;
      let ignored = 0;
      let enabled = await this.stateStore.notificationsEnabled();
      let newestMessageId = cursor;
      const nowSeconds = Math.floor(this.nowMilliseconds() / 1000);

      for (const message of messages) {
        if (message.event !== 'message' || !message.id) continue;
        newestMessageId = message.id;
        const command = String(message.message ?? '').trim().toLowerCase();
        const ageSeconds = nowSeconds - Number(message.time);
        if (!COMMANDS.has(command) || !Number.isFinite(ageSeconds) || ageSeconds < -30 || ageSeconds > this.config.control.maxCommandAgeSeconds) {
          ignored += 1;
          this.logger('info', 'control_command_ignored', {
            messageId: message.id,
            command: COMMANDS.has(command) ? command : 'invalid',
            reason: COMMANDS.has(command) ? 'stale_command' : 'invalid_command',
          });
          continue;
        }
        const result = await this.stateStore.applyNotificationCommand(
          message.id,
          command,
          this.config.control.deduplicationTtlSeconds,
        );
        enabled = result.enabled;
        if (!result.applied) continue;
        applied += 1;
        this.logger('info', 'notifications_toggled', {
          messageId: message.id,
          command,
          enabled,
        });
        const results = await Promise.allSettled(
          this.config.notifications.targets.map((target) =>
            this.ntfyClient.publish(target.topic, confirmation(enabled))),
        );
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            this.logger('error', 'control_confirmation_failed', {
              target: this.config.notifications.targets[index].id,
              message: result.reason.message,
            });
          }
        });
      }

      if (newestMessageId && newestMessageId !== cursor) {
        await this.stateStore.setControlCursor(newestMessageId);
      }
      return { status: 'ok', messages: messages.length, applied, ignored, enabled };
    } catch (error) {
      this.logger('error', 'control_sync_failed', { message: error.message });
      return { status: 'degraded', error: error.message };
    } finally {
      this.running = false;
    }
  }
}
