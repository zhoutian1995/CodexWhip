const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  clearBinding,
  loadBinding,
  restoreBinding,
  saveBinding,
} = require('../lib/binding-store');

function makeBindingPath(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codexwhip-binding-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'binding.json');
}

test('binding persistence stores only the task title', t => {
  const filePath = makeBindingPath(t);
  assert.equal(saveBinding(filePath, '  测试任务  ').ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { taskTitle: '测试任务' });
  assert.deepEqual(loadBinding(filePath), {
    ok: true,
    code: 'BINDING_LOADED',
    taskTitle: '测试任务',
  });
  assert.equal(clearBinding(filePath).ok, true);
  assert.equal(loadBinding(filePath).code, 'BINDING_NOT_FOUND');
});

test('unique matching title restores the fresh runtime id', () => {
  const result = restoreBinding('测试任务', {
    ok: true,
    taskTitle: '测试任务',
    taskTitleMatchCount: 1,
    taskRuntimeId: '42.new.runtime',
    hwnd: 123,
    processId: 456,
  });

  assert.equal(result.ok, true);
  assert.equal(result.binding.taskRuntimeId, '42.new.runtime');
});

test('duplicate or inactive titles never restore automatically', () => {
  assert.equal(restoreBinding('测试任务', {
    ok: true,
    taskTitle: '测试任务',
    taskTitleMatchCount: 2,
    taskRuntimeId: '42.runtime',
  }).code, 'DUPLICATE_TASK_TITLE');

  assert.equal(restoreBinding('测试任务', {
    ok: true,
    taskTitle: '其他任务',
    taskTitleMatchCount: 1,
    taskRuntimeId: '42.runtime',
  }).code, 'TARGET_SESSION_MISMATCH');
});
