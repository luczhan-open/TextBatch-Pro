const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = 3001;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

[UPLOAD_DIR, OUTPUT_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const upload = multer({ dest: UPLOAD_DIR });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

// Text processing endpoint
app.post('/api/process', upload.array('files', 50), async (req, res) => {
  try {
    const { action, findText, replaceText, encoding = 'utf8', delimiter = '\n' } = req.body;
    const files = req.files;

    if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const results = [];

    for (const file of files) {
      const content = fs.readFileSync(file.path, encoding);
      let processed = content;
      let outputName = file.originalname;
      let outputPath;

      switch (action) {
        case 'find_replace': {
          if (!findText) return res.status(400).json({ error: 'Find text is required' });
          const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(escaped, 'g');
          const matches = content.match(regex);
          processed = content.replace(regex, replaceText || '');
          outputName = file.originalname.replace(/(\.\w+)?$/, '_replaced$1');
          outputPath = path.join(OUTPUT_DIR, outputName);
          fs.writeFileSync(outputPath, processed, encoding);
          results.push({
            name: outputName,
            originalName: file.originalname,
            matches: matches ? matches.length : 0,
            size: processed.length,
            url: `/outputs/${outputName}`
          });
          break;
        }

        case 'trim_lines': {
          processed = content.split('\n')
            .map(line => line.trim())
            .filter(line => line !== '')
            .join('\n');
          outputName = file.originalname.replace(/(\.\w+)?$/, '_trimmed$1');
          outputPath = path.join(OUTPUT_DIR, outputName);
          fs.writeFileSync(outputPath, processed, encoding);
          results.push({
            name: outputName,
            originalName: file.originalname,
            size: processed.length,
            url: `/outputs/${outputName}`
          });
          break;
        }

        case 'dedup_lines': {
          const seen = new Set();
          processed = content.split('\n')
            .map(l => l.trim())
            .filter(l => {
              if (seen.has(l) || l === '') return false;
              seen.add(l);
              return true;
            })
            .join('\n');
          outputName = file.originalname.replace(/(\.\w+)?$/, '_deduped$1');
          outputPath = path.join(OUTPUT_DIR, outputName);
          fs.writeFileSync(outputPath, processed, encoding);
          results.push({
            name: outputName,
            originalName: file.originalname,
            size: processed.length,
            url: `/outputs/${outputName}`
          });
          break;
        }

        case 'stats': {
          const lines = content.split('\n');
          const chars = content.length;
          const words = content.split(/[\s,，。.]+/).filter(w => w.length > 0).length;
          const chineseChars = (content.match(/[一-鿿]/g) || []).length;

          // Save stats as json
          const stats = {
            fileName: file.originalname,
            lines: lines.length,
            characters: chars,
            words: words,
            chineseCharacters: chineseChars,
            bytes: Buffer.byteLength(content, encoding)
          };

          outputName = file.originalname.replace(/(\.\w+)?$/, '_stats.json');
          outputPath = path.join(OUTPUT_DIR, outputName);
          fs.writeFileSync(outputPath, JSON.stringify(stats, null, 2), encoding);

          results.push({
            name: outputName,
            originalName: file.originalname,
            ...stats,
            url: `/outputs/${outputName}`
          });
          break;
        }

        case 'extract_links': {
          const urls = content.match(/https?:\/\/[^\s"'<>）)]+/g) || [];
          const emails = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
          processed = `=== 提取的链接 ===\n${urls.join('\n')}\n\n=== 提取的邮箱 ===\n${emails.join('\n')}`;
          outputName = file.originalname.replace(/(\.\w+)?$/, '_extracted$1');
          outputPath = path.join(OUTPUT_DIR, outputName);
          fs.writeFileSync(outputPath, processed, encoding);
          results.push({
            name: outputName,
            originalName: file.originalname,
            urls: urls.length,
            emails: emails.length,
            url: `/outputs/${outputName}`
          });
          break;
        }

        default:
          return res.status(400).json({ error: 'Unknown action' });
      }
    }

    res.json({ success: true, files: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get outputs list
app.get('/api/outputs', (req, res) => {
  try {
    const files = fs.readdirSync(OUTPUT_DIR).map(f => {
      const stat = fs.statSync(path.join(OUTPUT_DIR, f));
      return { name: f, size: stat.size, time: stat.mtime, url: `/outputs/${f}` };
    }).sort((a, b) => b.time - a.time).slice(0, 50);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/outputs', express.static(OUTPUT_DIR));

// Clean old files every 2 hours
setInterval(() => {
  const files = fs.readdirSync(OUTPUT_DIR);
  const now = Date.now();
  files.forEach(f => {
    const p = path.join(OUTPUT_DIR, f);
    if (now - fs.statSync(p).mtimeMs > 7200000) fs.unlinkSync(p);
  });
}, 7200000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TextBatch Pro running at http://localhost:${PORT}`);
});
