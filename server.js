import "dotenv/config";
import express from 'express';
import sharp from 'sharp';
import fetch from 'node-fetch';
import { createCanvas, loadImage, registerFont } from 'canvas';
import PDFDocument from 'pdfkit';
import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Register all Poppins weights
registerFont('./fonts/Poppins-Regular.ttf', { family: 'Poppins', weight: 'normal' });
registerFont('./fonts/Poppins-Medium.ttf', { family: 'Poppins', weight: '500' });
registerFont('./fonts/Poppins-SemiBold.ttf', { family: 'Poppins', weight: '600' });
registerFont('./fonts/Poppins-Bold.ttf', { family: 'Poppins', weight: 'bold' });
registerFont('./fonts/Poppins-ExtraBold.ttf', { family: 'Poppins', weight: '800' });

const app = express();
app.use(express.json({ limit: '50mb' }));

const IMGBB_API_KEY = process.env.IMGBB_API_KEY;

const DEFAULT_LAYOUT = {
  canvas: {
    width: 1080,
    height: 1650,
    background: '#ffffff',
  },
  elements: [
    {
      id: 'product-image',
      type: 'image',
      sourceKey: 'product_image_url',
      x: 32,
      y: 34,
      width: 1018,
      height: 1330,
      fit: 'cover',
      fill: '#f4f7f9',
      borderWidth: 0,
      borderRadius: 0,
      zIndex: 10,
    },
    {
      id: 'contact-button',
      type: 'button',
      text: 'CONTACT ME',
      x: 385,
      y: 1404,
      width: 310,
      height: 56,
      fill: '#172189',
      color: '#ffffff',
      borderWidth: 0,
      borderRadius: 45,
      fontSize: 36,
      fontWeight: '600',
      fontFamily: 'Arial',
      textAlign: 'center',
      zIndex: 20,
    },
    {
      id: 'footer-bg',
      type: 'shape',
      x: -6,
      y: 1384,
      width: 1098,
      height: 280,
      fill: '#ffffff',
      borderWidth: 0,
      borderRadius: 0,
      zIndex: 5,
    },
    {
      id: 'profile-photo',
      type: 'circleImage',
      sourceKey: 'profile_photo_url',
      x: 46,
      y: 1415,
      width: 217,
      height: 217,
      fit: 'cover',
      fill: '#edf2f7',
      borderColor: '#00188f',
      borderWidth: 5,
      zIndex: 30,
      visible: true,
    },
    {
      id: 'tc-logo',
      type: 'image',
      sourceKey: 'tc_logo_url',
      x: 793,
      y: 1396,
      width: 253,
      height: 239,
      fit: 'contain',
      fill: '#ffffff',
      borderWidth: 0,
      borderRadius: 0,
      zIndex: 30,
    },
    {
      id: 'ref-number',
      type: 'text',
      textKey: 'tc_ref',
      text: 'REF: TC000000',
      x: 272,
      y: 1475,
      width: 536,
      height: 42,
      fontSize: 30,
      fontWeight: '700',
      fontFamily: 'Arial',
      color: '#0a348f',
      textAlign: 'center',
      verticalAlign: 'middle',
      zIndex: 35,
    },
    {
      id: 'full-name',
      type: 'text',
      textKey: 'full_name',
      text: 'Bafana Mawasha',
      x: 272,
      y: 1508,
      width: 536,
      height: 52,
      fontSize: 42,
      fontWeight: '800',
      fontFamily: 'Arial',
      color: '#0f172a',
      textAlign: 'center',
      verticalAlign: 'middle',
      zIndex: 35,
    },
    {
      id: 'verified-badge',
      type: 'image',
      sourceKey: 'verified_badge_url',
      x: 38,
      y: 1413,
      width: 74,
      height: 74,
      fit: 'contain',
      fill: '#ffffff',
      borderWidth: 0,
      borderRadius: 0,
      zIndex: 40,
    },
    {
      id: 'whatsapp-number',
      type: 'text',
      textKey: 'whatsapp_number',
      text: '+27 82 000 0000',
      x: 272,
      y: 1569,
      width: 536,
      height: 42,
      fontSize: 32,
      fontWeight: '700',
      fontFamily: 'Arial',
      color: '#0b0e75',
      textAlign: 'center',
      verticalAlign: 'middle',
      zIndex: 35,
    },
  ],
};

// Helper to download images
async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

// Helper to upload a buffer to imgbb and return the hosted URL
async function uploadToImgbb(buffer, filename) {
  if (!IMGBB_API_KEY) {
    throw new Error('IMGBB_API_KEY environment variable is not configured');
  }

  const base64 = buffer.toString('base64');
  const params = new URLSearchParams();
  params.append('key', IMGBB_API_KEY);
  params.append('image', base64);
  if (filename) params.append('name', filename);

  const response = await fetch('https://api.imgbb.com/1/upload', {
    method: 'POST',
    body: params,
  });

  const data = await response.json();
  if (!data.success) {
    throw new Error(`imgbb upload failed: ${JSON.stringify(data)}`);
  }

  return data.data.url;
}

app.post('/api/compose', async (req, res) => {
  try {
    const { profile_photo_url, product_image_url, full_name, whatsapp_number, tc_ref, tc_ref_code, tc_logo_url, verified_badge_url } = req.body;
    const referenceNumber = tc_ref || tc_ref_code || '';

    if (!profile_photo_url || !product_image_url || !full_name || !whatsapp_number) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['profile_photo_url', 'product_image_url', 'full_name', 'whatsapp_number']
      });
    }

    const WIDTH = DEFAULT_LAYOUT.canvas.width;
    const HEIGHT = DEFAULT_LAYOUT.canvas.height;
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    const values = {
      ...req.body,
      tc_ref: referenceNumber,
    };

    ctx.fillStyle = DEFAULT_LAYOUT.canvas.background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    function drawRoundedRect(x, y, width, height, radius = 0) {
      const safeRadius = Math.min(radius, width / 2, height / 2);
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, safeRadius);
    }

    function drawBox(element) {
      ctx.fillStyle = element.fill || '#ffffff';
      if (element.borderRadius) {
        drawRoundedRect(element.x, element.y, element.width, element.height, element.borderRadius);
        ctx.fill();
      } else {
        ctx.fillRect(element.x, element.y, element.width, element.height);
      }

      if (element.borderWidth) {
        ctx.strokeStyle = element.borderColor || '#000000';
        ctx.lineWidth = element.borderWidth;
        if (element.borderRadius) {
          drawRoundedRect(element.x, element.y, element.width, element.height, element.borderRadius);
          ctx.stroke();
        } else {
          ctx.strokeRect(element.x, element.y, element.width, element.height);
        }
      }
    }

    function drawImageFit(img, x, y, width, height, fit = 'cover') {
      const sourceRatio = img.width / img.height;
      const targetRatio = width / height;
      let sourceX = 0;
      let sourceY = 0;
      let sourceWidth = img.width;
      let sourceHeight = img.height;

      if (fit === 'cover') {
        if (sourceRatio < targetRatio) {
          sourceHeight = img.width / targetRatio;
          sourceY = (img.height - sourceHeight) / 2;
        } else {
          sourceWidth = img.height * targetRatio;
          sourceX = (img.width - sourceWidth) / 2;
        }
        ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
        return;
      }

      const scale = Math.min(width / img.width, height / img.height);
      const drawWidth = img.width * scale;
      const drawHeight = img.height * scale;
      ctx.drawImage(img, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
    }

    function drawImageElement(element, img) {
      drawBox(element);

      if (element.borderRadius) {
        ctx.save();
        drawRoundedRect(element.x, element.y, element.width, element.height, element.borderRadius);
        ctx.clip();
      }

      drawImageFit(img, element.x, element.y, element.width, element.height, element.fit);

      if (element.borderRadius) {
        ctx.restore();
      }
    }

    function drawCircleImageElement(element, img) {
      const radius = Math.min(element.width, element.height) / 2;
      const centerX = element.x + element.width / 2;
      const centerY = element.y + element.height / 2;

      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = element.fill || '#ffffff';
      ctx.fillRect(element.x, element.y, element.width, element.height);
      drawImageFit(img, element.x, element.y, element.width, element.height, element.fit);
      ctx.restore();

      if (element.borderWidth) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius - element.borderWidth / 2, 0, Math.PI * 2);
        ctx.strokeStyle = element.borderColor || '#000000';
        ctx.lineWidth = element.borderWidth;
        ctx.stroke();
      }
    }

    function drawTextElement(element) {
      const text = String(values[element.textKey] || element.text || '');
      let fontSize = element.fontSize;
      ctx.fillStyle = element.color;
      ctx.textAlign = element.textAlign || 'center';
      ctx.textBaseline = element.verticalAlign === 'middle' ? 'middle' : 'alphabetic';

      while (fontSize > 20) {
        ctx.font = `${element.fontWeight || '400'} ${fontSize}px ${element.fontFamily || 'Arial'}`;
        if (ctx.measureText(text).width <= element.width) break;
        fontSize -= 1;
      }

      const textX = element.textAlign === 'center' ? element.x + element.width / 2 : element.x;
      const textY = element.verticalAlign === 'middle' ? element.y + element.height / 2 : element.y + element.height;
      ctx.fillText(text, textX, textY);
    }

    const imageCache = new Map();
    async function getElementImage(element) {
      const url = values[element.sourceKey];
      if (!url) return null;
      if (!imageCache.has(url)) {
        imageCache.set(url, loadImage(await downloadImage(url)));
      }
      return imageCache.get(url);
    }

    const elements = [...DEFAULT_LAYOUT.elements].sort((a, b) => a.zIndex - b.zIndex);
    for (const element of elements) {
      if (element.visible === false) continue;

      if (element.type === 'shape') {
        drawBox(element);
        continue;
      }

      if (element.type === 'button') {
        drawBox(element);
        drawTextElement(element);
        continue;
      }

      if (element.type === 'text') {
        drawTextElement(element);
        continue;
      }

      if (element.type === 'image') {
        const img = await getElementImage(element);
        if (img) drawImageElement(element, img);
        continue;
      }

      if (element.type === 'circleImage') {
        const img = await getElementImage(element);
        if (img) drawCircleImageElement(element, img);
      }
    }

    // Return a data URL so n8n can upload the composed image using its ImgBB credential.
    const buffer = canvas.toBuffer('image/png');

    res.status(200).json({
      success: true,
      url: `data:image/png;base64,${buffer.toString('base64')}`,
      message: 'Image generated successfully'
    });

  } catch (error) {
    console.error('Error composing image:', error);
    res.status(500).json({ success: false, error: 'Failed to compose image', details: error.message });
  }
});

// PDF ENDPOINT
app.post('/api/compose-pdf', async (req, res) => {
  try {
    const { profile_photo_url, product_image_url, full_name, whatsapp_number, tc_ref_code, tc_logo_url, verified_badge_url } = req.body;

    if (!profile_photo_url || !product_image_url || !full_name || !whatsapp_number) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['profile_photo_url', 'product_image_url', 'full_name', 'whatsapp_number']
      });
    }

    const A4_WIDTH = 595.28;
    const A4_HEIGHT = 841.89;
    const CANVAS_WIDTH = 1240;
    const CANVAS_HEIGHT = 1754;
    
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const topPadding = CANVAS_WIDTH * 0.03;
    const productHeight = 1500;
    const productImg = await loadImage(await downloadImage(product_image_url));

    const productWidth = CANVAS_WIDTH - topPadding * 2;
    const productDrawHeight = productHeight - topPadding * 2;
    ctx.drawImage(productImg, topPadding, topPadding, productWidth, productDrawHeight);

    const buttonHeight = 90;
    const buttonWidth = 520;
    const buttonX = (CANVAS_WIDTH - buttonWidth) / 2;
    const buttonY = productHeight - buttonHeight / 2 - 30;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;

    ctx.fillStyle = '#1e40af';
    ctx.beginPath();
    ctx.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, 45);
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 38px Poppins';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CONTACT ME', CANVAS_WIDTH / 2, buttonY + buttonHeight / 2);

    const profilePaddingBottom = 22;
    const profilePaddingLeft = CANVAS_WIDTH * 0.05;
    const profileSize = 150;
    const profileX = profilePaddingLeft;
    const profileY = CANVAS_HEIGHT - profileSize - profilePaddingBottom;

    const borderWidth = 7;
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2 + borderWidth / 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#4899d4';
    ctx.lineWidth = borderWidth;
    ctx.stroke();

    const profileImg = await loadImage(await downloadImage(profile_photo_url));
    ctx.save();
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    const imgRatio = profileImg.width / profileImg.height;
    let drawWidth, drawHeight, drawX, drawY;
    if (imgRatio > 1) {
      drawHeight = profileSize;
      drawWidth = profileSize * imgRatio;
      drawX = profileX - (drawWidth - profileSize) / 2;
      drawY = profileY;
    } else {
      drawWidth = profileSize;
      drawHeight = profileSize / imgRatio;
      drawX = profileX;
      drawY = profileY - (drawHeight - profileSize) / 2;
    }
    ctx.drawImage(profileImg, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();

    if (verified_badge_url) {
      const badgeSize = 45;
      const badgeX = profileX - (badgeSize * 0.3);
      const badgeY = profileY - (badgeSize * 0.3);
      const badgeImg = await loadImage(await downloadImage(verified_badge_url));
      ctx.drawImage(badgeImg, badgeX, badgeY, badgeSize, badgeSize);
    }

    const logoSize = 165;
    const logoX = CANVAS_WIDTH - logoSize - topPadding;
    const logoY = CANVAS_HEIGHT - logoSize;
    if (tc_logo_url) {
      const tcLogo = await loadImage(await downloadImage(tc_logo_url));
      ctx.drawImage(tcLogo, logoX, logoY, logoSize, logoSize);
    }

    const profileCenterY = profileY + profileSize / 2;
    const logoCenterY = logoY + logoSize / 2;
    const verticalCenterY = (profileCenterY + logoCenterY) / 2;

    ctx.textAlign = 'center';
   
    if (tc_ref_code) {
      ctx.fillStyle = '#1e40af';
      ctx.font = 'bold 32px Poppins';
      ctx.fillText(tc_ref_code, CANVAS_WIDTH / 2, verticalCenterY - 55);
    }
    
    ctx.fillStyle = '#1e40af';
    ctx.font = '800 36px Poppins';
    ctx.fillText(full_name.toUpperCase(), CANVAS_WIDTH / 2, verticalCenterY - 13);

    ctx.fillStyle = '#232424';
    ctx.font = '600 28px Poppins';
    ctx.fillText(whatsapp_number, CANVAS_WIDTH / 2, verticalCenterY + 30);

    const imageBuffer = canvas.toBuffer('image/png');

    const doc = new PDFDocument({ size: 'A4', margin: 0 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${full_name.replace(/\s+/g, '_')}.pdf"`);

    doc.pipe(res);
    doc.image(imageBuffer, 0, 0, { width: A4_WIDTH, height: A4_HEIGHT });
    doc.end();

  } catch (error) {
    console.error('Error composing PDF:', error);
    res.status(500).json({ error: 'Failed to compose PDF', details: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Image Compositor API' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Image Compositor API running on port ${PORT}`);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to generate a single frame with animation progress
async function generateFrame(frameNum, totalFrames, data, tempDir) {
  const { profile_photo_url, product_image_url, full_name, whatsapp_number, tc_ref_code, tc_logo_url, verified_badge_url } = data;
  
  const WIDTH = 1080;
  const HEIGHT = 1920;
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  const progress = frameNum / totalFrames;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const eased = easeOutCubic(progress);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const topPadding = WIDTH * 0.03;
  const productHeight = 1700;
  
  const productProgress = Math.min(progress * 2.5, 1);
  const productEased = easeOutCubic(productProgress);
  const productZoom = 1 + (0.05 * (1 - productEased));
  
  ctx.globalAlpha = productEased;
  
  const productImg = await loadImage(await downloadImage(product_image_url));
  const productWidth = WIDTH - topPadding * 2;
  const productDrawHeight = productHeight - topPadding * 2;
  
  const zoomWidth = productWidth * productZoom;
  const zoomHeight = productDrawHeight * productZoom;
  const zoomOffsetX = (zoomWidth - productWidth) / 2;
  const zoomOffsetY = (zoomHeight - productDrawHeight) / 2;
  
  ctx.drawImage(productImg, topPadding - zoomOffsetX, topPadding - zoomOffsetY, zoomWidth, zoomHeight);
  ctx.globalAlpha = 1;

  const buttonProgress = Math.max(0, Math.min((progress - 0.3) * 2.5, 1));
  const buttonEased = easeOutCubic(buttonProgress);
  
  const buttonHeight = 100;
  const buttonWidth = 600;
  const buttonX = (WIDTH - buttonWidth) / 2;
  const buttonYFinal = productHeight - buttonHeight / 2 - 80;
  const buttonYStart = buttonYFinal + 100;
  const buttonY = buttonYStart + (buttonYFinal - buttonYStart) * buttonEased;

  if (buttonProgress > 0) {
    ctx.globalAlpha = buttonEased;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#1e40af';
    ctx.beginPath();
    ctx.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, 50);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 42px Poppins';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CONTACT ME', WIDTH / 2, buttonY + buttonHeight / 2);
    ctx.globalAlpha = 1;
  }

  const bottomProgress = Math.max(0, Math.min((progress - 0.5) * 2, 1));
  const bottomEased = easeOutCubic(bottomProgress);

  if (bottomProgress > 0) {
    ctx.globalAlpha = bottomEased;
    
    const profilePaddingBottom = 25;
    const profilePaddingLeft = WIDTH * 0.05;
    const profileSize = 170;
    const profileX = profilePaddingLeft;
    const profileY = HEIGHT - profileSize - profilePaddingBottom;

    const borderWidth = 8;
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2 + borderWidth / 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#4899d4';
    ctx.lineWidth = borderWidth;
    ctx.stroke();

    const profileImg = await loadImage(await downloadImage(profile_photo_url));
    ctx.save();
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    const imgRatio = profileImg.width / profileImg.height;
    let drawWidth, drawHeight, drawX, drawY;
    if (imgRatio > 1) {
      drawHeight = profileSize;
      drawWidth = profileSize * imgRatio;
      drawX = profileX - (drawWidth - profileSize) / 2;
      drawY = profileY;
    } else {
      drawWidth = profileSize;
      drawHeight = profileSize / imgRatio;
      drawX = profileX;
      drawY = profileY - (drawHeight - profileSize) / 2;
    }
    ctx.drawImage(profileImg, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();

    if (verified_badge_url) {
      const badgeSize = 50;
      const badgeImg = await loadImage(await downloadImage(verified_badge_url));
      ctx.drawImage(badgeImg, profileX - (badgeSize * 0.3), profileY - (badgeSize * 0.3), badgeSize, badgeSize);
    }

    const logoSize = 190;
    const logoX = WIDTH - logoSize - topPadding;
    const logoY = HEIGHT - logoSize;
    if (tc_logo_url) {
      const tcLogo = await loadImage(await downloadImage(tc_logo_url));
      ctx.drawImage(tcLogo, logoX, logoY, logoSize, logoSize);
    }

    const profileCenterY = profileY + profileSize / 2;
    const logoCenterY = logoY + logoSize / 2;
    const verticalCenterY = (profileCenterY + logoCenterY) / 2;

    ctx.textAlign = 'center';

    if (tc_ref_code) {
      const refProgress = Math.max(0, Math.min((progress - 0.55) * 3, 1));
      ctx.globalAlpha = easeOutCubic(refProgress) * bottomEased;
      ctx.fillStyle = '#1e40af';
      ctx.font = 'bold 36px Poppins';
      ctx.fillText(tc_ref_code, WIDTH / 2, verticalCenterY - 80);
    }

    const nameProgress = Math.max(0, Math.min((progress - 0.6) * 3, 1));
    ctx.globalAlpha = easeOutCubic(nameProgress) * bottomEased;
    ctx.fillStyle = '#1e40af';
    ctx.font = '800 40px Poppins';
    ctx.fillText(full_name.toUpperCase(), WIDTH / 2, verticalCenterY - 5);

    const whatsappProgress = Math.max(0, Math.min((progress - 0.65) * 3, 1));
    ctx.globalAlpha = easeOutCubic(whatsappProgress) * bottomEased;
    ctx.fillStyle = '#232424';
    ctx.font = '600 32px Poppins';
    ctx.fillText(whatsapp_number, WIDTH / 2, verticalCenterY + 45);
    
    ctx.globalAlpha = 1;
  }

  const buffer = canvas.toBuffer('image/png');
  const framePath = path.join(tempDir, `frame_${String(frameNum).padStart(4, '0')}.png`);
  await writeFile(framePath, buffer);
  
  return framePath;
}

// VIDEO ENDPOINT
app.post('/api/compose-video', async (req, res) => {
  const tempDir = path.join(__dirname, 'temp_frames_' + Date.now());
  
  try {
    const { profile_photo_url, product_image_url, full_name, whatsapp_number, tc_ref_code, tc_logo_url, verified_badge_url } = req.body;

    if (!profile_photo_url || !product_image_url || !full_name || !whatsapp_number) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['profile_photo_url', 'product_image_url', 'full_name', 'whatsapp_number']
      });
    }

    await mkdir(tempDir, { recursive: true });

    const FPS = 30;
    const DURATION = 5;
    const totalFrames = FPS * DURATION;

    console.log(`Generating ${totalFrames} frames...`);

    for (let i = 0; i < totalFrames; i++) {
      await generateFrame(i, totalFrames, req.body, tempDir);
      if (i % 30 === 0) console.log(`Generated frame ${i}/${totalFrames}`);
    }

    console.log('All frames generated, creating video...');

    const outputPath = path.join(__dirname, `output_${Date.now()}.mp4`);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(path.join(tempDir, 'frame_%04d.png'))
        .inputFPS(FPS)
        .videoCodec('libx264')
        .outputOptions(['-pix_fmt yuv420p', '-preset medium', '-crf 23'])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    console.log('Video created successfully!');

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${full_name.replace(/\s+/g, '_')}.mp4"`);
    
    const videoBuffer = await promisify(require('fs').readFile)(outputPath);
    res.send(videoBuffer);

    setTimeout(async () => {
      try {
        const files = await promisify(require('fs').readdir)(tempDir);
        for (const file of files) {
          await unlink(path.join(tempDir, file));
        }
        await promisify(require('fs').rmdir)(tempDir);
        await unlink(outputPath);
        console.log('Cleanup completed');
      } catch (err) {
        console.error('Cleanup error:', err);
      }
    }, 5000);

  } catch (error) {
    console.error('Error composing video:', error);
    
    try {
      if (existsSync(tempDir)) {
        const files = await promisify(require('fs').readdir)(tempDir);
        for (const file of files) {
          await unlink(path.join(tempDir, file));
        }
        await promisify(require('fs').rmdir)(tempDir);
      }
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr);
    }
    
    res.status(500).json({ error: 'Failed to compose video', details: error.message });
  }
});
