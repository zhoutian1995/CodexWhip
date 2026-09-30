const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'codex-ax-current.json');
const HELPER_PATH = path.join(__dirname, '..', 'scripts', 'codex-desktop-ui-macos.swift');

function loadFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function normalized(value) {
  return String(value || '').trim();
}

function visible(frame) {
  return frame && frame.width >= 1 && frame.height >= 1;
}

function currentTaskFromFixture(fixture) {
  const nodes = fixture.nodes;
  const activeDocumentTitles = nodes
    .filter(node => node.role === 'AXWebArea' && normalized(node.name) && visible(node.frame))
    .map(node => normalized(node.name));
  const taskCandidates = nodes.filter(node => {
    const classes = normalized(node.classes).toLowerCase();
    return ['AXButton', 'AXRow', 'AXLink'].includes(node.role) &&
      classes.includes('sidebar-item') &&
      !classes.includes('folder-row') &&
      normalized(node.name) && visible(node.frame);
  });
  const documentMatches = taskCandidates.filter(node => activeDocumentTitles.includes(normalized(node.name)));
  return { activeDocumentTitles, taskCandidates, documentMatches };
}

test('current AX fixture models the post-migration task and composer contract', () => {
  const fixture = loadFixture();
  assert.equal(fixture.source.bundleIdentifier, 'com.openai.codex');
  assert.match(fixture.source.version, /^26\./u);

  const composer = fixture.nodes.find(node =>
    node.role === 'AXTextArea' && normalized(node.classes).toLowerCase().includes('prosemirror')
  );
  assert.ok(composer, 'the current composer remains an AXTextArea with a prosemirror class');
  assert.equal(composer.focused, true);
  assert.equal(composer.value, '');

  const { activeDocumentTitles, taskCandidates, documentMatches } = currentTaskFromFixture(fixture);
  assert.deepEqual(activeDocumentTitles, ['示例任务']);
  assert.equal(taskCandidates.length, 2);
  assert.equal(documentMatches.length, 1);
  assert.equal(documentMatches[0].name, '示例任务');
  assert.equal(documentMatches[0].selected, false);
  assert.doesNotMatch(documentMatches[0].classes, /bg-token-list-hover-background/u);
  assert.match(documentMatches[0].classes, /(?:^|\s)bg-primary-ghost-hover(?:\s|$)/u);
  assert.match(documentMatches[0].classes, /data-\[app-action-sidebar-thread-selected=true\]/u);

  // The selected AXRadioButton is an app shell tab, not a Codex task.
  const appTab = fixture.nodes.find(node => node.role === 'AXRadioButton');
  assert.equal(appTab.selected, true);
  assert.equal(documentMatches.includes(appTab), false);
});

test('macOS helper keeps semantic fallbacks for the current AX shape', () => {
  const helper = fs.readFileSync(HELPER_PATH, 'utf8');
  assert.match(helper, /AXWebArea/u);
  assert.match(helper, /activeDocumentTitles/u);
  assert.match(helper, /app-action-sidebar-thread-selected/u);
  assert.match(helper, /func hasClassToken/u);
  assert.match(helper, /hasClassToken\(classes, "bg-token-list-hover-background"\)/u);
  assert.match(helper, /hasClassToken\(classes, "bg-primary-ghost-hover"\)/u);
  assert.match(helper, /sidebar-item/u);
  assert.match(helper, /AXTextAreaRole/u);
  assert.match(helper, /消息/u);
  assert.match(helper, /taskTitleMatchCount/u);
});
