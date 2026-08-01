const fs = require('node:fs');
const path = require('node:path');

function normalizeTaskTitle(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 300);
}

function loadBinding(filePath) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, code: 'BINDING_NOT_FOUND' };
  }

  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const taskTitle = normalizeTaskTitle(value?.taskTitle);
    if (!taskTitle) return { ok: false, code: 'BINDING_INVALID' };
    return { ok: true, code: 'BINDING_LOADED', taskTitle };
  } catch (error) {
    return { ok: false, code: 'BINDING_INVALID', detail: error.message };
  }
}

function saveBinding(filePath, taskTitle) {
  const normalizedTitle = normalizeTaskTitle(taskTitle);
  if (!normalizedTitle) {
    return { ok: false, code: 'BINDING_INVALID' };
  }

  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.codexwhip-${process.pid}-${Date.now()}.tmp`
  );
  let descriptor = null;
  try {
    fs.mkdirSync(directory, { recursive: true });
    descriptor = fs.openSync(tempPath, 'wx');
    fs.writeFileSync(
      descriptor,
      `${JSON.stringify({ taskTitle: normalizedTitle }, null, 2)}\n`,
      'utf8'
    );
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, filePath);
    return { ok: true, code: 'BINDING_SAVED', taskTitle: normalizedTitle };
  } catch (error) {
    return { ok: false, code: 'BINDING_SAVE_FAILED', detail: error.message };
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    fs.rmSync(tempPath, { force: true });
  }
}

function clearBinding(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
    return { ok: true, code: 'BINDING_CLEARED' };
  } catch (error) {
    return { ok: false, code: 'BINDING_CLEAR_FAILED', detail: error.message };
  }
}

function restoreBinding(savedTitle, probeResult) {
  const taskTitle = normalizeTaskTitle(savedTitle);
  if (!taskTitle || !probeResult?.ok) {
    return { ok: false, code: probeResult?.code || 'BINDING_RESTORE_FAILED' };
  }
  if (probeResult.taskTitle !== taskTitle) {
    return { ok: false, code: 'TARGET_SESSION_MISMATCH' };
  }
  if (probeResult.taskTitleMatchCount !== 1) {
    return {
      ok: false,
      code: probeResult.taskTitleMatchCount > 1
        ? 'DUPLICATE_TASK_TITLE'
        : 'TASK_TITLE_UNVERIFIED',
    };
  }
  if (!probeResult.taskRuntimeId) {
    return { ok: false, code: 'TASK_ID_NOT_FOUND' };
  }

  return {
    ok: true,
    code: 'BINDING_RESTORED',
    binding: {
      hwnd: probeResult.hwnd,
      processId: probeResult.processId,
      taskTitle,
      taskRuntimeId: probeResult.taskRuntimeId,
    },
  };
}

module.exports = {
  clearBinding,
  loadBinding,
  normalizeTaskTitle,
  restoreBinding,
  saveBinding,
};
