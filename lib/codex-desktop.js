function controllerForPlatform(platform = process.platform) {
  if (platform === 'win32') return require('./codex-desktop-windows');
  if (platform === 'darwin') return require('./codex-desktop-macos');

  const unsupported = async () => ({ ok: false, code: 'UNSUPPORTED_PLATFORM' });
  return {
    messageForResult: () => 'CodexWhip Desktop supports Windows and macOS only.',
    probeCodexDesktop: unsupported,
    sendWhipMessage: unsupported,
  };
}

module.exports = {
  ...controllerForPlatform(),
  controllerForPlatform,
};
