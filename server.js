import express from 'express';
import sharp from 'sharp';
import fetch from 'node-fetch';
import { createCanvas, loadImage } from 'canvas';

const app = express();
app.use(express.json({ limit: '50mb' }));

// Helper to download images
async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

app.post('/api/compose', async (req, res) => {
  try {
    const {
      profile_photo_url,
      product_image_url,
      full_name,
      whatsapp_number,
      tc_logo_url
    } = req.body;

    if (!profile_photo_url || !product_image_url || !full_name || !whatsapp_number) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['profile_photo_url', 'product_image_url', 'full_name', 'whatsapp_number']
      });
    }

    const WIDTH = 1080;
    const HEIGHT = 1920;
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Background white
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // === PRODUCT SECTION with 5% padding ===
    const productHeight = 1400;
    const padding = WIDTH * 0.05; // 5% horizontal padding
    const productImg = await loadImage(await downloadImage(product_image_url));

    const productWidth = WIDTH - padding * 2;
    const productDrawHeight = productHeight - padding * 2;

    ctx.drawImage(productImg, padding, padding, productWidth, productDrawHeight);

    // === CONTACT BUTTON ===
    const buttonHeight = 100;
    const buttonWidth = 600;
    const buttonX = (WIDTH - buttonWidth) / 2;
    const buttonY = productHeight - (buttonHeight / 2);

    ctx.fillStyle = '#1e40af';
    ctx.beginPath();
    ctx.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, 50);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 42px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CONTACT ME', WIDTH / 2, buttonY + buttonHeight / 2);

    // === BOTTOM INFO SECTION ===
    const infoSectionY = productHeight + buttonHeight / 2 + 40;
    const profileSize = 140;
    const profileX = 80;
    const profileY = infoSectionY;

    // Profile Image (circle)
    const profileImg = await loadImage(await downloadImage(profile_photo_url));
    ctx.save();
    ctx.beginPath();
    ctx.arc(profileX + profileSize / 2, profileY + profileSize / 2, profileSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(profileImg, profileX, profileY, profileSize, profileSize);
    ctx.restore();

    // Name & WhatsApp number
    const textX = profileX + profileSize + 40;
    const textY = profileY + 40;

    ctx.fillStyle = '#1e40af';
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(full_name.toUpperCase(), textX, textY);

    ctx.fillStyle = '#000000';
    ctx.font = '32px Arial';
    ctx.fillText(whatsapp_number, textX, textY + 60);

    // TC Logo
    if (tc_logo_url) {
      const logoSize = 120;
      const logoX = WIDTH - logoSize - 60;
      const logoY = profileY + 10;
      const tcLogo = await loadImage(await downloadImage(tc_logo_url));
      ctx.drawImage(tcLogo, logoX, logoY, logoSize, logoSize);
    }

    // Return final image
    const buffer = canvas.toBuffer('image/png');
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="${full_name.replace(/\s+/g, '_')}.png"`);
    res.send(buffer);

  } catch (error) {
    console.error('Error composing image:', error);
    res.status(500).json({ error: 'Failed to compose image', details: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Image Compositor API' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Image Compositor API running on port ${PORT}`);
});
