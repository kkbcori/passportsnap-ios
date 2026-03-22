const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  'node_modules',
  'react-native-screens',
  'android',
  'src',
  'main',
  'java',
  'com',
  'swmansion',
  'rnscreens',
  'ScreenStack.kt'
);

if (fs.existsSync(filePath)) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Fix removeLast() -> removeAt(size - 1) for Android < API 35 compatibility
  if (content.includes('drawingOpPool.removeLast()')) {
    content = content.replace(
      'drawingOpPool.removeLast()',
      'drawingOpPool.removeAt(drawingOpPool.size - 1)'
    );
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('[postinstall] Patched react-native-screens: removeLast() -> removeAt()');
  } else {
    console.log('[postinstall] react-native-screens already patched or different version');
  }
} else {
  console.log('[postinstall] ScreenStack.kt not found, skipping patch');
}
