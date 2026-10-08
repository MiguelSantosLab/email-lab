const express = require('express');
const sharp = require('sharp');
const { GifWriter } = require('omggif');
const path = require('path');

const app = express();
const PORT = 3000;

// ==========================================
// WORD GENERATOR & DICTIONARY LOGIC
// ==========================================

/**
 * Safely load a JSON array from the ./data/ directory.
 * If the file is missing or malformed, it returns a safe fallback array.
 */
function safeRequireJson(relativePath, fallbackArray) {
  try {
    const loadedData = require(relativePath);
    if (Array.isArray(loadedData) && loadedData.length > 0) {
      return loadedData;
    }
    return fallbackArray;
  } catch (err) {
    return fallbackArray;
  }
}

// Load dictionaries relative to this file
const dictionaries = {
  names: safeRequireJson('./data/names.json', ['sample', 'alpha', 'beta']),
  verbs: safeRequireJson('./data/verbs.json', ['renders', 'builds', 'scales']),
  adverbs: safeRequireJson('./data/adverbs.json', ['quickly', 'smoothly', 'natively']),
  adjectives: safeRequireJson('./data/adjectives.json', ['modular', 'custom', 'flexible'])
};

/**
 * Returns 'sample' 50% of the time, or a random word from the requested dictionary category.
 * @param {string} category - 'names', 'verbs', 'adverbs', or 'adjectives'
 */
function getWord(category = 'names') {
  if (Math.random() < 0.5) {
    return 'sample';
  }

  const wordList = dictionaries[category] || dictionaries.names;
  const randomIndex = Math.floor(Math.random() * wordList.length);
  return wordList[randomIndex];
}

/**
 * Escapes special characters for safe SVG string insertion
 */
function escapeXml(unsafe) {
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

// Disable caching headers for dynamic routes
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// 1. Serve static files (like index4.html, CSS, JS) from current folder
app.use(express.static(__dirname));

// 2. Explicitly serve index4.html when requesting root '/'
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index4.html'));
});

/**
 * Shared SVG 4x4 dither pattern matrix (IDs 0 to 6).
 */
function getDitherPatternSVG(densityIndex) {
  const matrix = [
    '<rect x="0" y="0" width="1" height="1" fill="#000000" /><rect x="2" y="2" width="1" height="1" fill="#000000" />',
    '<rect x="0" y="0" width="2" height="1" fill="#000000" /><rect x="2" y="2" width="2" height="1" fill="#000000" />',
    '<rect x="0" y="0" width="2" height="2" fill="#000000" /><rect x="2" y="3" width="2" height="1" fill="#000000" />',
    '<rect x="0" y="0" width="2" height="2" fill="#000000" /><rect x="2" y="2" width="2" height="2" fill="#000000" />'
  ];

  const patternContent = matrix[Math.min(Math.max(densityIndex, 0), 3)];

  return '<pattern id="ditherTile" width="4" height="4" patternUnits="userSpaceOnUse">' +
    '<rect width="4" height="4" fill="#ffffff" />' +
    patternContent +
    '</pattern>';
}

/**
 * Fisher-Yates shuffle helper
 */
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ==========================================
// DYNAMIC WORD TAG ENDPOINT (PNG)
// ==========================================
app.get('/word-tag.png', async (req, res) => {
  try {
    const category = dictionaries[req.query.type] ? req.query.type : 'names';
    const list = dictionaries[category];

    const raw = req.query.text ||
      (req.query.sample === '0'
        ? list[Math.floor(Math.random() * list.length)]
        : getWord(category));
    const text = String(raw).trim().toUpperCase();   // caps only, so ink height == cap height

    const capHeight = parseInt(req.query.capHeight, 10) || 12;   // X
    const bgColor   = req.query.bg || '#000000';
    const textColor = req.query.color || '#ffffff';

    const fontPx = Math.round(capHeight / 0.716);    // Arial/Liberation cap height ≈ 0.716 em

    // 1. Render the text alone on a transparent canvas
    const textPng = await sharp({
      text: {
        text: `<span foreground="${escapeXml(textColor)}">${escapeXml(text)}</span>`,
        font: `Arial ${fontPx}`,
        dpi: 72,
        rgba: true
      }
    }).png().toBuffer();

    // 2. Trim to the ink: width now = exactly the letters, left and right touching the edges
    const { data, info } = await sharp(textPng)
      .trim()
      .toBuffer({ resolveWithObject: true });

    // 3. Force the height to exactly X (fixes 1px rounding / round-letter overshoot)
    let pipeline = sharp(data);
    if (info.height !== capHeight) {
      pipeline = pipeline.resize(info.width, capHeight, { fit: 'fill' });
    }

    // 4. Put it on the background colour. No padding, no rounded corners
    const png = await pipeline
      .flatten({ background: bgColor })
      .png({ compressionLevel: 9 })
      .toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    console.error('Error generating word tag:', err);
    res.status(500).send('Error generating word tag');
  }
});

// ==========================================
// 2. ORIGINAL STATIC RECTANGLES (PNG)
// ==========================================
app.get('/dither-texture.png', async (req, res) => {
  try {
    const rawId = req.query.id;

    if (rawId === 'circle') {
      const size = 32;
      const radius = 12;

      const circleSvg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg">' +
        '<circle cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + radius + '" fill="#000000" />' +
        '</svg>';

      const pngBuffer = await sharp(Buffer.from(circleSvg))
        .png({ compressionLevel: 9 })
        .toBuffer();

      res.setHeader('Content-Type', 'image/png');
      return res.send(pngBuffer);
    }

    const rectId = parseInt(rawId) || 0;
    const timeStep = Math.floor(Date.now() / 1000);

    const densityHash = Math.abs(Math.sin(timeStep * 12.9898 + rectId * 78.233));
    const densityIndex = Math.floor(densityHash * 3);

    const minWidth = 16;
    const maxWidth = 200;
    const widthHash = Math.abs(Math.sin(timeStep * 43758.5453 + rectId * 1.8));
    const width = Math.floor(minWidth + (widthHash * (maxWidth - minWidth)));
    const height = 32;

    if (width === 0) {
      const emptyBuffer = await sharp({
        create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
      }).png().toBuffer();
      
      res.setHeader('Content-Type', 'image/png');
      return res.send(emptyBuffer);
    }

    const svgString = '<svg width="' + width + '" height="' + height + '" xmlns="http://www.w3.org/2000/svg"><defs>' +
      getDitherPatternSVG(densityIndex) +
      '</defs><rect width="100%" height="100%" fill="url(#ditherTile)" rx="2"/></svg>';

    const pngBuffer = await sharp(Buffer.from(svgString))
      .png({ compressionLevel: 9 })
      .toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.send(pngBuffer);
  } catch (err) {
    console.error('Error generating static texture:', err);
    res.status(500).send('Error generating dither texture');
  }
});

// ==========================================
// 3. ANIMATED DITHER RECTANGLES (GIF)
// ==========================================
app.get('/dither-anim.gif', async (req, res) => {
  try {
    const width = parseInt(req.query.width) || 64;
    const height = 32;
    const frameDelayMs = parseInt(req.query.delay) || 1000;
    const delayCentisecs = Math.round(frameDelayMs / 10);

    const baseIDs = [0, 1, 2, 3];
    const randomIDSequence = shuffleArray(baseIDs);

    const palette = [0xFFFFFF, 0x000000];

    const gifBuffer = Buffer.alloc(width * height * randomIDSequence.length + 1024);
    const writer = new GifWriter(gifBuffer, width, height, { loop: 0, palette });

    for (const densityIndex of randomIDSequence) {
      const svgString = '<svg width="' + width + '" height="' + height + '" xmlns="http://www.w3.org/2000/svg"><defs>' +
        getDitherPatternSVG(densityIndex) +
        '</defs><rect width="100%" height="100%" fill="url(#ditherTile)" rx="2"/></svg>';

      const rawPixels = await sharp(Buffer.from(svgString))
        .grayscale()
        .raw()
        .toBuffer();

      const indexedPixels = new Uint8Array(width * height);
      for (let i = 0; i < rawPixels.length; i++) {
        indexedPixels[i] = rawPixels[i] < 128 ? 1 : 0;
      }

      writer.addFrame(0, 0, width, height, indexedPixels, {
        delay: delayCentisecs,
        palette
      });
    }

    const finalBuffer = gifBuffer.subarray(0, writer.end());

    res.setHeader('Content-Type', 'image/gif');
    res.send(finalBuffer);
  } catch (err) {
    console.error('Error generating animated GIF:', err);
    res.status(500).send('Error generating dither animation');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});