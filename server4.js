const express = require('express');
const sharp = require('sharp');
const { GifWriter } = require('omggif');
const path = require('path');

const app = express();
const PORT = 3000;

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// 1. Serve static files (like index4.html, CSS, JS) from the current folder
app.use(express.static(__dirname));

// 2. Explicitly serve index4.html when requesting the root '/'
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index4.html'));
});

/**
 * Shared SVG 4x4 dither pattern matrix (IDs 0 to 6).
 * Used by BOTH static PNG generators and animated GIF generators.
 */
function getDitherPatternSVG(densityIndex) {
  const matrix = [
    // Level 0: 12.5% black density
    '<rect x="0" y="0" width="1" height="1" fill="#000000" /><rect x="2" y="2" width="1" height="1" fill="#000000" />',
    // Level 1: 25% black density
    '<rect x="0" y="0" width="2" height="1" fill="#000000" /><rect x="2" y="2" width="2" height="1" fill="#000000" />',
    // Level 2: 37.5% black density
    '<rect x="0" y="0" width="2" height="2" fill="#000000" /><rect x="2" y="3" width="2" height="1" fill="#000000" />',
    // Level 3: 50% black density (Standard 2x2 Checkerboard)
    '<rect x="0" y="0" width="2" height="2" fill="#000000" /><rect x="2" y="2" width="2" height="2" fill="#000000" />'
  ];

  const patternContent = matrix[Math.min(Math.max(densityIndex, 0), 3)];

  return `
    <pattern id="ditherTile" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="4" fill="#ffffff" />
      ${patternContent}
    </pattern>
  `;
}

/**
 * Fisher-Yates shuffle helper for randomizing ID sequence
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
// 1. STATIC BACKGROUND TILE (PNG)
// ==========================================
app.get('/dither-bg.png', async (req, res) => {
  try {
    const width = 32;
    const height = 32;
    const level0Index = 0; // 12.5% density

    const svgTile = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          ${getDitherPatternSVG(level0Index)}
        </defs>
        <rect width="100%" height="100%" fill="url(#ditherTile)"/>
      </svg>
    `);

    const pngBuffer = await sharp(svgTile)
      .png({ compressionLevel: 9 })
      .toBuffer();

    res.setHeader('Content-Type', 'image/png');
    return res.send(pngBuffer);
  } catch (err) {
    console.error('Error generating background tile:', err);
    res.status(500).send('Error generating dither background');
  }
});

// ==========================================
// 2. ORIGINAL STATIC RECTANGLES (PNG)
// Query params: ?id=0 through ?id=6 OR ?id=circle
// ==========================================
app.get('/dither-texture.png', async (req, res) => {
  try {
    const rawId = req.query.id;

    // --- Circle Mode ---
    if (rawId === 'circle') {
      const size = 32;
      const radius = 12;

      const circleSvg = Buffer.from(`
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="#000000" />
        </svg>
      `);

      const pngBuffer = await sharp(circleSvg)
        .png({ compressionLevel: 9 })
        .toBuffer();

      res.setHeader('Content-Type', 'image/png');
      return res.send(pngBuffer);
    }

    // --- Dynamic / Explicit ID Dithered Rectangles Logic ---
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

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          ${getDitherPatternSVG(densityIndex)}
        </defs>

        <rect width="100%" height="100%" fill="url(#ditherTile)" rx="2"/>
      </svg>
    `);

    const pngBuffer = await sharp(svgOverlay)
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
// 3. NEW ANIMATED DITHER RECTANGLES (GIF)
// ==========================================
app.get('/dither-anim.gif', async (req, res) => {
  try {
    const width = parseInt(req.query.width) || 64;
    const height = 32;
    const frameDelayMs = parseInt(req.query.delay) || 1000; // Default 1 second
    const delayCentisecs = Math.round(frameDelayMs / 10);

    // Sequence of 4 dither density levels (id=0 through id=3)
    const baseIDs = [0, 1, 2, 3];
    const randomIDSequence = shuffleArray(baseIDs);

    // Cores dos fundos de span
    const palette = [0xFFFFFF, 0x000000];

    const gifBuffer = Buffer.alloc(width * height * randomIDSequence.length + 1024);
    const writer = new GifWriter(gifBuffer, width, height, { loop: 0, palette });

    for (const densityIndex of randomIDSequence) {
      const svgOverlay = Buffer.from(`
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            ${getDitherPatternSVG(densityIndex)}
          </defs>
          <rect width="100%" height="100%" fill="url(#ditherTile)" rx="2"/>
        </svg>
      `);

      const rawPixels = await sharp(svgOverlay)
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

/**
 * Endpoint: /spinner.svg (or /spinner.gif via content-type header)
 * Generates an animated ASCII loading spinner natively in SVG.
 * - Transparent background
 * - Black text
 * - Same 32x32 size as 'circle'
 */
app.get('/spinner.svg', (req, res) => {
  const size = 32;

  // Keyframe animation switching through |, /, -, \
  const svg = `
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <style>
      .spinner {
        font-family: monospace, Courier, "Courier New", monospace;
        font-size: 20px;
        font-weight: bold;
        fill: #000000;
        text-anchor: middle;
        dominant-baseline: central;
      }
      @keyframes spinText {
        0%, 100% { content: '|'; }
        25%      { content: '/'; }
        50%      { content: '-'; }
        75%      { content: '\'; }
      }
      .spinner tspan {
        animation: spinText 0.6s steps(1) infinite;
      }
    </style>
    <text x="50%" y="52%" class="spinner">
      <tspan>|</tspan>
    </text>
  </svg>
  `.trim();

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(svg);
});