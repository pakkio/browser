# 🗂️ Modern File Browser

A sleek, modern web-based file browser with support for multiple file types including PDFs and comic book archives. Built with Node.js and Express, featuring a stunning glassmorphism UI.

![File Browser Screenshot](https://via.placeholder.com/800x400/667eea/ffffff?text=Modern+File+Browser)

## ✨ Features

### 🔐 Authentication Control
- **Conditional Authentication**: Enable/disable OAuth2 authentication via environment variable
- **Google OAuth2 Integration**: Secure login when authentication is enabled
- **Session Management**: Persistent user sessions with configurable timeouts

### 📁 File Management
- **Directory Navigation** - Browse folders with intuitive breadcrumb navigation
- **File Type Icons** - Visual indicators for different file types
- **Smooth Animations** - Fluid hover effects and transitions
- **Security**: Path traversal protection and access control

### 📄 Document Support
- **PDF Viewer** - Enhanced navigation with **double-page and cover modes enabled by default**, text selection overlay, keyboard shortcuts
- **EPUB Reader** - E-book support with **double-chapter and cover modes enabled by default**, enhanced typography and styling
- **Office Documents** - DOCX, XLSX, PPTX preview and rendering
- **Comic Book Archives** - Support for CBZ (ZIP) and CBR (RAR) formats with page navigation. Automatically handles misnamed `.cbr` files that are actually ZIP archives.
- **Code Highlighting** - Syntax highlighting with **double-page mode enabled by default** for better code review
- **Text Files** - Enhanced text viewing with **double-page and cover modes enabled by default**, pagination support
- **Subtitles** - SRT subtitle file support with enhanced formatting

### 🎨 Media Support
- **Images** - JPG, JPEG, PNG, GIF, WebP, BMP, SVG preview
- **Video** - MP4, AVI, MOV, MKV, WebM playback with controls (AVI with real-time transcoding)
  - **Subtitle Support** - Automatic detection and loading of SRT/VTT subtitle files
  - **Manual Subtitle Selection** - Choose custom subtitle files for any video
  - **Multi-language Support** - Detect and display subtitles in multiple languages
- **Audio** - MP3, WAV, FLAC, OGG, AAC playback with controls

### 🎯 Modern UI
- **Glassmorphism Design** - Translucent panels with backdrop blur
- **Purple Gradient Theme** - Stunning color scheme
- **Responsive Layout** - Works on desktop and mobile
- **Custom Scrollbars** - Themed scrolling experience

## 🚀 Quick Start

### Prerequisites
- Node.js 14+
- ImageMagick or GraphicsMagick (for PDF support)
- FFmpeg (for AVI video transcoding)

### Installation

#### System Dependencies (Linux/Ubuntu/Debian)
```bash
# Install ImageMagick for PDF processing
sudo apt update
sudo apt install imagemagick

# Install FFmpeg for AVI video transcoding
sudo apt install ffmpeg

# Alternative: Install GraphicsMagick
# sudo apt install graphicsmagick
```

#### System Dependencies (macOS)
```bash
# Using Homebrew
brew install imagemagick

# Install FFmpeg for AVI video transcoding
brew install ffmpeg

# Alternative: Install GraphicsMagick
# brew install graphicsmagick
```

#### Application Setup
```bash
# Clone the repository
git clone <repository-url>
cd browser

# Install Node.js dependencies
npm install

# Set up environment (optional - auth disabled by default)
cp .env.example .env
# Edit .env to configure authentication

# Start the server
npm start
```

### Windows Compatibility

This project is partially runnable on Windows. The core file browsing and viewing of most file types will work. However, the following features will likely fail without manual intervention:

*   **PDF page count:** The server won't be able to determine the number of pages in a PDF.
*   **CBR (RAR) comic book viewing:** The server won't be able to extract pages from `.cbr` files.
*   **Video transcoding:** The server won't be able to transcode `.avi` and `.wmv` files.

To make the project fully runnable on Windows, you will need to install the following dependencies and ensure they are available in your system's `PATH`:

*   **`pdfinfo`:** Part of the [Xpdf](https://www.xpdfreader.com/download.html) command-line tools.
*   **`unrar`:** The command-line version of WinRAR. You can find it on the [RARLAB website](https://www.rarlab.com/rar_add.htm).
*   **`ffmpeg`:** A powerful multimedia framework. You can download it from the [official FFmpeg website](https://ffmpeg.org/download.html).

After installing these tools, make sure to add their installation directories to your system's `PATH` environment variable.

The application will be available at `http://localhost:3000`

#### Authentication Setup (Optional)

For secure environments, enable authentication:

1. **Create `.env` file**:
```env
AUTH=TRUE
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
BASE_URL=http://localhost:3000
```

2. **Google OAuth Setup**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create/select project → APIs & Services → Credentials
   - Create OAuth 2.0 Client ID
   - Add authorized redirect URI: `http://localhost:3000/auth/google/callback`

For local/trusted environments, set `AUTH=FALSE` or omit the `.env` file entirely.

### Custom Directory

Browse a specific directory:
```bash
node server.js /path/to/your/directory
```

## 🧪 Testing

The application includes a comprehensive test suite with unit tests, integration tests, and security validation.

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode during development
npm run test:watch
```

### Test Coverage

The test suite covers:
- **API Endpoints**: All server routes and error conditions
- **File Processing**: PDF, comic, and EPUB handling pipelines
- **Security**: Path traversal and input validation
- **Client Logic**: File filtering, search, and navigation
- **Integration**: Complete workflows and error handling

Current coverage: **69% server coverage** with 22+ comprehensive tests

## 📋 Supported File Types

| Type | Extensions | Features |
|------|------------|----------|
| **Documents** | PDF | **Double-page & cover modes by default**, text selection overlay, keyboard navigation (d/c/t keys) |
| **E-books** | EPUB | **Double-chapter & cover modes by default**, enhanced typography, improved image handling |
| **Office** | DOCX, XLSX, PPTX | Document rendering, spreadsheet viewing |
| **Comics** | CBZ, CBR | Page navigation, archive extraction |
| **Images** | JPG, JPEG, PNG, GIF, WebP, BMP, SVG | Full-size preview, hover effects |
| **Videos** | MP4, AVI, MOV, MKV, WebM | HTML5 video player with controls, AVI transcoding, automatic subtitle detection |
| **Audio** | MP3, WAV, FLAC, OGG, AAC | HTML5 audio player with controls |
| **Subtitles** | SRT | Enhanced formatting with styled time codes |
| **Code/Text** | JS, TS, HTML, CSS, JSON, PY, JAVA, C, CPP, GO, RS, MD, TXT, XML, YAML, SQL | **Double-page & cover modes by default**, syntax highlighting |

## 🎨 UI Features

### File Browser
- **Icon-based navigation** with emoji indicators
- **Hover animations** with 3D transforms
- **Color-coded file types** for quick identification
- **Glassmorphism effects** with translucent backgrounds

### Document Viewer
- **Enhanced PDF Controls** - **Double-page & cover modes enabled by default**, text selection overlay, keyboard shortcuts
- **EPUB Double-Chapter Mode** - **Side-by-side chapter viewing enabled by default** with cover mode and improved styling
- **Text File Double-Page** - **Code and text viewing enabled by default** with syntax highlighting in dual panes and cover mode
- **Keyboard Navigation** - Arrow keys for page navigation, 'd' for double-page toggle, 'c' for cover mode, 't' for text overlay
- **Cover Mode** - Proper book-like layout treating first/last pages as covers in double-page view
- **Responsive images** with hover zoom effects
- **Professional typography** with modern fonts

### Technical Details
- **Backdrop filters** for glassmorphism effects
- **CSS Grid/Flexbox** for responsive layouts
- **Custom scrollbars** matching the theme
- **Smooth transitions** using cubic-bezier curves

## 🛠️ Dependencies

### Backend
- **express** - Web server framework
- **pdf2pic** - PDF to image conversion
- **yauzl** - ZIP/CBZ archive extraction
- **node-unrar-js** - RAR/CBR archive extraction

### Development & Testing
- **jest** - Testing framework
- **supertest** - HTTP testing utilities
- **jest-environment-jsdom** - DOM testing environment

### Frontend
- **pdf.js** - PDF rendering with text layer support for text selection
- **highlight.js** - Code syntax highlighting
- **mammoth.js** - DOCX document processing
- **xlsx.js** - Excel spreadsheet processing
- **jszip.js** - ZIP file handling
- **Modern CSS** - Glassmorphism and animations with double-page layouts

## 📁 Project Structure

```
browser/
├── public/                         # Frontend assets
│   ├── index.html                 # Main HTML file
│   ├── script.js                  # Client-side JavaScript
│   ├── style.css                  # Modern glassmorphism styles
│   ├── file-renderer.js           # File type rendering logic
│   ├── auth.js                    # Authentication management
│   ├── annotations.js             # File annotation system
│   └── renderers/                 # Specialized document renderers
│       ├── document-renderers.js  # PDF and EPUB rendering with double-page/cover modes
│       ├── text-renderer.js       # Text and code rendering with double-page/cover modes
│       ├── image-renderer.js      # Image viewing and preview
│       ├── media-renderers.js     # Audio and video playback
│       └── other-renderers.js     # Comics, Office docs, Archives, HTML
├── tests/                          # Test suite
│   ├── server.test.js             # Server-side unit tests
│   ├── client.test.js             # Client-side unit tests
│   └── integration.test.js        # Integration tests
├── server.js                      # Express server with file handling
├── package.json                   # Dependencies and scripts
└── README.md                      # This file
```

## 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/browse` | GET | List directory contents |
| `/files` | GET | Serve file content |
| `/pdf-preview` | GET | Convert PDF page to image |
| `/comic-preview` | GET | Extract comic page from archive |
| `/epub-preview` | GET | Extract EPUB page content |
| `/video-transcode` | GET | Real-time AVI to WebM transcoding |
| `/subtitle` | GET | Serve SRT/VTT subtitle files (auto-converts SRT to WebVTT) |

## 🎯 Usage Examples

### Browse Files
Navigate through directories by clicking on folders. Files display with appropriate icons based on their type.

### View PDFs
Click on any PDF file to open the enhanced document viewer with:
- **Double-page and cover modes enabled by default** for optimal reading experience
- Page-by-page navigation with Previous/Next buttons
- Text selection overlay for copying PDF text
- Cover mode treats first/last pages as covers in double-page view
- Keyboard shortcuts: Arrow keys (navigation), 'd' (toggle double-page), 'c' (toggle cover mode), 't' (text overlay)

### Read EPUBs  
E-book files open with enhanced reader featuring:
- **Double-chapter and cover modes enabled by default** for optimal reading experience
- Chapter navigation and selection dropdown
- Cover mode treats first/last chapters as covers in double-chapter view
- Improved typography and image handling
- Keyboard shortcuts: Arrow keys (navigation), 'd' (toggle double-chapter), 'c' (toggle cover mode)

### Read Comics
Click on CBZ or CBR files to open the comic reader with page-by-page navigation.

### Preview Code/Text
Text and code files open with enhanced features:
- **Double-page and cover modes enabled by default** for optimal reading/reviewing experience
- Syntax highlighting for programming languages
- Cover mode treats first/last pages as covers in double-page view
- Pagination for large files
- Keyboard shortcuts: Arrow keys (navigation), 'd' (toggle double-page), 'c' (toggle cover mode)

### Play AVI Videos
AVI files are automatically transcoded to WebM format for browser compatibility. The transcoding happens in real-time using FFmpeg, providing seamless playback without requiring pre-conversion.

### Video Subtitles
Videos automatically detect and load matching subtitle files:
- **Automatic Detection** - Looks for `.srt` or `.vtt` files with the same name as the video
- **Multi-language Support** - Detects language codes like `.en.srt`, `.it.srt`, etc.
- **Keyboard Shortcut** - Press `s` or `S` to open subtitle selection dialog with prefix search
- **Prefix Search** - Type to filter available subtitles in the current directory
- **Manual Selection** - Use the "Select Subtitle File" button to choose any subtitle file from your computer
- **Format Support** - Both SRT and WebVTT formats supported (SRT auto-converted to WebVTT)
- **Naming Patterns** - Auto-detects: `video.srt`, `video.en.srt`, `video.eng.srt`, `video.english.srt`

## ⌨️ Keyboard Shortcuts

### PDF Viewer
- `←` / `→` Arrow keys - Navigate between pages
- `d` or `D` - Toggle double-page viewing mode (enabled by default)
- `c` or `C` - Toggle cover mode (enabled by default)
- `t` or `T` - Toggle text selection overlay

### EPUB Reader
- `←` / `→` Arrow keys - Navigate between chapters
- `d` or `D` - Toggle double-chapter viewing mode (enabled by default)
- `c` or `C` - Toggle cover mode (enabled by default)

### Text/Code Viewer
- `←` / `→` Arrow keys - Navigate between pages
- `d` or `D` - Toggle double-page viewing mode (enabled by default)
- `c` or `C` - Toggle cover mode (enabled by default)

### Video Player
- `Space` - Play/pause and toggle fullscreen
- `↑` / `↓` Arrow keys - Navigate to previous/next video in directory
- `Page Up` / `Page Down` - Navigate to previous/next video in directory
- `Mouse Wheel` - Fast forward/rewind by 10 seconds
- `s` or `S` - Open subtitle selection dialog with search
- `r` - Mark video with red color
- `g` - Mark video with green color
- `y` - Mark video with yellow color
- `b` - Mark video with blue color
- `c` - Add comment to video
- `1-5` - Rate video with 1-5 stars

### General Navigation
- Click on page numbers or use jump inputs for direct navigation
- All viewers support mouse wheel scrolling within content areas

## 📖 Enhanced Reading Modes

### Double-Page Mode (Default)
All document viewers (PDF, EPUB, Text/Code) start with double-page mode enabled by default for:
- **Better Reading Experience** - Side-by-side pages mimic real book reading
- **Efficient Screen Usage** - Utilizes wider screens effectively
- **Faster Navigation** - See more content at once
- **Code Review** - Compare code sections side-by-side

### Cover Mode (Default)
Cover mode is enabled by default and provides:
- **Proper Book Layout** - First page/chapter displayed alone as front cover
- **Natural Pagination** - Subsequent pages paired correctly (2-3, 4-5, etc.)
- **Rear Cover Handling** - Last page/chapter displayed alone as back cover
- **Professional Presentation** - Mimics real book/magazine reading experience

Both modes can be toggled individually using keyboard shortcuts ('d' for double-page, 'c' for cover mode) if you prefer single-page viewing.

## 🔒 Security Features

- **Path validation** prevents directory traversal attacks
- **File type restrictions** for safe browsing
- **Base directory enforcement** keeps browsing within bounds

## 📱 Responsive Design

The interface adapts to different screen sizes:
- **Desktop**: Side-by-side layout with 350px browser panel
- **Mobile**: Stacked layout with 40/60 height split

## 🎨 Customization

### Colors
The theme uses a purple gradient scheme with glassmorphism effects. Main colors:
- Primary: `#667eea` to `#764ba2`
- Accent: `#ff6b6b` to `#4ecdc4`
- Background: Translucent white overlays

### Animations
- **Hover effects**: 3D transforms with shadows
- **Transitions**: Smooth cubic-bezier curves
- **Loading states**: Spinning indicators

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 💡 WSL Drive Mounting

For WSL users working with network drives (like RaiDrive):

```bash
# Create mount point
sudo mkdir /mnt/z

# Mount Windows drive in WSL
sudo mount -t drvfs Z: /mnt/z

# For permanent mounting (add to /etc/fstab)
echo 'Z: /mnt/z drvfs defaults 0 0' | sudo tee -a /etc/fstab

# Unmount when done
sudo umount /mnt/z
```

This allows seamless access to Windows network drives from your WSL environment.

## 🙏 Acknowledgments

- **highlight.js** for code syntax highlighting
- **pdf2pic** for PDF processing
- **yauzl** and **node-unrar-js** for archive handling
- Modern CSS techniques for glassmorphism effects