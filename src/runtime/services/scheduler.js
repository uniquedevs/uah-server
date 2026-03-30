import { Duration } from '@uah/postgres';
import { Context } from '../context.js';
import { signal } from '#runtime/process.js';
import { now } from '#runtime/utils/native.js';

const timers = new Map();
const schedulers = new Set();

const sortByPriority = (a, b) => b.priority - a.priority;

function init(scheduler) {
  const time = Duration.from(scheduler.interval).total('milliseconds');

  if (timers.has(time)) {
    timers.get(time).schedulers.push(scheduler);

    if (scheduler.priority) {
      timers.get(time).schedulers.sort(sortByPriority);
    }
  } else {
    timers.set(time, {
      time,
      timeoutId: null,
      intervalId: null,
      schedulers: [scheduler],
    });
  }

  scheduler.isInitiated = true;
}

async function start(timer) {
  if (timer.timeoutId) {
    timer.timeoutId = null;
    timer.intervalId = setInterval(start, timer.time, timer);
  }

  for (const scheduler of timer.schedulers) {
    if (scheduler.isStarted === false) {
      scheduler.isStarted = true;

      try {
        await scheduler.start();
      } catch (error) {
        if (error) {
          console.error(error);
        }
      }

      scheduler.isStarted = false;
    }
  }
}

export class SchedulerContext extends Context {
  priority = 0;
  interval = '';

  isStarted = false;
  isInitiated = false;

  constructor() {
    schedulers.add(super());
  }

  async init() {}
  async start() {}
  async stop() {}

  static async start() {
    for (const scheduler of schedulers) {
      if (scheduler.isInitiated === false) {
        await scheduler.init();

        if (scheduler.interval) {
          init(scheduler);
        }
      }
    }

    for (const [time, timer] of timers) {
      timer.timeoutId = setTimeout(start, time - (now() % time), timer);
    }
  }

  static async stop() {
    for (const timer of timers) {
      if (timer.timeoutId) {
        clearTimeout(timer.timeoutId);
        timer.timeoutId = null;
      }

      if (timer.intervalId) {
        clearInterval(timer.intervalId);
        timer.intervalId = null;
      }
    }

    for (const scheduler of schedulers) {
      try {
        await scheduler.stop();
      } catch (error) {
        console.error(error);
      }
    }
  }
}

signal.addEventListener('abort', SchedulerContext.stop.bind(SchedulerContext));
