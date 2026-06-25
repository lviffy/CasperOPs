function extractLatestAddressFromContext(message, conversationHistory = []) {
  const currentMessageMatch = String(message || '').match(/0x[a-fA-F0-9]{40}/);
  if (currentMessageMatch) return currentMessageMatch[0];

  const historyText = (conversationHistory || [])
    .map((entry) => entry?.content || '')
    .reverse()
    .join(' ');
  const historyMatch = historyText.match(/0x[a-fA-F0-9]{40}/);
  return historyMatch ? historyMatch[0] : null;
}

function normalizeTimeUnit(unit) {
  const normalized = String(unit || '').toLowerCase();
  if (['minute', 'minutes', 'min', 'mins'].includes(normalized)) return 'minute';
  if (['hour', 'hours', 'hr', 'hrs'].includes(normalized)) return 'hour';
  if (['day', 'days'].includes(normalized)) return 'day';
  return null;
}

function addIntervalToNow(amount, unit) {
  const date = new Date();

  if (unit === 'minute') date.setMinutes(date.getMinutes() + amount);
  if (unit === 'hour') date.setHours(date.getHours() + amount);
  if (unit === 'day') date.setDate(date.getDate() + amount);

  return date.toISOString();
}

function buildRecurringCronExpression(amount, unit) {
  if (unit === 'minute' && amount >= 1 && amount <= 59) {
    return `*/${amount} * * * *`;
  }

  if (unit === 'hour' && amount >= 1 && amount <= 23) {
    return `0 */${amount} * * *`;
  }

  if (unit === 'day' && amount >= 1 && amount <= 31) {
    return `0 0 */${amount} * *`;
  }

  return null;
}

function extractReminderSchedule(message) {
  const recurringMatch = String(message || '').match(/\bevery\s+(\d+)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\b/i);
  if (recurringMatch) {
    const amount = parseInt(recurringMatch[1], 10);
    const unit = normalizeTimeUnit(recurringMatch[2]);
    const cronExpression = buildRecurringCronExpression(amount, unit);
    if (!cronExpression) {
      return {
        kind: 'recurring',
        error: 'I can currently schedule recurring reminders in minute, hour, or day intervals that cron can represent directly.'
      };
    }

    return {
      kind: 'recurring',
      cronExpression,
      amount,
      unit
    };
  }

  const oneShotMatch = String(message || '').match(/\b(?:after|in)\s+(\d+)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\b/i);
  if (oneShotMatch) {
    const amount = parseInt(oneShotMatch[1], 10);
    const unit = normalizeTimeUnit(oneShotMatch[2]);

    return {
      kind: 'one_shot',
      cronExpression: addIntervalToNow(amount, unit),
      amount,
      unit
    };
  }

  return null;
}

function detectReminderTaskType(message) {
  const lower = String(message || '').toLowerCase();

  if (/\b(list|show|what)\b.*\b(reminders|alerts|scheduled)\b/.test(lower)) {
    return 'list';
  }

  if (/\b(cancel|delete|stop|remove)\b.*\b(reminder|alert|schedule)\b/.test(lower)) {
    return 'cancel';
  }

  if (/(wallet|portfolio|account).*(price|value|worth)|(price|value|worth).*(wallet|portfolio|account)|\bportfolio\b|\bnet worth\b|\bwallet value\b/.test(lower)) {
    return 'portfolio';
  }

  if (/\b(balance|account balance|wallet balance)\b/.test(lower)) {
    return 'balance';
  }

  if (/\bprice\b/.test(lower)) {
    return 'price';
  }

  return null;
}

function extractTokenQuery(message) {
  const normalized = String(message || '')
    .replace(/\b(?:tell me|notify me|check|monitor|track|show me|what is|what's)\b/gi, '')
    .replace(/\b(?:after|in|every)\s+\d+\s*(?:minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\b/gi, '')
    .replace(/\b(reminder|alert|please|the current|current)\b/gi, '')
    .trim();

  const priceOfMatch = normalized.match(/\bprice of ([a-z0-9\s._-]+)/i);
  if (priceOfMatch) {
    return priceOfMatch[1].trim();
  }

  const beforePriceMatch = normalized.match(/\b([a-z0-9\s._-]+)\s+price\b/i);
  if (beforePriceMatch) {
    return beforePriceMatch[1].trim();
  }

  return null;
}

function extractReminderId(message) {
  const match = String(message || '').match(/\b(?:reminder|alert|schedule)\s+([a-z0-9_-]{6,})\b/i);
  return match ? match[1] : null;
}

function detectReminderPlan(userMessage, conversationHistory = []) {
  const taskType = detectReminderTaskType(userMessage);

  if (taskType === 'list') {
    return {
      analysis: 'List the user reminder jobs.',
      is_off_topic: false,
      requires_tools: true,
      extracted_context: {},
      execution_plan: {
        type: 'parallel',
        steps: [
          {
            tool: 'list_reminders',
            reason: 'User asked to see existing scheduled reminder jobs',
            parameters: {},
            depends_on: []
          }
        ]
      },
      missing_info: [],
      complexity: 'simple'
    };
  }

  if (taskType === 'cancel') {
    const reminderId = extractReminderId(userMessage);
    return {
      analysis: 'Cancel a scheduled reminder job.',
      is_off_topic: false,
      requires_tools: true,
      extracted_context: {},
      execution_plan: {
        type: 'parallel',
        steps: [
          {
            tool: 'cancel_reminder',
            reason: 'User asked to stop an existing reminder',
            parameters: { id: reminderId },
            depends_on: []
          }
        ]
      },
      missing_info: reminderId ? [] : ['reminder id'],
      complexity: 'simple'
    };
  }

  const schedule = extractReminderSchedule(userMessage);
  if (!schedule || !taskType) {
    return null;
  }

  if (schedule.error) {
    return {
      analysis: 'The user wants a scheduled reminder, but the interval cannot be translated safely.',
      is_off_topic: false,
      requires_tools: false,
      extracted_context: {},
      execution_plan: { type: 'none', steps: [] },
      missing_info: [schedule.error],
      complexity: 'simple'
    };
  }

  const walletAddress = extractLatestAddressFromContext(userMessage, conversationHistory);
  const tokenQuery = taskType === 'price' ? extractTokenQuery(userMessage) : null;
  const missingInfo = [];

  if ((taskType === 'balance' || taskType === 'portfolio') && !walletAddress) {
    missingInfo.push('wallet address');
  }

  if (taskType === 'price' && !tokenQuery) {
    missingInfo.push('token name or symbol');
  }

  const reminderLabel =
    taskType === 'balance'
      ? 'Balance reminder'
      : taskType === 'portfolio'
        ? 'Wallet value reminder'
        : 'Price reminder';

  return {
    analysis: `Create a ${schedule.kind === 'one_shot' ? 'one-time' : 'recurring'} ${reminderLabel.toLowerCase()}.`,
    is_off_topic: false,
    requires_tools: true,
    extracted_context: {
      wallet_address: walletAddress,
      token_query: tokenQuery
    },
    execution_plan: {
      type: 'parallel',
      steps: [
        {
          tool: 'schedule_reminder',
          reason: 'User asked to be notified later or on a recurring interval',
          parameters: {
            taskType,
            walletAddress,
            tokenQuery,
            cronExpression: schedule.cronExpression,
            label: reminderLabel
          },
          depends_on: []
        }
      ]
    },
    missing_info: missingInfo,
    complexity: 'simple'
  };
}

module.exports = {
  detectReminderPlan
};
