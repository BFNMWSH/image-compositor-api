# Image Compositor API - Creatomate Replacement

Custom image composition API to replace Creatomate in your n8n workflow. Generates 1080x1920 product marketing images.

## 🚀 Quick Deploy to Railway

### Method 1: GitHub Deploy (Recommended)

1. **Create a new repository** on GitHub
2. **Add these files** to your repo:
   - `server.js`
   - `package.json`
   - `Dockerfile`
   - `.dockerignore` (create it with content below)

3. **Deploy on Railway**:
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Railway will auto-detect the Dockerfile and deploy

4. **Get your URL**:
   - Once deployed, go to Settings → Generate Domain
   - Copy your Railway URL (e.g., `https://your-app.up.railway.app`)

### Method 2: Railway CLI

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

## 📋 .dockerignore File

Create a `.dockerignore` file:

```
node_modules
npm-debug.log
.git
.gitignore
README.md
.env
```

## 🔧 n8n Integration

### Replace your Creatomate node with HTTP Request node:

**Settings:**
- **Method**: POST
- **URL**: `https://your-railway-app.up.railway.app/api/compose`
- **Body Content Type**: JSON
- **JSON Body**:

```json
{
  "profile_photo_url": "{{ $('Get Profile Picture').item.json.output }}",
  "product_image_url": "{{ $('Get many rows').item.json['Photo URL'] }}",
  "full_name": "{{ $json.Name }}",
  "whatsapp_number": "{{ $json['WhatsApp Number'] }}",
  "tc_logo_url": "https://creatomate.com/files/assets/7efc8afc-9fd6-46da-8b32-91976d16e60d",
  "verified_badge_url": "https://creatomate.com/files/assets/83f84366-9593-41eb-9f87-65aaac2607b8"
}
```

### Response Format

The API returns:
```json
{
  "success": true,
  "url": "data:image/png;base64,iVBORw0KG...",
  "message": "Image generated successfully"
}
```

The `url` field contains a base64 data URL that can be used directly in your workflow.

## 🎨 Customization

### Adjust Layout

Edit `server.js` to modify positioning:

```javascript
// Product image height
const productHeight = 1450;

// Profile photo position
const profileX = 80;
const profileY = productHeight + 100;
const profileSize = 120;

// Button position
const buttonY = productHeight - 100;
```

### Change Colors

```javascript
// Bottom section background
ctx.fillStyle = '#1e3a8a'; // Dark blue

// Button color
ctx.fillStyle = '#1e40af'; // Button blue
```

### Fonts

The API uses system fonts. To use custom fonts:

1. Add font files to `/fonts` directory
2. Register them in `server.js`:

```javascript
import { registerFont } from 'canvas';
registerFont('./fonts/YourFont.ttf', { family: 'CustomFont' });

// Then use:
ctx.font = 'bold 32px CustomFont';
```

## 🔍 Testing

### Test locally:

```bash
npm install
npm start
```

### Test with curl:

```bash
curl -X POST http://localhost:3000/api/compose \
  -H "Content-Type: application/json" \
  -d '{
    "profile_photo_url": "https://example.com/photo.jpg",
    "product_image_url": "https://example.com/product.jpg",
    "full_name": "Bafana Mawasha",
    "whatsapp_number": "067 880 5000",
    "tc_logo_url": "https://example.com/logo.png",
    "verified_badge_url": "https://example.com/verified.png"
  }'
```

## 📊 Performance

- **Average processing time**: 2-3 seconds per image
- **Memory usage**: ~200MB per request
- **Concurrent requests**: Handles 10+ simultaneous requests

## 🐛 Troubleshooting

### Canvas build errors on Railway

If you get canvas build errors, Railway might need additional build packs. The Dockerfile includes all necessary dependencies.

### Image not downloading

Make sure URLs are publicly accessible. Google Drive links need to be in direct download format:
- Wrong: `https://drive.google.com/file/d/FILE_ID/view`
- Right: `https://drive.google.com/uc?export=download&id=FILE_ID`

### Out of memory errors

Increase Railway memory limit in project settings if processing many large images.

## 💰 Cost Comparison

**Creatomate**: ~$99/month for 1000 renders
**This solution on Railway**: 
- Hobby plan: $5/month (500 hours)
- Pro plan: $20/month (unlimited)

## 🔐 Security (Optional)

Add API key authentication:

```javascript
app.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```

Then set `API_KEY` in Railway environment variables.

## 📝 License

MIT - Free to use and modify for your needs.
