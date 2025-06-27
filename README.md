# 🗂️ Modern File Browser

A sleek, modern web-based file browser with support for multiple file types including PDFs and comic book archives. Built with Node.js and Express, featuring a stunning glassmorphism UI.

![File Browser Screenshot](https://via.placeholder.com/800x400/667eea/ffffff?text=Modern+File+Browser)

## ✨ Features

### 📁 File Management
- **Directory Navigation** - Browse folders with intuitive breadcrumb navigation
- **File Type Icons** - Visual indicators for different file types
- **Smooth Animations** - Fluid hover effects and transitions

### 📄 Document Support
- **PDF Viewer** - Page-by-page PDF navigation with image conversion
- **EPUB Reader** - E-book support with page navigation
- **Office Documents** - DOCX, XLSX, PPTX preview and rendering
- **Comic Book Archives** - Support for CBZ (ZIP) and CBR (RAR) formats
- **Code Highlighting** - Syntax highlighting for programming languages
- **Subtitles** - SRT subtitle file support

### 🎨 Media Support
- **Images** - JPG, JPEG, PNG, GIF, WebP, BMP, SVG preview
- **Video** - MP4, AVI, MOV, MKV, WebM playback with controls (AVI with real-time transcoding)
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

# Start the server
npm start
```

The application will be available at `http://localhost:3000`

### Custom Directory

Browse a specific directory:
```bash
node server.js /path/to/your/directory
```

## 📋 Supported File Types

| Type | Extensions | Features |
|------|------------|----------|
| **Documents** | PDF | Page navigation, image conversion |
| **E-books** | EPUB | Page navigation, chapter support |
| **Office** | DOCX, XLSX, PPTX | Document rendering, spreadsheet viewing |
| **Comics** | CBZ, CBR | Page navigation, archive extraction |
| **Images** | JPG, JPEG, PNG, GIF, WebP, BMP, SVG | Full-size preview, hover effects |
| **Videos** | MP4, AVI, MOV, MKV, WebM | HTML5 video player with controls, AVI transcoding |
| **Audio** | MP3, WAV, FLAC, OGG, AAC | HTML5 audio player with controls |
| **Subtitles** | SRT | Text overlay support |
| **Code** | JS, TS, HTML, CSS, JSON, PY, JAVA, C, CPP, GO, RS, MD, TXT, XML, YAML, SQL | Syntax highlighting |

## 🎨 UI Features

### File Browser
- **Icon-based navigation** with emoji indicators
- **Hover animations** with 3D transforms
- **Color-coded file types** for quick identification
- **Glassmorphism effects** with translucent backgrounds

### Document Viewer
- **PDF Controls** - Blue gradient buttons for PDF navigation
- **Comic Controls** - Green gradient buttons for comic navigation
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

### Frontend
- **highlight.js** - Code syntax highlighting
- **mammoth.js** - DOCX document processing
- **xlsx.js** - Excel spreadsheet processing
- **jszip.js** - ZIP file handling
- **Modern CSS** - Glassmorphism and animations

## 📁 Project Structure

```
browser/
├── public/                    # Frontend assets
│   ├── index.html            # Main HTML file
│   ├── script.js             # Client-side JavaScript
│   ├── style.css             # Modern glassmorphism styles
│   └── file-renderer.js      # File type rendering logic
├── server.js                 # Express server with file handling
├── package.json              # Dependencies and scripts
└── README.md                 # This file
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

## 🎯 Usage Examples

### Browse Files
Navigate through directories by clicking on folders. Files display with appropriate icons based on their type.

### View PDFs
Click on any PDF file to open the document viewer with page navigation controls.

### Read Comics
Click on CBZ or CBR files to open the comic reader with page-by-page navigation.

### Preview Code
Text and code files open with syntax highlighting for better readability.

### Play AVI Videos
AVI files are automatically transcoded to WebM format for browser compatibility. The transcoding happens in real-time using FFmpeg, providing seamless playback without requiring pre-conversion.

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