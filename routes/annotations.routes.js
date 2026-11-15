const { Router } = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const {
  getAnnotations,
  postAnnotations,
  deleteAnnotations,
  searchAnnotations,
  migrateToSparseApi,
  getBookmarksApi,
  postBookmarkApi,
  renameBookmarkApi,
  deleteBookmarkApi,
} = require('../lib/annotation-handlers');

const router = Router();

// Annotations
router.get('/api/annotations', asyncHandler(getAnnotations));
router.post('/api/annotations', asyncHandler(postAnnotations));
router.delete('/api/annotations', asyncHandler(deleteAnnotations));
router.get('/api/search-annotations', asyncHandler(searchAnnotations));
router.post('/api/annotations/migrate-sparse', asyncHandler(migrateToSparseApi));

// Bookmarks
router.get('/bookmarks', asyncHandler(getBookmarksApi));
router.post('/bookmarks', asyncHandler(postBookmarkApi));
router.put('/bookmarks', asyncHandler(renameBookmarkApi));
router.delete('/bookmarks', asyncHandler(deleteBookmarkApi));

module.exports = router;
