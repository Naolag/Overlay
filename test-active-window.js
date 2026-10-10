
const {
  getForegroundWindowHandle,
} = require('./main/activeWindow');

try {
  const hwnd = getForegroundWindowHandle();
  console.log('Foreground window handle:', hwnd);
} catch (error) {
  console.error('Active-window test failed:', error);
  process.exitCode = 1;
}

