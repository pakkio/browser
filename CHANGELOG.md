# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2025-06-27

### 🎉 Major Features Added

#### 🔐 Authentication System
- **Conditional Authentication**: Added AUTH environment variable control
  - `AUTH=TRUE/YES/1` enables Google OAuth2 authentication
  - `AUTH=FALSE/NO/0` disables authentication for local/trusted environments
- **Google OAuth2 Integration**: Complete login/logout workflow
- **Session Management**: Secure session handling with configurable timeouts
- **User Interface**: Authentication status display and logout functionality

#### 🧪 Comprehensive Test Suite
- **69% Server Coverage**: Dramatically improved from ~33% to 69%
- **22+ Test Cases**: Covering all major functionality
- **Multiple Test Categories**:
  - Authentication tests (enabled/disabled modes)
  - Video transcoding endpoint tests
  - EPUB processing and cover extraction tests
  - Error path coverage tests
  - Middleware and startup tests
  - Integration workflows
  - Security validation

### 🔧 Technical Improvements

#### Authentication Module (`auth.js`)
- Created dedicated authentication module
- Passport.js integration with Google OAuth2 strategy
- Conditional middleware setup based on environment
- Authentication status endpoints

#### Server Enhancements (`server.js`)
- Conditional session and passport initialization
- Authentication routes (only when enabled)
- Enhanced startup logging with auth status
- Improved error handling and logging

#### Test Infrastructure
- **New Test Files**:
  - `tests/auth.test.js` - Authentication system tests
  - `tests/video.test.js` - Video transcoding tests
  - `tests/epub.test.js` - EPUB processing tests
  - `tests/error-paths.test.js` - Error handling coverage
  - `tests/middleware.test.js` - Application middleware tests
  - `tests/comprehensive.test.js` - Additional edge cases
  - `tests/frontend.test.js` - Frontend JavaScript coverage

### 🛡️ Security Enhancements
- Path traversal protection maintained
- Authentication bypass prevention
- Session security improvements
- Input validation for all endpoints

### 📚 Documentation Updates
- **README.md**: Comprehensive documentation overhaul
  - Authentication setup instructions
  - Environment variable configuration
  - Test coverage information
  - API endpoint documentation
- **CHANGELOG.md**: Added this changelog for version tracking

### 🔄 Configuration Changes
- **Environment Variables**:
  - Added `AUTH` variable for authentication control
  - Updated `.env` example with authentication options
- **Package.json**: No new dependencies required for core functionality

### 🎯 Testing Achievements
- **Statement Coverage**: 69.25% (server.js)
- **Function Coverage**: 79.41% (server.js)
- **Branch Coverage**: 56.5% (server.js)
- **Overall Coverage**: 51.12% (including frontend)

### 📋 Test Coverage by Category
- ✅ Authentication (both enabled/disabled modes)
- ✅ File serving with all MIME types
- ✅ PDF processing and preview generation
- ✅ Comic archive handling (CBZ/CBR)
- ✅ EPUB processing with metadata extraction
- ✅ Video transcoding with FFmpeg
- ✅ Security features (path traversal prevention)
- ✅ Error handling and edge cases
- ✅ Request middleware and logging

### 🚀 Performance & Reliability
- Enhanced error handling across all endpoints
- Improved logging for debugging and monitoring
- Better separation of concerns with authentication module
- Maintained backward compatibility for existing functionality

### 🔧 Developer Experience
- Comprehensive test suite for confident development
- Clear environment variable configuration
- Detailed documentation for setup and usage
- Multiple authentication modes for different deployment scenarios

---

## [1.0.0] - Previous Version

### Initial Features
- File browser with modern glassmorphism UI
- PDF, EPUB, and comic book archive support
- Video transcoding for AVI files
- Image and document preview capabilities
- Responsive design with purple gradient theme
- Basic security features and path validation