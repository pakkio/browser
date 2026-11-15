const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../middleware/asyncHandler');
const { resolveSafePath } = require('../utils/pathSecurity');
const ApiError = require('../utils/ApiError');
const AIFileAnalyzer = require('../lib/ai-file-analyzer');

const router = Router();

const heavyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// Summarize a single file
router.post('/api/summarize-file', asyncHandler(async (req, res) => {
  const { path: filePath, content, fullPdf } = req.body;
  if (!filePath && !content) {
    throw ApiError.badRequest('File path or content is required');
  }

  const analyzer = new AIFileAnalyzer();
  const result = await analyzer.summarizeFileContent(filePath, content, fullPdf);
  res.json({ success: true, summary: result.summary, stats: result.stats });
}));

// Analyze a directory
router.post('/api/analyze-files', heavyLimiter, asyncHandler(async (req, res) => {
  const { path: dirPath, context } = req.body;
  if (dirPath === undefined || dirPath === null) {
    throw ApiError.badRequest('Directory path is required');
  }

  const fullPath = resolveSafePath(dirPath);
  const analyzer = new AIFileAnalyzer();
  const result = await analyzer.analyzeDirectory(fullPath, context);
  res.json({ success: true, ...result });
}));

module.exports = router;
