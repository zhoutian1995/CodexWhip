const RESULT_STATUS = Object.freeze({
  TARGET_SESSION_REQUIRED: 'unbound',
  TARGET_SESSION_MISMATCH: 'session-mismatch',
  DRAFT_PRESENT: 'draft',
  QUEUED_MESSAGE_STEER_FAILED: 'queue-steer-failed',
  STEER_INVOKE_UNAVAILABLE: 'queue-steer-failed',
  CODEX_CONFIG_UPDATE_FAILED: 'steer-config-failed',
  CODEX_CONFIG_CHANGED_DURING_UPDATE: 'steer-config-failed',
  CODEX_CONFIG_DUPLICATE_DESKTOP_SECTION: 'steer-config-failed',
  CODEX_CONFIG_DUPLICATE_FOLLOW_UP_MODE: 'steer-config-failed',
  CODEX_CONFIG_INVALID_FOLLOW_UP_MODE: 'steer-config-failed',
  CODEX_CONFIG_UPDATE_INVALID: 'steer-config-failed',
});

function responseForResult(result) {
  if (result?.ok) {
    return {
      status: 'sent',
      code: result.code,
      phrase: result.phrase,
      delivery: result.delivery,
    };
  }

  return {
    status: RESULT_STATUS[result?.code] || 'failed',
    code: result?.code || 'UNKNOWN_ERROR',
  };
}

module.exports = {
  responseForResult,
};
