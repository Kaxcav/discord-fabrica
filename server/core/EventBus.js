import { EventEmitter } from 'events';

export class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  safeEmit(event, ...args) {
    try {
      return this.emit(event, ...args);
    } catch (err) {
      console.error(`[EventBus] Erro ao emitir evento "${event}":`, err);
      return false;
    }
  }
}

