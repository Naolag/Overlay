
const { app, desktopCapturer } = require('electron');
const {
  getForegroundWindowHandle,
} = require('./main/activeWindow');

async function main() {
  await app.whenReady();

  const hwnd = getForegroundWindowHandle();

  console.log('Foreground HWND:', hwnd);

  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 1280, height: 900 },
  });

  const matches = sources.filter((source) => {
    const parts = source.id.split(':');
    const sourceHandle = parts[1];

    return sourceHandle &&
      BigInt(sourceHandle).toString(16).toLowerCase() ===
      hwnd.toLowerCase();
  });

  console.log('Matching windows:', matches.map((source) => ({
    id: source.id,
    name: source.name,
  })));

  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.quit();
});
